import type { ContentBlock, StreamChunk, ToolCallId, ReplayEnvelope } from '@deepseek-ai/dsh-llm';
import type { ResponseOutputItem, ResponseStreamEvent, Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { PlanError, classifyProviderError } from './errors.ts';
import { blockFingerprint, TOOL_NAMESPACE, type BlockReplay, type ResponseReplay } from './request.ts';

interface BlockState {
  index: number;
  outputIndex: number;
  kind: 'text' | 'reasoning' | 'tool-call';
  text: string;
  arguments: string;
  callId?: string;
  name?: string;
  closed: boolean;
  replay?: unknown;
}

/** Pure SSE-to-Harness translation; it never runs tools or performs provider I/O. */
export class ResponseStreamTranslator {
  terminal = false;
  private readonly blocks = new Map<string, BlockState>();
  private readonly items = new Map<number, ResponseOutputItem>();
  private readonly completedItems = new Set<number>();
  private readonly replay: BlockReplay[] = [];
  private nextIndex = 0;

  constructor(private readonly toolNames: ReadonlyMap<string, string>, private readonly identity: ResponseReplay) {}

  push(event: ResponseStreamEvent): StreamChunk[] {
    if (this.terminal) return [];
    const chunks: StreamChunk[] = [];
    switch (event.type) {
      case 'response.output_item.added':
        if (this.items.has(event.output_index)) throw new PlanError('INVALID_STREAM', 'An output index was reused during streaming.');
        this.items.set(event.output_index, event.item);
        if (event.item.type === 'function_call' || event.item.type === 'custom_tool_call') this.tool(event.output_index, event.item, chunks);
        else if (event.item.type === 'reasoning') this.block(`${event.output_index}:reasoning`, event.output_index, 'reasoning', chunks);
        else if (event.item.type !== 'message') throw new PlanError('UNSUPPORTED_RESPONSE', 'OpenAI returned an unsupported hosted tool or output item.');
        break;
      case 'response.output_text.delta':
      case 'response.refusal.delta': {
        const block = this.block(`${event.output_index}:text:${event.content_index}`, event.output_index, 'text', chunks);
        this.append(block, event.delta, chunks);
        break;
      }
      case 'response.reasoning_summary_text.delta': {
        const block = this.block(`${event.output_index}:reasoning`, event.output_index, 'reasoning', chunks);
        this.append(block, event.delta, chunks);
        break;
      }
      case 'response.function_call_arguments.delta':
      case 'response.custom_tool_call_input.delta': {
        const item = this.items.get(event.output_index);
        if (!item || (item.type !== 'function_call' && item.type !== 'custom_tool_call')) throw new PlanError('INVALID_STREAM', 'Tool arguments arrived without a declared tool call.');
        const block = this.tool(event.output_index, item, chunks);
        if (block.closed) throw new PlanError('INVALID_STREAM', 'Tool arguments arrived after the call was closed.');
        block.arguments += event.delta;
        chunks.push({ type: 'tool-call-delta', index: block.index, id: block.callId as ToolCallId, argumentsDelta: event.delta });
        break;
      }
      case 'response.output_item.done':
        this.completeItem(event.output_index, event.item, chunks);
        this.completedItems.add(event.output_index);
        break;
      case 'response.completed': this.complete(event.response, chunks); break;
      case 'response.failed': {
        const error = event.response.error;
        throw classifyProviderError(undefined, error?.code ?? 'response_failed');
      }
      case 'response.incomplete': throw new PlanError('INCOMPLETE_RESPONSE', 'OpenAI stopped before response.completed. Partial tool calls will not execute.');
      case 'error': throw classifyProviderError(undefined, event.code ?? 'stream_error');
    }
    return chunks;
  }

  private block(key: string, outputIndex: number, kind: BlockState['kind'], chunks: StreamChunk[]): BlockState {
    const existing = this.blocks.get(key);
    if (existing) return existing;
    const block: BlockState = { index: this.nextIndex++, outputIndex, kind, text: '', arguments: '', closed: false };
    this.blocks.set(key, block);
    chunks.push({ type: 'block-start', index: block.index, blockType: kind });
    return block;
  }

  private append(block: BlockState, delta: string, chunks: StreamChunk[]): void {
    if (block.closed) throw new PlanError('INVALID_STREAM', 'Content arrived after its block was closed.');
    block.text += delta;
    if (delta) chunks.push({ type: block.kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: block.index, text: delta });
  }

  private tool(outputIndex: number, item: Extract<ResponseOutputItem, { type: 'function_call' | 'custom_tool_call' }>, chunks: StreamChunk[]): BlockState {
    const key = `${outputIndex}:tool`;
    const existing = this.blocks.get(key);
    if (existing) {
      if (existing.callId !== item.call_id || existing.name !== this.toolNames.get(item.name)) throw new PlanError('INVALID_STREAM', 'The tool call identity changed during streaming.');
      return existing;
    }
    const name = this.toolNames.get(item.name);
    if (!name || (item.namespace && item.namespace !== TOOL_NAMESPACE)) throw new PlanError('UNKNOWN_TOOL', 'OpenAI requested a tool that was not declared in this request.');
    const block = this.block(key, outputIndex, 'tool-call', chunks);
    block.callId = item.call_id; block.name = name;
    const initial = item.type === 'function_call' ? item.arguments : item.input;
    block.arguments = initial;
    chunks.push({ type: 'tool-call-delta', index: block.index, id: item.call_id as ToolCallId, name, argumentsDelta: initial });
    return block;
  }

  private completeItem(outputIndex: number, item: ResponseOutputItem, chunks: StreamChunk[]): void {
    const previous = this.items.get(outputIndex);
    if (previous && (previous.type !== item.type || previous.id !== item.id)) throw new PlanError('INVALID_STREAM', 'The output item identity changed during streaming.');
    if ('status' in item && item.status !== undefined && item.status !== 'completed') throw new PlanError('INVALID_STREAM', 'A final output item was not completed.');
    this.items.set(outputIndex, item);
    if (item.type === 'message') {
      for (const [partIndex, part] of item.content.entries()) {
        const block = this.block(`${outputIndex}:text:${partIndex}`, outputIndex, 'text', chunks);
        this.fillText(block, part.type === 'output_text' ? part.text : part.refusal, chunks);
        this.close(block, item, chunks);
      }
    } else if (item.type === 'reasoning') {
      const block = this.block(`${outputIndex}:reasoning`, outputIndex, 'reasoning', chunks);
      this.fillText(block, item.summary.map(part => part.text).join(''), chunks);
      this.close(block, item, chunks);
    } else if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      const block = this.tool(outputIndex, item, chunks);
      const final = item.type === 'function_call' ? item.arguments : item.input;
      if (!final.startsWith(block.arguments)) throw new PlanError('INVALID_STREAM', 'Final tool arguments do not match the streamed prefix.');
      const remaining = final.slice(block.arguments.length);
      if (remaining) {
        if (block.closed) throw new PlanError('INVALID_STREAM', 'A closed tool call changed.');
        block.arguments = final;
        chunks.push({ type: 'tool-call-delta', index: block.index, id: block.callId as ToolCallId, argumentsDelta: remaining });
      }
      this.close(block, item, chunks);
    } else throw new PlanError('UNSUPPORTED_RESPONSE', 'OpenAI returned an unsupported hosted tool or output item.');
  }

  private fillText(block: BlockState, final: string, chunks: StreamChunk[]): void {
    if (!final.startsWith(block.text)) throw new PlanError('INVALID_STREAM', 'Final text does not match the streamed prefix.');
    const remaining = final.slice(block.text.length);
    if (remaining) this.append(block, remaining, chunks);
  }

  private close(block: BlockState, item: ResponseOutputItem, chunks: StreamChunk[]): void {
    if (block.closed) return;
    const content: ContentBlock = block.kind === 'tool-call'
      ? { type: 'tool-call', id: block.callId as ToolCallId, name: block.name!, arguments: block.arguments }
      : { type: block.kind, text: block.text };
    this.replay[block.index] = { fingerprint: blockFingerprint(content), item: structuredClone(item) };
    block.closed = true;
    chunks.push({ type: 'block-end', index: block.index, block: content });
  }

  private complete(response: OpenAIResponse, chunks: StreamChunk[]): void {
    if (response.status !== 'completed') throw new PlanError('INCOMPLETE_RESPONSE', 'The terminal response was not completed.');
    const indices = [...this.items.keys(), ...[...this.blocks.values()].map(block => block.outputIndex)];
    if (response.output.length === 0) {
      // The live plan-sharing route can send a thin completion after item.done.
      // Only a fully validated item ledger may supply its omitted aggregate.
      if (indices.some(index => !this.completedItems.has(index))) throw new PlanError('INVALID_STREAM', 'The final response omitted an unfinished output item.');
    } else {
      if (indices.some(index => !response.output[index])) throw new PlanError('INVALID_STREAM', 'The final response omitted a streamed output item.');
      for (const [index, item] of response.output.entries()) this.completeItem(index, item, chunks);
    }
    if ([...this.blocks.values()].some(block => !block.closed)) throw new PlanError('INVALID_STREAM', 'The response completed with open content blocks.');
    if (![...this.blocks.values()].some(block => block.kind === 'tool-call' || (block.kind === 'text' && block.text.length > 0))) throw new PlanError('EMPTY_RESPONSE', 'OpenAI completed without a visible response or tool call.');
    if (response.usage) chunks.push({ type: 'usage', usage: {
      inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens,
      cacheReadTokens: response.usage.input_tokens_details.cached_tokens, reasoningTokens: response.usage.output_tokens_details.reasoning_tokens,
    } });
    const replayState: ReplayEnvelope = { response: this.identity, blocks: this.replay };
    this.terminal = true;
    chunks.push({ type: 'finish', reason: { kind: [...this.blocks.values()].some(block => block.kind === 'tool-call') ? 'tool-calls' : 'stop' }, replayState });
  }
}

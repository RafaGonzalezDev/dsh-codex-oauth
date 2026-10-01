import { createHash } from 'node:crypto';
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment';
import { offloadedImageText, projectToolUpdates, requestImageHandleText, requiredImageOffload, type ContentBlock, type GenerateOptions, type ImageAttachmentAccessResolver, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import type { ResponseCreateParamsStreaming, ResponseInputItem, ResponseInputContent, FunctionTool } from 'openai/resources/responses/responses';
import { PlanError, throwIfAborted } from './errors.ts';
import type { ActiveGrant } from './session.ts';

export const TOOL_NAMESPACE = 'harness';
export interface BlockReplay { fingerprint: string; item: unknown }
export interface ResponseReplay { kind: 'chatgpt-plan-v1'; clientId: string; model: string }

export function wireToolName(name: string): string {
  const readable = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 46) || 'tool';
  return `${readable}_${createHash('sha256').update(name).digest('hex').slice(0, 16)}`;
}

export function blockFingerprint(block: ContentBlock): string {
  return createHash('sha256').update(JSON.stringify(block)).digest('hex');
}

export interface BuiltRequest { body: ResponseCreateParamsStreaming; toolNames: Map<string, string> }
type ImagePort = Pick<AttachmentStore, 'readImageRequest' | 'imageLimits'>;
export interface RequestImagePolicy { maxPixels: number; maxImageBytes: number; maxRequestBytes: number }
/** Local request policy matches the pinned native pi-ai defaults, not an API limit. */
export const DEFAULT_IMAGE_POLICY: Readonly<RequestImagePolicy> = Object.freeze({
  maxPixels: 2048 * 2048, maxImageBytes: 1024 * 1024, maxRequestBytes: 20 * 1024 * 1024,
});

export class RequestBuilder {
  constructor(
    private readonly attachments: ImagePort,
    private readonly imageAccess: ImageAttachmentAccessResolver = () => undefined,
    private readonly fileText: (ref: FileAttachmentRef) => string = () => { throw new PlanError('UNSUPPORTED_CONTENT', 'Files must be projected by the native LLM runtime.'); },
    private readonly imagePolicy: Readonly<RequestImagePolicy> = DEFAULT_IMAGE_POLICY,
  ) {}

  async build(options: GenerateOptions, model: LlmResolvedModelInfo, grant: ActiveGrant): Promise<BuiltRequest> {
    throwIfAborted(options.signal);
    const projected = projectToolUpdates(options.messages, options.tools, undefined, options.toolHistory);
    const input: ResponseInputItem[] = [];
    const names = new Map<string, string>();
    const tools: FunctionTool[] = (projected.tools ?? []).map(tool => {
      const name = wireToolName(tool.name);
      if (names.has(name)) throw new PlanError('INVALID_TOOLS', 'The tool declarations contain duplicate or colliding names.');
      names.set(name, tool.name);
      return { type: 'function', name, description: tool.description, parameters: structuredClone(tool.parameters), strict: false };
    });
    const images = new Map<string, RequestImageAttachment>();
    const readImage = async (ref: ImageAttachmentRef) => {
      const cached = images.get(ref.attachmentId);
      if (cached) return cached;
      // Native normalization preserves aspect ratio, canonical color, and durable identity.
      const version = await this.attachments.readImageRequest(ref, {
        ...requestImageDimensions(ref.width, ref.height, this.imagePolicy.maxPixels),
        maxBytes: this.imagePolicy.maxImageBytes,
      }, options.signal);
      images.set(ref.attachmentId, version);
      return version;
    };
    for (const message of projected.messages) {
      for (const block of message.content) {
        if (block.type !== 'image' || block.offloaded) continue;
        if (message.role !== 'user' && message.role !== 'tool') throw new PlanError('UNSUPPORTED_CONTENT', 'Images are supported in user messages and native tool results.');
        if (!model.inputModalities?.includes('image')) throw new PlanError('UNSUPPORTED_CONTENT', 'The selected model does not accept image inputs.');
        await readImage(block.attachment);
      }
    }
    const offloadImages = requiredImageOffload(projected.messages,
      { representation: 'base64', maxBytes: this.imagePolicy.maxRequestBytes },
      block => images.get(block.attachment.attachmentId)!.data.byteLength);
    if (offloadImages > 0) throw new PlanError('IMAGE_OFFLOAD_REQUIRED',
      `Request images exceed the ${this.imagePolicy.maxRequestBytes}-byte base64 bound; ${offloadImages} more oldest occurrence(s) must be offloaded.`,
      undefined, undefined, undefined, offloadImages);
    const content = async (blocks: readonly ContentBlock[]): Promise<ResponseInputContent[]> => {
      const result: ResponseInputContent[] = [];
      for (const block of blocks) {
        switch (block.type) {
          case 'text': result.push({ type: 'input_text', text: block.text }); break;
          case 'file': result.push({ type: 'input_text', text: this.fileText(block.attachment) }); break;
          case 'image': {
            if (block.offloaded) { result.push({ type: 'input_text', text: offloadedImageText(block.attachment, this.imageAccess(block.attachment)) }); break; }
            if (!model.inputModalities?.includes('image')) throw new PlanError('UNSUPPORTED_CONTENT', 'The selected model does not accept image inputs.');
            const version = await readImage(block.attachment);
            result.push({ type: 'input_text', text: requestImageHandleText(block.attachment, version, this.imageAccess(block.attachment)) });
            result.push({ type: 'input_image', image_url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`, detail: 'auto' });
            break;
          }
          default: throw new PlanError('UNSUPPORTED_CONTENT', `The request contains an unsupported ${block.type} block.`);
        }
      }
      return result;
    };
    let instructions = options.system;
    const callTypes = new Map<string, 'function' | 'custom'>();
    for (const [messageIndex, message] of projected.messages.entries()) {
      if (message.role === 'system') {
        const text = message.content.map(block => {
          if (block.type !== 'text') throw new PlanError('UNSUPPORTED_CONTENT', 'System instructions must be text.');
          return block.text;
        }).join('');
        if (instructions === undefined && messageIndex === 0) instructions = text;
        else input.push({ role: 'developer', content: text });
        continue;
      }
      if (message.role === 'assistant') {
        const replay = message.source.replayState;
        const envelope = isRecord(replay) && isRecord(replay.response) && replay.response.kind === 'chatgpt-plan-v1'
          && replay.response.clientId === grant.registration.clientId && replay.response.model === options.model ? replay : undefined;
        for (const [index, block] of message.content.entries()) {
          const candidate = Array.isArray(envelope?.blocks) ? envelope.blocks[index] : undefined;
          const retained = isRecord(candidate) && candidate.fingerprint === blockFingerprint(block) && isRecord(candidate.item) ? candidate.item : undefined;
          if (block.type === 'reasoning') {
            if (retained?.type === 'reasoning' && typeof retained.id === 'string' && typeof retained.encrypted_content === 'string') input.push(retained as unknown as ResponseInputItem);
          } else if (block.type === 'tool-call') {
            const custom = retained?.type === 'custom_tool_call';
            callTypes.set(block.id, custom ? 'custom' : 'function');
            if (custom) input.push({ type: 'custom_tool_call', call_id: block.id, name: wireToolName(block.name), namespace: TOOL_NAMESPACE, input: block.arguments });
            else input.push({ type: 'function_call', call_id: block.id, name: wireToolName(block.name), namespace: TOOL_NAMESPACE, arguments: block.arguments });
          } else if (block.type === 'text') {
            if (block.text) input.push({ role: 'assistant', content: block.text });
          } else throw new PlanError('UNSUPPORTED_CONTENT', `Assistant history contains an unsupported ${block.type} block.`);
        }
      } else if (message.role === 'tool') {
        const output = await content(message.content);
        if (message.isError) output.unshift({ type: 'input_text', text: 'The tool reported an error.' });
        if (!callTypes.has(message.toolCallId)) throw new PlanError('INVALID_HISTORY', 'A tool result has no matching assistant tool call in the retained history.');
        if (callTypes.get(message.toolCallId) === 'custom') input.push({ type: 'custom_tool_call_output', call_id: message.toolCallId, output });
        else input.push({ type: 'function_call_output', call_id: message.toolCallId, output });
      } else {
        input.push({ role: message.role, content: await content(message.content) });
      }
    }
    // Preview limits forbid temperature, output caps, stop sequences, and server-side history.
    // Auxiliary native callers may set these hints; they are never sent to this endpoint.
    const body: ResponseCreateParamsStreaming = {
      model: options.model, input, store: false, stream: true,
      include: ['reasoning.encrypted_content'],
      ...(instructions !== undefined ? { instructions } : {}),
      ...(model.reasoning ? { reasoning: { ...(options.reasoningEffort ? { effort: options.reasoningEffort as NonNullable<NonNullable<ResponseCreateParamsStreaming['reasoning']>['effort']> } : {}), summary: 'auto' } } : {}),
      ...(tools.length ? { tools: [{ type: 'namespace', name: TOOL_NAMESPACE, description: 'Native DeepSeek Harness tools. Execution and permissions are controlled by the Harness.', tools }] } : {}),
    };
    return { body, toolNames: names };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

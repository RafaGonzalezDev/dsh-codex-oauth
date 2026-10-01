import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerateOptions, ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { RequestBuilder, wireToolName } from '../packages/plugin/src/request.ts';
import { ResponseStreamTranslator } from '../packages/plugin/src/response-stream.ts';
import { ChatGPTPlanAdapter } from '../packages/plugin/src/adapter.ts';
import { parsePiCatalog as parseCatalog, resolvedModel } from '../packages/plugin/src/models.ts';
import { DEFAULT_IMAGE_POLICY } from '../packages/plugin/src/request.ts';
import { fixture, registration, piCatalog as wireCatalog } from './helpers.ts';

const tools = [{ name: 'fs.read', description: 'Read a permitted file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, { name: 'fs.read!', description: 'Another tool', parameters: { type: 'object', properties: {} } }];
const imagePort = { imageLimits: { maxImageBytes: 10_000 }, readImageRequest: async (ref: any) => ({ ...ref, data: new Uint8Array([1, 2, 3]) }) } as any;
const model = resolvedModel(parseCatalog(wireCatalog)[0]!);
const options = (messages: any[] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]): GenerateOptions => ({ provider: 'chatgpt-plan', model: 'gpt-6.1-sol', messages, tools });
const toolItem = (id = 'call-one', name = tools[0]!.name, args = '', status = 'in_progress') => ({ type: 'function_call', id: `fc-${id}`, call_id: id, name: wireToolName(name), namespace: 'harness', arguments: args, status });
const messageItem = (text = 'Hello') => ({ type: 'message', id: 'msg-one', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const completed = (output: unknown[]) => ({ type: 'response.completed', response: { id: 'response-one', status: 'completed', output, usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 3 } } } });
const sse = (events: unknown[]) => new Response(events.map(event => `event: ${(event as any).type}\ndata: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'test-request-id' } });
async function chunks(stream: AsyncIterable<StreamChunk>) { const values: StreamChunk[] = []; for await (const chunk of stream) values.push(chunk); return values; }
function translator() { return new ResponseStreamTranslator(new Map(tools.map(tool => [wireToolName(tool.name), tool.name])), { kind: 'chatgpt-plan-v1', clientId: registration.clientId, model: model.id }); }
function push(target: ResponseStreamTranslator, events: unknown[]) { return events.flatMap(event => target.push(event as ResponseStreamEvent)); }

test('catalog preserves Pi order and names without inventing unknown capabilities', () => {
  const catalog = parseCatalog([{ id: 'verified-text', name: 'Text', provider: 'openai-codex', type: 'chat', input: ['text'], reasoning: false }, ...wireCatalog, { id: 'unknown', name: 'Unknown', provider: 'openai-codex', type: 'chat', input: [], reasoning: false }]);
  assert.deepEqual(catalog.map(value => value.id), ['verified-text', 'gpt-6.1-sol', 'unknown']);
  assert.equal(catalog[1]!.name, 'GPT-6.1 Sol');
  assert.equal(catalog[2]!.available, false); assert.equal(catalog[0]!.contextWindow, undefined);
  assert.throws(() => parseCatalog([...wireCatalog, ...wireCatalog]), { code: 'INVALID_CATALOG' });
  const mixed = parseCatalog([{ id: 'multimodal', name: 'Mixed', provider: 'openai-codex', type: 'chat', input: ['text', 'image', 'audio', 'video'], reasoning: false }]);
  assert.deepEqual(mixed[0]!.inputModalities, ['text', 'image']); assert.ok(mixed[0]!.warning); assert.equal(mixed[0]!.available, true);
});

test('Responses receives the native current tools and full history, without preview-forbidden hints', async () => {
  const { manager } = await fixture(); const builder = new RequestBuilder(imagePort, undefined, ref => `Native file: ${ref.name}`);
  const request = await builder.build({ ...options([{ role: 'system', content: [{ type: 'text', text: 'System rules' }] }, { role: 'user', content: [{ type: 'text', text: 'First' }] }, { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'tool-call', id: 'native-call', name: tools[0]!.name, arguments: '{"path":"notes.txt"}' }] }, { role: 'tool', toolCallId: 'native-call', source: { kind: 'tool' }, content: [{ type: 'text', text: 'Tool result' }] }, { role: 'user', content: [{ type: 'file', attachment: { name: 'document.pdf' } }] }]), maxTokens: 100, temperature: 0, stop: ['END'] }, model, await manager.activeGrant());
  assert.equal(request.body.instructions, 'System rules'); assert.equal(request.body.stream, true); assert.equal(request.body.store, false);
  assert.equal((request.body.input as any[]).length, 4); assert.equal((request.body.input as any[])[1].call_id, 'native-call');
  assert.equal((request.body.input as any[])[2].output[0].text, 'Tool result'); assert.equal((request.body.input as any[])[3].content[0].text, 'Native file: document.pdf');
  assert.equal((request.body.tools as any[])[0].type, 'namespace'); assert.equal((request.body.tools as any[])[0].tools.length, 2); assert.notEqual(wireToolName('fs.read'), wireToolName('fs.read!'));
  for (const forbidden of ['max_output_tokens', 'temperature', 'stop', 'previous_response_id']) assert.equal(forbidden in request.body, false);
});

test('explicit instructions and every historical system update retain their original order', async () => {
  const { manager } = await fixture();
  const builder = new RequestBuilder(imagePort);
  const history = options([
    { role: 'system', content: [{ type: 'text', text: 'Initial history rules' }] },
    { role: 'user', content: [{ type: 'text', text: 'First turn' }] },
    { role: 'system', content: [{ type: 'text', text: 'Updated history rules' }] },
    { role: 'user', content: [{ type: 'text', text: 'Second turn' }] },
  ]);
  const grant = await manager.activeGrant();
  const explicit = await builder.build({ ...history, system: 'Explicit native instructions' }, model, grant);
  assert.equal(explicit.body.instructions, 'Explicit native instructions');
  assert.deepEqual((explicit.body.input as any[]).map(item => item.role), ['developer', 'user', 'developer', 'user']);
  assert.equal((explicit.body.input as any[])[0].content, 'Initial history rules');
  assert.equal((explicit.body.input as any[])[2].content, 'Updated history rules');
  const implicit = await builder.build(history, model, grant);
  assert.equal(implicit.body.instructions, 'Initial history rules');
  assert.deepEqual((implicit.body.input as any[]).map(item => item.role), ['user', 'developer', 'user']);
});

test('PNG, JPEG, WebP and GIF references and tool-result images use native normalized bytes', async () => {
  const { manager } = await fixture(); let reads = 0;
  const builder = new RequestBuilder({ ...imagePort, readImageRequest: async (ref: any) => { reads++; return imagePort.readImageRequest(ref); } });
  const images = ['png', 'jpeg', 'webp', 'gif'].map((format, i) => ({ type: 'image', attachment: { attachmentId: `image-${i}`, mediaType: `image/${format}`, width: 400, height: 300, bytes: 3, name: `image.${format}` } }));
  const request = await builder.build(options([{ role: 'user', content: images }, { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'tool-call', id: 'call-image', name: tools[0]!.name, arguments: '{}' }] }, { role: 'tool', toolCallId: 'call-image', content: [images[0]], source: { kind: 'tool' } }]), model, await manager.activeGrant());
  const input = request.body.input as any[];
  assert.deepEqual(input[0].content.filter((part: any) => part.type === 'input_image').map((part: any) => part.image_url), ['png', 'jpeg', 'webp', 'gif'].map(format => `data:image/${format};base64,AQID`));
  assert.equal(input[2].output[1].type, 'input_image'); assert.equal(reads, 4);
  await assert.rejects(builder.build(options([{ role: 'user', content: images }]), { ...model, inputModalities: ['text'] }, await manager.activeGrant()), { code: 'UNSUPPORTED_CONTENT' });
  const offloaded = await builder.build(options([{ role: 'user', content: [{ ...images[0], offloaded: true }] }]), model, await manager.activeGrant());
  assert.equal((offloaded.body.input as any[])[0].content.length, 1); assert.equal(reads, 4);
});

test('parallel native tools keep call ids, names, raw arguments and one successful finish', () => {
  const target = translator(); const output = push(target, [
    { type: 'response.output_item.added', output_index: 0, item: toolItem() },
    { type: 'response.output_item.added', output_index: 1, item: toolItem('call-two', tools[1]!.name) },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{}' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"path":' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '"a"}' },
    { type: 'response.output_item.done', output_index: 1, item: toolItem('call-two', tools[1]!.name, '{}', 'completed') },
    completed([toolItem('call-one', tools[0]!.name, '{"path":"a"}', 'completed'), toolItem('call-two', tools[1]!.name, '{}', 'completed')]),
  ]);
  const ends = output.filter(value => value.type === 'block-end'); assert.equal(ends.length, 2);
  assert.deepEqual(ends.map(value => value.block).sort((a: any, b: any) => a.id.localeCompare(b.id)), [{ type: 'tool-call', id: 'call-one', name: 'fs.read', arguments: '{"path":"a"}' }, { type: 'tool-call', id: 'call-two', name: 'fs.read!', arguments: '{}' }]);
  assert.equal(output.filter(value => value.type === 'finish').length, 1); assert.equal((output.at(-1) as any).reason.kind, 'tool-calls');
});

test('reasoning replay survives JSON persistence but never crosses account, model, or rewritten blocks', async () => {
  const reasoning = { type: 'reasoning', id: 'reasoning-one', summary: [{ type: 'summary_text', text: 'Summary' }], encrypted_content: 'opaque-reasoning' };
  const target = translator(); const output = push(target, [{ type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } }, { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'Summary' }, completed([reasoning, messageItem('Done')])]);
  const replay = JSON.parse(JSON.stringify((output.at(-1) as any).replayState));
  const content = output.filter(value => value.type === 'block-end').map(value => value.block);
  const assistant = { role: 'assistant', source: { kind: 'model', replayState: replay }, content };
  const { manager } = await fixture(); const grant = await manager.activeGrant(); const builder = new RequestBuilder(imagePort);
  const restored = await builder.build(options([assistant]), model, grant); assert.equal((restored.body.input as any[])[0].encrypted_content, 'opaque-reasoning');
  const changedAccount = await builder.build(options([assistant]), model, { ...grant, registration: { ...grant.registration, clientId: 'different-client' } }); assert.equal((changedAccount.body.input as any[]).some(item => item.type === 'reasoning'), false);
  const changedModel = await builder.build({ ...options([assistant]), model: 'other-model' }, model, grant); assert.equal((changedModel.body.input as any[]).some(item => item.type === 'reasoning'), false);
  const rewritten = await builder.build(options([{ ...assistant, content: [{ type: 'reasoning', text: 'Rewritten' }, content[1]] }]), model, grant); assert.equal((rewritten.body.input as any[]).some(item => item.type === 'reasoning'), false);
});

test('unknown tools, contradictory final arguments, incomplete and late errors never finish successfully', () => {
  assert.throws(() => push(translator(), [{ type: 'response.output_item.added', output_index: 0, item: { ...toolItem(), name: 'undeclared' } }]), { code: 'UNKNOWN_TOOL' });
  assert.throws(() => push(translator(), [{ type: 'response.output_item.added', output_index: 0, item: toolItem('call-one', tools[0]!.name, '{') }, completed([toolItem('call-one', tools[0]!.name, '[]')])]), { code: 'INVALID_STREAM' });
  assert.throws(() => push(translator(), [{ type: 'response.incomplete', response: {} }]), { code: 'INCOMPLETE_RESPONSE' });
  const target = translator(); const partial = push(target, [{ type: 'response.output_item.done', output_index: 0, item: toolItem('call-one', tools[0]!.name, '{}', 'completed') }]);
  assert.equal(partial.some(value => value.type === 'finish'), false);
  assert.throws(() => push(target, [{ type: 'response.failed', response: { error: { code: 'server_error' } } }]), { code: 'SERVER' });
});

test('the official SDK sends exactly one public Responses request with subscription attribution', async () => {
  const { manager } = await fixture(); let requests = 0; let body: any; let headers!: Headers;
  const transport: typeof fetch = async (input, init) => {
    requests++; assert.equal(String(input), 'https://api.openai.com/v1/responses');
    assert.equal(init?.redirect, 'error');
    headers = new Headers(init?.headers); body = JSON.parse(String(init?.body));
    return sse([{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hello' }, completed([messageItem()])]);
  };
  const adapter = new ChatGPTPlanAdapter(manager, imagePort, undefined, undefined, transport);
  const result = await chunks(adapter.stream(options())); assert.equal(requests, 1); assert.equal(headers.get('authorization'), 'Bearer test-access-token');
  assert.equal(body.stream, true); assert.equal(body.store, false);
  assert.equal(result.filter(value => value.type === 'finish').length, 1); assert.equal((result.at(-1) as any).reason.kind, 'stop');
  assert.equal((result.find(value => value.type === 'usage') as any).usage.reasoningTokens, 3);
});

test('native image budgets count repeated base64 occurrences and offload before provider I/O', async () => {
  const { manager } = await fixture(); let reads = 0; let target: any; let calls = 0;
  const ref = { attachmentId: 'large-image', mediaType: 'image/png', width: 8000, height: 2000, bytes: 3, name: 'large.png' };
  const port = { ...imagePort, readImageRequest: async (image: any, projection: any) => { reads++; target = projection; return imagePort.readImageRequest(image); } };
  const adapter = new ChatGPTPlanAdapter(manager, port, undefined, undefined, async () => { calls++; return sse([completed([messageItem()])]); }, { ...DEFAULT_IMAGE_POLICY, maxRequestBytes: 6 });
  const result = await chunks(adapter.stream(options([{ role: 'user', content: Array.from({ length: 3 }, () => ({ type: 'image', attachment: ref })) }])));
  assert.equal((result.at(-1) as any).reason.failure.code, 'IMAGE_OFFLOAD_REQUIRED');
  assert.equal((result.at(-1) as any).reason.failure.offloadImages, 2);
  assert.equal(calls, 0); assert.equal(reads, 1); assert.equal(target.maxBytes, 1024 * 1024);
  assert.ok(target.width * target.height <= 2048 * 2048); assert.ok(Math.abs(target.width / target.height - 4) < 0.01);
  const retried = await chunks(adapter.stream(options([{ role: 'user', content: [
    { type: 'image', attachment: ref, offloaded: true }, { type: 'image', attachment: ref, offloaded: true }, { type: 'image', attachment: ref },
  ] }])));
  assert.equal((retried.at(-1) as any).reason.kind, 'stop'); assert.equal(calls, 1);
});

test('omitted, replaced and unfinished final output items cannot authorize streamed tools', () => {
  const initial = { type: 'response.output_item.done', output_index: 0, item: toolItem('call-one', tools[0]!.name, '{}', 'completed') };
  assert.throws(() => push(translator(), [{ type: 'response.output_item.added', output_index: 0, item: toolItem() }, completed([])]), { code: 'INVALID_STREAM' });
  assert.throws(() => push(translator(), [initial, { ...initial, output_index: 1, item: toolItem('call-two', tools[1]!.name, '{}', 'completed') }, completed([initial.item])]), { code: 'INVALID_STREAM' });
  assert.throws(() => push(translator(), [initial, completed([{ ...initial.item, id: 'replaced-id' }])]), { code: 'INVALID_STREAM' });
  assert.throws(() => push(translator(), [initial, { type: 'response.output_item.added', output_index: 0, item: toolItem('call-one', tools[0]!.name, '{}') }]), { code: 'INVALID_STREAM' });
  assert.throws(() => push(translator(), [completed([toolItem()])]), { code: 'INVALID_STREAM' });
  assert.throws(() => push(translator(), [{ type: 'error', code: 'subscription_sharing_usage_limit_exceeded' }]), { code: 'QUOTA', status: undefined });
});

test('thin live completions use the closed item ledger and still require response.completed', () => {
  const target = translator();
  const output = push(target, [
    { type: 'response.output_item.added', output_index: 0, item: toolItem() },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' },
    { type: 'response.output_item.done', output_index: 0, item: toolItem('call-one', tools[0]!.name, '{}', 'completed') },
    { type: 'response.output_item.done', output_index: 1, item: toolItem('call-two', tools[1]!.name, '{}', 'completed') },
  ]);
  assert.equal(target.terminal, false);
  assert.equal(output.some(chunk => chunk.type === 'finish'), false);
  const final = push(target, [completed([])]);
  assert.equal((final.at(-1) as any).reason.kind, 'tool-calls');
  assert.equal((final.at(-1) as any).replayState.blocks.length, 2);
  assert.equal(target.terminal, true);
});

test('quota, ineligibility, rate limits and transport errors preserve account credentials', async () => {
  for (const scenario of [
    { status: 429, code: 'subscription_sharing_usage_limit_exceeded', expected: 'QUOTA' },
    { status: 403, code: 'subscription_sharing_user_not_eligible', expected: 'INELIGIBLE' },
    { status: 429, code: 'rate_limit_exceeded', expected: 'RATE_LIMIT' },
    { status: 503, code: 'subscription_sharing_usage_unavailable', expected: 'SERVER' },
  ]) {
    const { manager, repo } = await fixture(); let calls = 0;
    const adapter = new ChatGPTPlanAdapter(manager, imagePort, undefined, undefined, async () => { calls++; return Response.json({ error: { code: scenario.code, message: 'Private provider detail', type: 'provider_error' } }, { status: scenario.status, headers: { 'retry-after': '2' } }); });
    const result = await chunks(adapter.stream(options())); const failure = (result.at(-1) as any).reason.failure;
    assert.equal(failure.code, scenario.expected); assert.equal(failure.status, scenario.status); assert.equal(failure.providerRetryAfterMs, 2000); assert.equal(calls, 1);
    assert.ok((await repo.read()).tokens); assert.equal(JSON.stringify(result).includes('Private provider detail'), false);
  }
  const { manager, repo } = await fixture(); let calls = 0;
  const adapter = new ChatGPTPlanAdapter(manager, imagePort, undefined, undefined, async () => { calls++; throw new TypeError('Private transport details'); });
  const result = await chunks(adapter.stream(options())); const failure = (result.at(-1) as any).reason.failure;
  assert.equal(failure.code, 'TRANSPORT'); assert.equal(failure.status, undefined); assert.equal(calls, 1); assert.ok((await repo.read()).tokens);
});

test('EOF and server failure produce one failed finish, retain credentials and do not retry or change billing', async () => {
  const { manager, repo } = await fixture(); let count = 0;
  const adapter = new ChatGPTPlanAdapter(manager, imagePort, undefined, undefined, async () => { count++; return sse([{ type: 'response.output_item.added', output_index: 0, item: toolItem() }]); });
  const output = await chunks(adapter.stream(options())); assert.equal((output.at(-1) as any).reason.failure.code, 'INCOMPLETE_RESPONSE'); assert.equal(count, 1);
  const failing = new ChatGPTPlanAdapter(manager, imagePort, undefined, undefined, async () => { count++; return Response.json({ detail: 'Unavailable' }, { status: 503, headers: { 'x-request-id': 'admission-test-id' } }); });
  const failure = await chunks(failing.stream(options())); assert.equal((failure.at(-1) as any).reason.failure.code, 'SERVER'); assert.equal((failure.at(-1) as any).reason.failure.requestId, 'admission-test-id'); assert.equal(count, 2); assert.ok((await repo.read()).tokens);
});

test('a prepared call refuses a replacement account before sending any inference', async () => {
  const { manager, repo } = await fixture(); let calls = 0;
  const adapter = new ChatGPTPlanAdapter(manager, imagePort, undefined, undefined, async () => { calls++; return sse([completed([messageItem()])]); });
  const prepared = await adapter.prepareCall('chatgpt-plan', model.id);
  await repo.update(async session => ({ ...session, generation: session.generation + 1, registrations: [{ ...registration, clientId: 'replacement' }], activeClientId: 'replacement' })); await manager.initialize();
  const output = await chunks(prepared.stream(options())); assert.equal((output.at(-1) as any).reason.failure.code, 'ACCOUNT_CHANGED'); assert.equal(calls, 0);
});

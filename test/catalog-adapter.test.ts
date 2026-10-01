import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ChatGPTPlanAdapter } from '../packages/plugin/src/adapter.ts';
import { parsePiCatalog } from '../packages/plugin/src/models.ts';
import { fixture } from './helpers.ts';

const imagePort = { imageLimits: { maxImageBytes: 1000 }, readImageRequest: async () => { throw new Error('No images in this test.'); } } as any;
const options: GenerateOptions = { provider: 'chatgpt-plan', model: 'gpt-6.1-sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'Only OK.' }] }], tools: [] };
async function collect(stream: AsyncIterable<StreamChunk>) { const chunks: StreamChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }

for (const status of [400, 401, 403, 404]) test(`human names never replace request IDs and HTTP ${status} model_not_found preserves the grant`, async () => {
  const f = await fixture(); const before = await f.store.readRecord(f.repo.key); const bodies: any[] = [];
  const adapter = new ChatGPTPlanAdapter(f.manager, imagePort, undefined, undefined, async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-access-token');
    assert.equal(init?.redirect, 'error');
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ error: { type: 'invalid_request_error', code: 'model_not_found', message: 'Private account response.' } }, { status });
  });
  const listed = await adapter.listModels('chatgpt-plan');
  assert.equal(listed[0]?.name, 'GPT-6.1 Sol'); assert.equal(listed[0]?.id, 'gpt-6.1-sol');
  const result = await collect(adapter.stream(options));
  assert.equal((result.at(-1) as any).reason.failure.code, 'MODEL_UNAVAILABLE');
  assert.equal(JSON.stringify(result).includes('Private account response'), false);
  assert.equal(bodies.length, 1); assert.equal(bodies[0].model, 'gpt-6.1-sol');
  assert.equal(bodies[0].stream, true); assert.equal(bodies[0].store, false);
  assert.equal(f.catalog.refreshes, 0); assert.equal(f.oauth.revocations.length, 0);
  assert.deepEqual(await f.store.readRecord(f.repo.key), before);
  assert.equal((await f.manager.status()).preferredModelAvailable, true);
  f.manager.dispose();
});

test('unlisted IDs are never discovered implicitly, aliased, sent, or substituted', async () => {
  const f = await fixture(); let calls = 0;
  const adapter = new ChatGPTPlanAdapter(f.manager, imagePort, undefined, undefined, async () => { calls++; throw new Error('Must not send.'); });
  for (const id of ['GPT-6.1 Sol', 'gpt-6.1-sol-unknown']) {
    await assert.rejects(adapter.resolveModel('chatgpt-plan', id), { code: 'MODEL_UNAVAILABLE' });
  }
  assert.equal(f.catalog.refreshes, 0); assert.equal(f.oauth.refreshes, 0); assert.equal(calls, 0);
  assert.equal((await adapter.resolveModel('chatgpt-plan', 'gpt-6.1-sol')).name, 'GPT-6.1 Sol');
  f.manager.dispose();
});

test('the native selector lists the newest model first and keeps unselectable entries out', async () => {
  const f = await fixture();
  const adapter = new ChatGPTPlanAdapter(f.manager, imagePort, undefined, undefined, async () => { throw new Error('No request expected.'); });
  f.catalog.values = parsePiCatalog([
    { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai-codex', type: 'chat', input: ['text'], reasoning: false },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai-codex', type: 'chat', input: ['text'], reasoning: false },
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'openai-codex', type: 'chat', input: ['text', 'image'], contextWindow: 272_000, reasoning: true },
    { id: 'image-only', name: 'Image Only', provider: 'openai-codex', type: 'chat', input: ['image'], reasoning: false },
  ]);
  const listed = await adapter.listModels('chatgpt-plan');
  assert.deepEqual(listed.map(model => model.id), ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.5']);
  assert.deepEqual(listed.map(model => model.name), ['GPT-6.1 Sol', 'GPT-6 Sol', 'GPT-5.5']);
  assert.equal(listed[0]!.context?.contextWindow, 272_000);
  assert.equal((await adapter.resolveModel('chatgpt-plan', 'gpt-5.5')).name, 'GPT-5.5');
  await assert.rejects(adapter.resolveModel('chatgpt-plan', 'image-only'), { code: 'UNKNOWN_CAPABILITY' });
  f.manager.dispose();
});

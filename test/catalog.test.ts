import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CatalogModel, parsePiCatalog, PiCatalogBody, PI_CATALOG_MAX_BYTES, PI_CATALOG_URL, PREFERRED_MODEL, PROVIDER_ID, publicModel, resolvedModel, selectionOrder } from '../packages/plugin/src/models.ts';
import { PiCatalog } from '../packages/plugin/src/pi-catalog.ts';
import { PI_CATALOG_SNAPSHOT } from '../packages/plugin/src/pi-catalog.generated.ts';
import type { CatalogInfo } from '../packages/plugin/src/contracts.ts';

function wire(id = 'new-model', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: `Model ${id}`, provider: 'openai-codex', type: 'chat', input: ['text', 'image'], contextWindow: 120_000, reasoning: true, ...extra };
}
const fallback = { generatedAt: 10, models: [wire('bundled-one'), wire('bundled-two')] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Options = NonNullable<ConstructorParameters<typeof PiCatalog>[1]>;
async function setup(t: TestContext, transport: typeof fetch, options: Omit<Options, 'transport' | 'onChanged'> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-pi-catalog-'));
  const file = join(directory, 'cache', 'catalog.json');
  const changes: CatalogInfo[] = [];
  const source = new PiCatalog(file, { fallback, now: () => 100, ...options, transport, onChanged: () => changes.push(source.info()) });
  t.after(async () => { source.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { directory, file, source, changes };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('the generated Pi snapshot preserves the nine exact model identities and Sol metadata', () => {
  assert.equal(PROVIDER_ID, 'chatgpt-plan');
  assert.equal(PREFERRED_MODEL, 'gpt-6.1-sol');
  const models = parsePiCatalog(PI_CATALOG_SNAPSHOT.models);
  assert.equal(models.length, 9);
  assert.deepEqual(models.map(({ id, name }) => ({ id, name })), PI_CATALOG_SNAPSHOT.models.map(({ id, name }) => ({ id, name })));
  const sol = models.find(model => model.id === PREFERRED_MODEL)!;
  assert.equal(sol.name, 'GPT-6.1 Sol');
  assert.equal(sol.contextWindow, 272_000);
  assert.deepEqual(sol.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(sol.defaultReasoningEffort, undefined);
  assert.ok(PI_CATALOG_SNAPSHOT.generatedAt > 0);
  for (const raw of PI_CATALOG_SNAPSHOT.models) {
    assert.ok(Object.keys(raw).every(key => ['id', 'name', 'provider', 'type', 'input', 'contextWindow', 'reasoning', 'thinkingLevelMap'].includes(key)));
  }
});

test('normalization retains casing, order and new IDs without copying route metadata or inventing defaults', () => {
  const raw = [wire('Future-ID.Exact', { name: 'My Display NAME', contextWindow: undefined, api: 'secret-api', baseUrl: 'https://example.invalid', headers: { Authorization: 'secret' }, cost: {}, output: ['audio'], maxTokens: 300, defaultReasoningEffort: 'medium' }), wire('future-id.exact', { name: 'My Display NAME' })];
  const models = parsePiCatalog(raw);
  assert.deepEqual(models.map(model => model.id), ['Future-ID.Exact', 'future-id.exact']);
  assert.deepEqual(models.map(model => model.name), ['My Display NAME', 'My Display NAME']);
  assert.equal(models[0]!.contextWindow, undefined);
  assert.equal(models[0]!.defaultReasoningEffort, undefined);
  assert.ok(!JSON.stringify(models).includes('secret'));
  assert.deepEqual(Object.keys(PiCatalogBody.parse(raw)[0]!).sort(), ['contextWindow', 'id', 'input', 'name', 'provider', 'reasoning', 'type']);
  const resolved = resolvedModel(models[0]!);
  assert.equal(resolved.id, 'Future-ID.Exact');
  assert.equal(resolved.name, 'My Display NAME');
  assert.equal(resolved.context, undefined);
  assert.equal(resolved.defaultMaxTokens, undefined);
  assert.equal(resolved.reasoning?.defaultEffort, undefined);
  const view = publicModel(models[0]!);
  view.inputModalities.length = 0;
  assert.deepEqual(models[0]!.inputModalities, ['text', 'image']);
});

test('selection order offers the newest generation first without rewriting source order', () => {
  const source = parsePiCatalog([wire('gpt-5.5'), wire('gpt-6-sol'), wire('gpt-6.1-sol')]);
  const ordered = selectionOrder(source);
  assert.deepEqual(ordered.map(model => model.id), ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.5']);
  // The catalog, its cache and the bundled snapshot keep Pi's exact order.
  assert.deepEqual(source.map(model => model.id), ['gpt-5.5', 'gpt-6-sol', 'gpt-6.1-sol']);
  assert.notEqual(ordered, source);
  ordered.pop();
  assert.equal(source.length, 3);
  assert.deepEqual(selectionOrder([]), []);
});

test('Pi reasoning levels follow opt-out base levels, opt-in extended levels and supported wire enums', () => {
  assert.equal(parsePiCatalog([wire('none', { reasoning: false, thinkingLevelMap: { max: 'max' } })])[0]!.reasoningEfforts, undefined);
  assert.deepEqual(parsePiCatalog([wire()])[0]!.reasoningEfforts, ['none', 'minimal', 'low', 'medium', 'high']);
  assert.deepEqual(parsePiCatalog([wire('mapped', { thinkingLevelMap: { off: null, minimal: 'low', high: null, xhigh: null, max: 'max' } })])[0]!.reasoningEfforts, ['low', 'medium', 'max']);
  assert.deepEqual(parsePiCatalog([wire('dedup', { thinkingLevelMap: { off: 'low', minimal: 'high', low: 'low', medium: 'high', high: null, xhigh: 'max', max: null } })])[0]!.reasoningEfforts, ['low', 'high', 'max']);
  assert.deepEqual(parsePiCatalog([wire('unsupported', { thinkingLevelMap: { off: 'off', minimal: null, low: null, medium: null, high: null, xhigh: 'ultra', max: 'max' } })])[0]!.reasoningEfforts, ['max']);
  const noEfforts = parsePiCatalog([wire('disabled', { thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null } })])[0]!;
  assert.equal(noEfforts.reasoningEfforts, undefined);
  assert.equal(resolvedModel(noEfforts).reasoning, undefined);
  assert.equal(CatalogModel.safeParse({ ...noEfforts, reasoningEfforts: ['ultra'] }).success, false);
});

test('unsupported inputs are excluded and warned while advertised text stays selectable', () => {
  const supported = parsePiCatalog([wire('mixed', { input: ['image', 'text', 'audio', 'video', 'image'] })])[0]!;
  assert.deepEqual(supported.inputModalities, ['image', 'text']);
  assert.equal(supported.available, true);
  assert.match(supported.warning!, /unsupported/i);
  for (const input of [[], ['image'], ['audio', 'video']]) {
    const model = parsePiCatalog([wire('unsupported', { input })])[0]!;
    assert.equal(model.available, false);
    assert.match(model.warning!, /not selectable/);
    assert.throws(() => resolvedModel(model), { code: 'UNKNOWN_CAPABILITY' });
  }
});

test('Pi schema rejects invalid providers, types, identities, duplicates and oversized arrays', () => {
  const invalid: unknown[] = [
    { models: [wire()] }, [wire('same'), wire('same')], [wire('', {})], [wire('x', { name: ' \t' })],
    [wire('x', { provider: 'openai' })], [wire('x', { type: 'image' })], [wire('x', { reasoning: 'true' })],
    [wire('x', { contextWindow: -1 })], [wire('x', { contextWindow: 1.5 })], [wire('x', { thinkingLevelMap: { high: 123 } })],
    [wire('x', { name: 'x'.repeat(257) })], [wire('x', { input: undefined })],
    Array.from({ length: 1001 }, (_, index) => wire(`model-${index}`)),
  ];
  for (const body of invalid) assert.throws(() => parsePiCatalog(body), { code: 'INVALID_CATALOG' });
  assert.deepEqual(parsePiCatalog([]), []);
});

test('initialize is idempotent, offline, read-only and defensive about model and info snapshots', async t => {
  let calls = 0;
  const mutable = structuredClone(fallback);
  const { source, directory, changes } = await setup(t, async () => { calls++; throw new Error('Unexpected network'); }, { fallback: mutable });
  mutable.models.length = 0;
  await Promise.all([source.initialize(), source.initialize(), source.initialize()]);
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(source.info().loadedFrom, 'bundled');
  assert.equal(source.info().lastUpdatedAt, 10);
  assert.match(source.info().revision, /^[a-f0-9]{64}$/);
  source.models()[0]!.inputModalities.length = 0;
  source.models()[0]!.reasoningEfforts!.push('max');
  source.info().loadedFrom = 'remote';
  assert.deepEqual(source.models(), parsePiCatalog(fallback.models));
  assert.equal(source.info().loadedFrom, 'bundled');
  assert.deepEqual(changes, []);
});

test('HTTP 200 replaces the complete list, persists only normalized metadata and emits progress and terminal changes', async t => {
  const remote = [wire('DYNAMIC/New-ID', { name: 'Brand NEW display' })];
  const { source, file, directory, changes } = await setup(t, async (input, init) => {
    assert.equal(String(input), PI_CATALOG_URL);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('accept'), 'application/json');
    assert.equal(headers.get('user-agent'), 'dsh-chatgpt-plan/pi-catalog');
    assert.deepEqual([...headers.keys()].sort(), ['accept', 'user-agent']);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
    return Response.json(remote, { headers: { etag: '"version-one"' } });
  });
  const result = await source.refresh();
  assert.deepEqual(result, parsePiCatalog(remote));
  result[0]!.inputModalities.length = 0;
  assert.deepEqual(source.models(), parsePiCatalog(remote));
  assert.equal(source.info().loadedFrom, 'remote');
  assert.equal(source.info().lastCheckedAt, 100);
  assert.equal(source.info().lastUpdatedAt, 100);
  assert.deepEqual(changes.map(info => info.refreshing), [true, false]);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(cache).sort(), ['etag', 'lastCheckedAt', 'lastUpdatedAt', 'models', 'provider', 'revision', 'schemaVersion', 'url']);
  assert.deepEqual(cache.models, parsePiCatalog(remote));
  assert.equal(cache.url, PI_CATALOG_URL);
  assert.equal(cache.provider, 'openai-codex');
  assert.equal(cache.schemaVersion, 1);
  assert.deepEqual(await readdir(join(directory, 'cache')), ['catalog.json']);
  const reopened = new PiCatalog(file, { transport: async () => { throw new Error('Unexpected network'); }, fallback });
  t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.equal(reopened.info().loadedFrom, 'cache');
  assert.deepEqual(reopened.models(), source.models());
});

test('a validated cache supplies conditional ETag and HTTP 304 only advances checkedAt', async t => {
  const { source, file } = await setup(t, async () => Response.json([wire('remote')], { headers: { etag: 'W/"known-body"' } }));
  await source.refresh();
  const before = source.info();
  source.dispose();
  const reopened = new PiCatalog(file, { fallback, now: () => 200, transport: async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('if-none-match'), 'W/"known-body"');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Response(null, { status: 304 });
  } });
  t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.equal(reopened.info().loadedFrom, 'cache');
  await reopened.refresh();
  assert.equal(reopened.info().revision, before.revision);
  assert.equal(reopened.info().lastUpdatedAt, 100);
  assert.equal(reopened.info().lastCheckedAt, 200);
  assert.equal(reopened.info().loadedFrom, 'remote');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).lastCheckedAt, 200);
});

test('HTTP 304 cannot validate a bundled fallback or create a cache without a previous body', async t => {
  const { source, directory } = await setup(t, async (_input, init) => {
    assert.equal(new Headers(init?.headers).has('if-none-match'), false);
    return new Response(null, { status: 304 });
  });
  await assert.rejects(source.refresh(), { code: 'CATALOG_HTTP' });
  assert.deepEqual(source.models(), parsePiCatalog(fallback.models));
  assert.deepEqual(await readdir(directory), []);
  assert.match(source.info().warning!, /without a validated/);
});

test('a valid empty catalog replaces fallback models and remains valid for cache and HTTP 304', async t => {
  const { source, file } = await setup(t, async () => Response.json([], { headers: { etag: '"empty"' } }));
  assert.deepEqual(await source.refresh(), []);
  assert.deepEqual(source.models(), []);
  const reopened = new PiCatalog(file, { fallback, transport: async () => new Response(null, { status: 304 }) });
  t.after(() => reopened.dispose());
  await reopened.initialize();
  assert.deepEqual(reopened.models(), []);
  assert.deepEqual(await reopened.refresh(), []);
});

test('failed HTTP, JSON, schema and transport responses preserve the last valid list, revision and disk cache', async t => {
  let respond = () => Promise.resolve(Response.json([wire('only-remote')], { headers: { etag: '"last-good"' } }));
  let calls = 0;
  const { source, file, changes } = await setup(t, async (_input, init) => {
    if (calls++ > 0) assert.equal(new Headers(init?.headers).get('if-none-match'), '"last-good"');
    return respond();
  });
  await source.refresh();
  const expected = source.models();
  const expectedRevision = source.info().revision;
  const cache = await readFile(file, 'utf8');
  const failures = [
    () => Promise.resolve(new Response('sensitive-server-body', { status: 503 })),
    () => Promise.resolve(new Response('sensitive-invalid-json', { status: 200 })),
    () => Promise.resolve(Response.json([wire('duplicate'), wire('duplicate')])),
    () => Promise.resolve(Response.json({ models: [] })),
    () => Promise.reject(new Error('sensitive-network-message')),
  ];
  for (const fail of failures) {
    respond = fail;
    await assert.rejects(source.refresh());
    assert.deepEqual(source.models(), expected);
    assert.equal(source.info().revision, expectedRevision);
    assert.equal(await readFile(file, 'utf8'), cache);
    assert.equal(source.info().refreshing, false);
    assert.ok(source.info().warning);
    assert.ok(!JSON.stringify(source.info()).includes('sensitive'));
  }
  assert.equal(changes.length, 12);
  respond = () => Promise.resolve(Response.json([wire('replacement')]));
  assert.deepEqual(await source.refresh(), parsePiCatalog([wire('replacement')]));
  assert.equal(source.info().warning, undefined);
});

test('unchanged HTTP 200 retains updatedAt and missing or invalid ETag drops the previous validator', async t => {
  let now = 100;
  let calls = 0;
  const { source } = await setup(t, async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('if-none-match'), calls === 1 ? '"old-tag"' : null);
    return Response.json([wire('same')], { headers: calls++ === 0 ? { etag: '"old-tag"' } : { etag: 'invalid-unquoted-tag' } });
  }, { now: () => now });
  await source.refresh();
  const revision = source.info().revision;
  now = 200;
  await source.refresh();
  assert.equal(source.info().lastUpdatedAt, 100);
  assert.equal(source.info().lastCheckedAt, 200);
  assert.equal(source.info().revision, revision);
  await source.refresh();
});

test('timeout aborts uncooperative transport and ignores a response arriving after the deadline', async t => {
  const gate = deferred<Response>();
  let signal!: AbortSignal;
  const { source, directory } = await setup(t, async (_input, init) => { signal = init!.signal!; return gate.promise; }, { timeoutMs: 15 });
  const before = source.models();
  await assert.rejects(source.refresh(), { code: 'TIMEOUT' });
  assert.equal(signal.aborted, true);
  assert.match(source.info().warning!, /timed out/);
  let lateBodyCancelled = false;
  gate.resolve(new Response(new ReadableStream<Uint8Array>({ cancel() { lateBodyCancelled = true; } })));
  await tick();
  assert.equal(lateBodyCancelled, true);
  assert.deepEqual(source.models(), before);
  assert.deepEqual(await readdir(directory), []);
});

test('the timeout also bounds a stalled streamed body and cancels the reader', async t => {
  let cancelled = false;
  const { source } = await setup(t, async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('[')); },
    cancel() { cancelled = true; },
  })), { timeoutMs: 15 });
  await assert.rejects(source.refresh(), { code: 'TIMEOUT' });
  assert.equal(cancelled, true);
  assert.deepEqual(source.models(), parsePiCatalog(fallback.models));
});

test('response size is limited by advertised length and actual streamed bytes, including multiple chunks', async t => {
  for (const kind of ['length', 'single', 'chunks'] as const) {
    await t.test(kind, async t => {
      let cancelled = false;
      const { source } = await setup(t, async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          if (kind === 'length') controller.enqueue(new TextEncoder().encode('[]'));
          else if (kind === 'single') controller.enqueue(new Uint8Array(PI_CATALOG_MAX_BYTES + 1));
          else {
            controller.enqueue(new Uint8Array(PI_CATALOG_MAX_BYTES / 2));
            controller.enqueue(new Uint8Array(PI_CATALOG_MAX_BYTES / 2));
            controller.enqueue(new Uint8Array(1));
          }
        },
        cancel() { cancelled = true; },
      }), { headers: kind === 'length' ? { 'content-length': String(PI_CATALOG_MAX_BYTES + 1) } : {} }));
      await assert.rejects(source.refresh(), { code: 'CATALOG_TOO_LARGE' });
      assert.equal(cancelled, true);
      assert.deepEqual(source.models(), parsePiCatalog(fallback.models));
    });
  }
});

test('a valid catalog at exactly the response byte limit is accepted', async t => {
  const { source } = await setup(t, async () => new Response('[]' + ' '.repeat(PI_CATALOG_MAX_BYTES - 2)));
  assert.deepEqual(await source.refresh(), []);
});

test('corrupt caches fall back without writes, network or conditional ETag reuse', async t => {
  const { source, file } = await setup(t, async () => Response.json([wire('cached')], { headers: { etag: '"valid"' } }));
  await source.refresh();
  const original = JSON.parse(await readFile(file, 'utf8'));
  source.dispose();
  const variants = [
    '{broken-json', JSON.stringify({ ...original, schemaVersion: 2 }), JSON.stringify({ ...original, url: 'https://other.invalid' }),
    JSON.stringify({ ...original, provider: 'other' }), JSON.stringify({ ...original, revision: '0'.repeat(64) }),
    JSON.stringify({ ...original, etag: '"bad\r\ntag"' }), JSON.stringify({ ...original, lastCheckedAt: -1 }),
    JSON.stringify({ ...original, models: [...original.models, ...original.models] }), JSON.stringify({ ...original, accessToken: 'sensitive' }),
    ' '.repeat(PI_CATALOG_MAX_BYTES + 1),
  ];
  for (const text of variants) {
    await writeFile(file, text);
    let calls = 0;
    const reopened = new PiCatalog(file, { fallback, transport: async (_input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).has('if-none-match'), false);
      return new Response(null, { status: 304 });
    } });
    try {
      await reopened.initialize();
      assert.equal(calls, 0);
      assert.deepEqual(reopened.models(), parsePiCatalog(fallback.models));
      assert.equal(reopened.info().loadedFrom, 'bundled');
      assert.match(reopened.info().warning!, /cache could not be validated/);
      assert.ok(!JSON.stringify(reopened.info()).includes('sensitive'));
      assert.equal(await readFile(file, 'utf8'), text);
      await assert.rejects(reopened.refresh(), { code: 'CATALOG_HTTP' });
    } finally { reopened.dispose(); }
  }
});

test('concurrent refreshes share one request and aborting one waiter does not abort the shared transport', async t => {
  const gate = deferred<Response>();
  const started = deferred<AbortSignal>();
  let calls = 0;
  const { source, changes } = await setup(t, async (_input, init) => { calls++; started.resolve(init!.signal!); return gate.promise; });
  const caller = new AbortController();
  const first = source.refresh(caller.signal);
  const second = source.refresh();
  const third = source.refresh();
  const transportSignal = await started.promise;
  caller.abort(new Error('private cancellation reason'));
  await assert.rejects(first, { code: 'ABORTED', message: 'The catalog operation was cancelled.' });
  assert.equal(transportSignal.aborted, false);
  assert.equal(source.info().refreshing, true);
  gate.resolve(Response.json([wire('shared')]));
  const [a, b] = await Promise.all([second, third]);
  a[0]!.inputModalities.length = 0;
  assert.deepEqual(b, parsePiCatalog([wire('shared')]));
  assert.equal(calls, 1);
  assert.deepEqual(changes.map(info => info.refreshing), [true, false]);
});

test('already aborted callers do not start initialization or networking', async t => {
  let calls = 0;
  const { source, directory, changes } = await setup(t, async () => { calls++; return Response.json([]); });
  await assert.rejects(source.refresh(AbortSignal.abort()), { code: 'ABORTED' });
  assert.equal(calls, 0);
  assert.deepEqual(changes, []);
  assert.deepEqual(await readdir(directory), []);
});

test('dispose aborts all waiters and stale results cannot overwrite a replacement source or emit terminal changes', async t => {
  const gate = deferred<Response>();
  const started = deferred<AbortSignal>();
  const { source, file, changes } = await setup(t, async (_input, init) => { started.resolve(init!.signal!); return gate.promise; });
  const pending = source.refresh();
  const signal = await started.promise;
  source.dispose();
  source.dispose();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(signal.aborted, true);
  assert.equal(source.info().refreshing, false);
  const replacement = new PiCatalog(file, { fallback, transport: async () => Response.json([wire('replacement')]) });
  t.after(() => replacement.dispose());
  await replacement.refresh();
  const persisted = await readFile(file, 'utf8');
  gate.resolve(Response.json([wire('stale')]));
  await tick();
  assert.deepEqual(source.models(), parsePiCatalog(fallback.models));
  assert.equal(await readFile(file, 'utf8'), persisted);
  assert.deepEqual(changes.map(info => info.refreshing), [true]);
  await source.initialize();
  await assert.rejects(source.refresh(), { code: 'ABORTED' });
});

test('dispose during initialize cannot install a late cache snapshot', async t => {
  const { source, file } = await setup(t, async () => Response.json([wire('cached')]));
  await source.refresh();
  const before = await readFile(file, 'utf8');
  const reopened = new PiCatalog(file, { fallback });
  const initializing = reopened.initialize();
  reopened.dispose();
  await initializing;
  assert.deepEqual(reopened.models(), parsePiCatalog(fallback.models));
  assert.equal(await readFile(file, 'utf8'), before);
});

test('atomic persistence failure retains the prior catalog, leaves the destination intact and removes temporary files', async t => {
  let next = [wire('valid-old')];
  const { source, file } = await setup(t, async () => Response.json(next));
  await source.refresh();
  const oldModels = source.models();
  const oldRevision = source.info().revision;
  const oldCache = await readFile(file, 'utf8');
  const saved = `${file}.saved`;
  await rename(file, saved);
  await mkdir(file);
  await writeFile(join(file, 'sentinel'), 'leave intact');
  next = [wire('must-not-publish')];
  await assert.rejects(source.refresh(), { code: 'CATALOG_CACHE' });
  assert.deepEqual(source.models(), oldModels);
  assert.equal(source.info().revision, oldRevision);
  assert.match(source.info().warning!, /could not be saved/);
  assert.equal(await readFile(saved, 'utf8'), oldCache);
  assert.equal(await readFile(join(file, 'sentinel'), 'utf8'), 'leave intact');
  assert.deepEqual((await readdir(dirname(file))).sort(), ['catalog.json', 'catalog.json.saved']);
});

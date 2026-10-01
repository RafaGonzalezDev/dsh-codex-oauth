import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PlanError } from '../packages/plugin/src/errors.ts';
import { parsePiCatalog, publicModel } from '../packages/plugin/src/models.ts';
import { SessionManager, SessionRepository, type StoredSession } from '../packages/plugin/src/session.ts';
import { MemoryCredentials, StubCatalog, StubOAuth, fixture, piCatalog, registration, tokenSet } from './helpers.ts';

for (const legacyModels of [
  [{ id: 'old-account-only', name: 'Old', available: true, inputModalities: ['text'] }],
  [{ id: 'old-probed-model', availabilitySource: 'verified-request' }],
  { corruptLegacyModelMetadata: true },
  null,
  undefined,
]) {
  test(`legacy catalog ${JSON.stringify(legacyModels)} is ignored without rewriting the OAuth grant`, async () => {
    const store = new MemoryCredentials(); const repo = new SessionRepository(store, 'legacy');
    const record = { kind: 'grant' as const, payload: { version: 1, generation: 7, state: 'connected', registrations: [registration], activeClientId: registration.clientId, pendingClientId: 'pending-client', tokens: tokenSet(), models: legacyModels, warning: 'Old catalog outage', errorCode: 'SERVER' } };
    store.records.set(repo.key, structuredClone(record));
    const catalog = new StubCatalog(); const oauth = new StubOAuth();
    const manager = new SessionManager(repo, 'Legacy', oauth, catalog);
    await manager.initialize(); await manager.initialize();
    assert.deepEqual(manager.models().map(model => model.id), ['gpt-6.1-sol']);
    const status = await manager.status();
    assert.deepEqual(status.models, manager.models().map(publicModel));
    assert.equal(status.preferredModelAvailable, true); assert.equal(status.warning, undefined);
    assert.deepEqual(store.records.get(repo.key), record); assert.equal(store.writes, 0);
    assert.equal(catalog.refreshes, 0); assert.equal(oauth.refreshes, 0);
    const grant = await manager.activeGrant(); assert.equal(grant.generation, 7); assert.equal(store.writes, 0);
    await repo.update(async session => ({ ...session, pendingClientId: 'next-client' }));
    const upgradedRecord = await store.readRecord(repo.key);
    assert.ok(upgradedRecord?.kind === 'grant');
    const upgraded = upgradedRecord.payload as StoredSession;
    assert.deepEqual(upgraded.tokens, record.payload.tokens); assert.deepEqual(upgraded.registrations, record.payload.registrations);
    assert.deepEqual(upgraded.models, []); assert.equal(upgraded.generation, 7);
    manager.dispose();
  });
}

test('catalog refresh and restart add and retire IDs without refreshing tokens or rewriting the grant', async () => {
  const f = await fixture({ expired: true }); const writes = f.store.writes;
  const next = parsePiCatalog([{ ...piCatalog[0], id: 'future-model', name: 'Future Model' }]);
  f.catalog.next = next;
  await f.manager.refreshModels();
  assert.deepEqual(f.manager.models(), next);
  assert.deepEqual((await f.manager.status()).models, next.map(publicModel));
  assert.equal((await f.manager.status()).preferredModelAvailable, false);
  assert.equal(f.oauth.refreshes, 0); assert.equal(f.store.writes, writes);
  const source = new StubCatalog(); source.values = next;
  const restarted = new SessionManager(f.repo, 'Restarted', f.oauth, source); await restarted.initialize();
  assert.deepEqual(restarted.models(), next); assert.equal(source.refreshes, 0);
  source.next = []; await restarted.refreshModels();
  assert.deepEqual(restarted.models(), []); assert.deepEqual((await restarted.status()).models, []);
  f.manager.dispose(); restarted.dispose();
});

test('a catalog failure does not invalidate or rotate a connected grant', async () => {
  const f = await fixture({ expired: true }); const before = await f.store.readRecord(f.repo.key);
  f.catalog.refreshError = new PlanError('CATALOG_UNAVAILABLE', 'The catalog is temporarily unavailable.');
  await assert.rejects(f.manager.refreshModels(), { code: 'CATALOG_UNAVAILABLE' });
  assert.deepEqual(await f.store.readRecord(f.repo.key), before);
  assert.equal(f.oauth.refreshes, 0); assert.equal((await f.manager.status()).state, 'connected');
  assert.equal(f.manager.models()[0]?.name, 'GPT-6.1 Sol');
  f.manager.dispose();
});

test('disconnect during refresh and a late catalog completion never republish models', async () => {
  const f = await fixture(); let release!: () => void;
  f.catalog.refreshGate = new Promise<void>(resolve => { release = resolve; });
  const refresh = f.manager.refreshModels(); const rejected = assert.rejects(refresh, { code: 'ABORTED' });
  await f.manager.disconnect(); release(); await rejected;
  assert.deepEqual(f.manager.models(), []); assert.deepEqual((await f.manager.status()).models, []);
  await f.manager.initialize(); assert.deepEqual(f.manager.models(), []);
  assert.equal(f.oauth.revocations.length, 1); f.manager.dispose();
});

test('stale inference authentication failure cannot hide a newer account catalog', async () => {
  const f = await fixture();
  await f.repo.update(async session => ({ ...session, generation: session.generation + 1 }));
  await f.manager.initialize();
  await f.manager.invalidate(1, new PlanError('AUTH', 'Old request failed.'));
  assert.equal((await f.manager.status()).state, 'connected'); assert.ok((await f.repo.read()).tokens);
  assert.deepEqual((await f.manager.status()).models, f.manager.models().map(publicModel));
  assert.equal(f.manager.models()[0]?.id, 'gpt-6.1-sol'); f.manager.dispose();
});

test('unload stays closed despite a later credential event', async () => {
  const f = await fixture(); f.manager.dispose(); await f.manager.initialize();
  assert.equal(f.catalog.disposed, true); assert.deepEqual(f.manager.models(), []);
  assert.deepEqual((await f.manager.status()).models, []);
  await assert.rejects(f.manager.refreshModels(), { code: 'ABORTED' });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function holdNextRead(t: TestContext, repository: SessionRepository) {
  const original = repository.read.bind(repository);
  const captured = deferred<StoredSession>(); const release = deferred<void>(); let first = true;
  t.mock.method(repository, 'read', async () => {
    const session = await original();
    if (first) { first = false; captured.resolve(session); await release.promise; }
    return session;
  });
  t.after(() => release.resolve());
  return { captured: captured.promise, release: () => release.resolve() };
}

/** Delay the caller's continuation after a real in-memory commit releases its lock. */
function holdNextCommit(t: TestContext, repository: SessionRepository, state: StoredSession['state']) {
  const original = repository.update.bind(repository);
  const committed = deferred<void>(); const release = deferred<void>(); let first = true;
  t.mock.method(repository, 'update', async (mutate: Parameters<SessionRepository['update']>[0]) => {
    let held = false;
    await original(async current => {
      const next = await mutate(current);
      if (first && next?.state === state) { first = false; held = true; }
      return next;
    });
    if (held) { committed.resolve(); await release.promise; }
  });
  t.after(() => release.resolve());
  return { committed: committed.promise, release: () => release.resolve() };
}

async function connectNextGeneration(repository: SessionRepository) {
  await repository.update(async session => ({
    ...session, generation: session.generation + 1, state: 'connected',
    tokens: { ...tokenSet(), accessToken: 'test-new-account-access' },
  }));
}

test('an initially disconnected cached read still permits fresh grant admission under the record lock', async t => {
  const f = await fixture({ expired: true });
  const repository = new SessionRepository(f.store, 'test-profile');
  const catalog = new StubCatalog();
  const second = new SessionManager(repository, 'Cached second process', f.oauth, catalog);
  t.after(() => { f.manager.dispose(); second.dispose(); });
  const cached: StoredSession = { version: 1, generation: 0, state: 'disconnected', registrations: [], models: [] };
  t.mock.method(repository, 'read', async () => structuredClone(cached));
  await second.initialize();
  assert.deepEqual(second.models(), []);
  assert.equal(f.oauth.refreshes, 0); assert.equal(catalog.refreshes, 0);
  const grants = await Promise.all([f.manager.activeGrant(), second.activeGrant(), second.activeGrant()]);
  assert.equal(f.oauth.refreshes, 1);
  assert.ok(grants.every(grant => grant.tokens.refreshToken === f.oauth.nextTokens.refreshToken));
  assert.ok(grants.every(grant => grant.generation === 1));
  assert.equal((await f.repo.read()).state, 'connected');
  assert.equal(catalog.refreshes, 0);
});

test('a credential read begun before logout cannot republish models when it resolves afterward', async t => {
  const f = await fixture(); t.after(() => f.manager.dispose());
  const gate = holdNextRead(t, f.repo);
  const initializing = f.manager.initialize(); await gate.captured;
  await f.manager.disconnect();
  assert.deepEqual(f.manager.models(), []);
  gate.release(); await initializing;
  assert.deepEqual(f.manager.models(), []);
  assert.deepEqual((await f.manager.status()).models, []);
  assert.equal((await f.repo.read()).state, 'disconnected');
  assert.equal(f.catalog.refreshes, 0); assert.equal(f.oauth.refreshes, 0);
});

test('a stale credential read begun after logout stays blocked, but a newer connection releases admission', async t => {
  const f = await fixture(); t.after(() => f.manager.dispose());
  const old = await f.repo.read(); await f.manager.disconnect();
  const original = f.repo.read.bind(f.repo); let stale = true;
  t.mock.method(f.repo, 'read', async () => { if (stale) { stale = false; return old; } return original(); });
  await f.manager.initialize();
  assert.deepEqual(f.manager.models(), []);
  await assert.rejects(f.manager.activeGrant(), { code: 'MISSING_CREDENTIAL' });
  await connectNextGeneration(f.repo); await f.manager.initialize();
  assert.equal(f.manager.models()[0]?.id, 'gpt-6.1-sol');
  assert.equal((await f.manager.activeGrant()).tokens.accessToken, 'test-new-account-access');
  assert.equal(f.catalog.refreshes, 0); assert.equal(f.oauth.refreshes, 0);
});

test('out-of-order credential reads cannot replace a newer connection with an older disconnected snapshot', async t => {
  const f = await fixture(); t.after(() => f.manager.dispose()); await f.manager.disconnect();
  const gate = holdNextRead(t, f.repo);
  const stale = f.manager.initialize(); await gate.captured;
  await connectNextGeneration(f.repo); await f.manager.initialize();
  gate.release(); await stale;
  assert.equal((await f.manager.status()).state, 'connected');
  assert.equal(f.manager.models()[0]?.id, 'gpt-6.1-sol');
  assert.equal((await f.manager.activeGrant()).generation, 3);
});

for (const operation of ['invalidate', 'refresh-failure'] as const) {
  test(`a stale credential read cannot undo a confirmed ${operation} transition`, async t => {
    const f = await fixture({ expired: operation === 'refresh-failure' }); t.after(() => f.manager.dispose());
    const gate = holdNextRead(t, f.repo);
    const initializing = f.manager.initialize(); await gate.captured;
    if (operation === 'invalidate') await f.manager.invalidate(1, new PlanError('AUTH', 'Expired grant.'));
    else {
      f.oauth.refreshError = new PlanError('AUTH', 'Expired grant.');
      await assert.rejects(f.manager.activeGrant(), { code: 'AUTH' });
    }
    gate.release(); await initializing;
    assert.equal((await f.manager.status()).state, 'needs-reconnect');
    assert.deepEqual(f.manager.models(), []); assert.equal((await f.repo.read()).tokens, undefined);
  });

  test(`a delayed ${operation} completion cannot hide a newer account`, async t => {
    const f = await fixture({ expired: operation === 'refresh-failure' }); t.after(() => f.manager.dispose());
    const gate = holdNextCommit(t, f.repo, 'needs-reconnect');
    f.oauth.refreshError = new PlanError('AUTH', 'Expired grant.');
    const pending = operation === 'invalidate'
      ? f.manager.invalidate(1, new PlanError('AUTH', 'Old response.'))
      : assert.rejects(f.manager.activeGrant(), { code: 'AUTH' });
    await gate.committed;
    await connectNextGeneration(f.repo); await f.manager.initialize();
    assert.equal(f.manager.models()[0]?.id, 'gpt-6.1-sol');
    gate.release(); await pending;
    assert.equal(f.manager.models()[0]?.id, 'gpt-6.1-sol');
    assert.equal((await f.manager.status()).state, 'connected');
    assert.equal((await f.manager.activeGrant()).tokens.accessToken, 'test-new-account-access');
    assert.equal((await f.repo.read()).generation, 3);
  });
}

test('dispose invalidates an already pending credential read', async t => {
  const f = await fixture(); const gate = holdNextRead(t, f.repo);
  const initializing = f.manager.initialize(); await gate.captured;
  f.manager.dispose(); gate.release(); await initializing;
  assert.deepEqual(f.manager.models(), []); assert.equal(f.catalog.disposed, true);
  assert.deepEqual((await f.manager.status()).models, []);
});

async function completeMockAuthorization(manager: SessionManager, signal: AbortSignal, notices: string[]) {
  const opened = deferred<string>();
  const signingIn = manager.signIn({ mode: 'connect' }, signal, notice => {
    notices.push(notice.message); if (notice.url) opened.resolve(notice.url);
  });
  const authorization = new URL(await opened.promise);
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'test-code', client_id: registration.clientId }).toString();
  await fetch(callback);
  return { signingIn };
}

test('grant activation invalidates a disconnected credential read that was already pending', async t => {
  const repository = new SessionRepository(new MemoryCredentials(), 'pending-read-sign-in');
  const oauth = new StubOAuth(); const catalog = new StubCatalog(); const controller = new AbortController();
  const manager = new SessionManager(repository, 'Sign-in', oauth, catalog);
  t.after(() => { controller.abort(); manager.dispose(); });
  const gate = holdNextRead(t, repository);
  const initializing = manager.initialize(); await gate.captured;
  const { signingIn } = await completeMockAuthorization(manager, controller.signal, []);
  await signingIn; gate.release(); await initializing;
  assert.equal(manager.models()[0]?.id, 'gpt-6.1-sol');
  assert.equal((await manager.status()).state, 'connected');
  assert.equal(oauth.revocations.length, 0); assert.equal(catalog.refreshes, 0);
});

test('late grant commit notification after logout cannot publish models or announce Connected', async t => {
  const repository = new SessionRepository(new MemoryCredentials(), 'late-grant-commit');
  const oauth = new StubOAuth(); const catalog = new StubCatalog(); const controller = new AbortController();
  const notices: string[] = []; const publishedCounts: number[] = [];
  const manager = new SessionManager(repository, 'Sign-in', oauth, catalog, () => publishedCounts.push(manager.models().length));
  t.after(() => { controller.abort(); manager.dispose(); });
  await manager.initialize();
  const gate = holdNextCommit(t, repository, 'connected');
  const { signingIn } = await completeMockAuthorization(manager, controller.signal, notices);
  await gate.committed; await manager.disconnect();
  gate.release(); await signingIn;
  assert.deepEqual(manager.models(), []); assert.equal((await manager.status()).state, 'disconnected');
  assert.ok(publishedCounts.every(count => count === 0));
  assert.ok(notices.every(message => !message.startsWith('Connected.')));
  assert.equal(oauth.revocations.length, 1); assert.equal((await repository.read()).tokens, undefined);
});

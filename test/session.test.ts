import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { PlanError } from '../packages/plugin/src/errors.ts';
import { SessionManager, SessionRepository } from '../packages/plugin/src/session.ts';
import { MemoryCredentials, StubCatalog, StubOAuth, fixture, registration, tokenSet } from './helpers.ts';

test('two managers serialize one rotation and both receive the latest token', async () => {
  const oauth = new StubOAuth(); oauth.nextTokens = { ...tokenSet(), accessToken: 'test-rotated-access', refreshToken: 'test-rotated-refresh' };
  const f = await fixture({ expired: true, oauth });
  const second = new SessionManager(f.repo, 'second-process', oauth, new StubCatalog());
  const values = await Promise.all([f.manager.activeGrant(), second.activeGrant(), f.manager.activeGrant()]);
  assert.equal(oauth.refreshes, 1);
  assert.ok(values.every(value => value.tokens.accessToken === 'test-rotated-access'));
  assert.equal((await f.repo.read()).tokens?.refreshToken, 'test-rotated-refresh');
});

test('profile credential keys isolate accounts while installation identity is shared', async () => {
  const store = new MemoryCredentials();
  const a = await fixture({ store, profile: 'profile-a' }); const b = await fixture({ store, profile: 'profile-b' });
  assert.notEqual(a.repo.key, b.repo.key);
  const hostId = await a.repo.hostId();
  assert.match(hostId, /^urn:uuid:[0-9a-f-]+$/);
  assert.equal(hostId, await b.repo.hostId());
  await a.manager.disconnect();
  assert.equal((await b.manager.status()).state, 'connected');
  assert.equal((await a.manager.status()).state, 'disconnected');
});

test('installation identifiers retain their UUID when upgrading and reject malformed values', async () => {
  const store = new MemoryCredentials();
  const key = credentialKey('dsh-chatgpt-plan', 'installation');
  const uuid = '12345678-1234-4234-9234-123456789abc';
  store.records.set(key, { kind: 'grant', payload: { version: 1, hostId: uuid } });
  const repository = new SessionRepository(store, 'test-profile');
  assert.equal(await repository.hostId(), `urn:uuid:${uuid}`);
  assert.deepEqual(store.records.get(key), { kind: 'grant', payload: { version: 1, hostId: `urn:uuid:${uuid}` } });
  assert.equal(await repository.hostId(), `urn:uuid:${uuid}`);
  store.records.set(key, { kind: 'grant', payload: { version: 1, hostId: 'urn:uuid:invalid' } });
  await assert.rejects(repository.hostId(), { code: 'INVALID_CREDENTIAL' });
});

test('disconnect waits for rotation, revokes the latest session and cannot be overwritten', async () => {
  const oauth = new StubOAuth(); let release!: () => void;
  oauth.refreshGate = new Promise<void>(resolve => { release = resolve; });
  oauth.nextTokens = { ...tokenSet(), refreshToken: 'latest-test-refresh' };
  const f = await fixture({ expired: true, oauth });
  const refreshing = f.manager.activeGrant().catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  const disconnecting = f.manager.disconnect(); release(); await disconnecting;
  assert.equal((await refreshing).code, 'ABORTED');
  assert.equal(oauth.revocations[0]?.refreshToken, 'latest-test-refresh');
  assert.equal((await f.repo.read()).tokens, undefined);
  assert.equal((await f.repo.read()).activeClientId, registration.clientId);
});

test('network refresh errors keep the renewable session, invalid grants remove it', async () => {
  const f = await fixture({ expired: true });
  f.oauth.refreshError = new PlanError('SERVER', 'Temporary outage.');
  await assert.rejects(f.manager.activeGrant(), { code: 'SERVER' });
  assert.equal((await f.repo.read()).tokens?.refreshToken, 'test-refresh-token');
  f.oauth.refreshError = new PlanError('AUTH', 'Reconnect.');
  await assert.rejects(f.manager.activeGrant(), { code: 'AUTH' });
  assert.equal((await f.repo.read()).tokens, undefined);
  assert.equal((await f.manager.status()).state, 'needs-reconnect');
});

test('status never includes token values and unconfirmed revocation is explicit', async () => {
  const f = await fixture();
  const serialized = JSON.stringify(await f.manager.status());
  for (const token of ['test-access-token', 'test-refresh-token', 'test-id-token']) assert.ok(!serialized.includes(token));
  f.oauth.revocationConfirmed = false;
  const result = await f.manager.disconnect();
  assert.equal(result.revocationConfirmed, false); assert.match(result.status.warning!, /not confirmed/);
  assert.equal((await f.repo.read()).tokens, undefined);
});

test('a disconnected profile performs browser sign-in, commits before loading models', async () => {
  const store = new MemoryCredentials(); const repo = new SessionRepository(store, 'sign-in-profile'); const oauth = new StubOAuth();
  const catalog = new StubCatalog();
  const manager = new SessionManager(repo, 'Sign-in', oauth, catalog);
  let opened!: (url: string) => void; const url = new Promise<string>(resolve => { opened = resolve; });
  const signingIn = manager.signIn({ mode: 'connect' }, new AbortController().signal, notice => { if (notice.url) opened(notice.url); });
  const authorization = new URL(await url); const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  assert.match(authorization.searchParams.get('ext_agent_host_id')!, /^urn:uuid:[0-9a-f-]+$/);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'test-code', client_id: registration.clientId }).toString();
  await fetch(callback); await signingIn;
  assert.equal((await manager.status()).state, 'connected'); assert.equal((await manager.status()).preferredModelAvailable, true);
  assert.equal(catalog.refreshes, 0); assert.equal(oauth.refreshes, 0); assert.equal(manager.models()[0]?.name, 'GPT-6.1 Sol');
});

test('missing plan consent retains validated registration but never activates tokens', async () => {
  const store = new MemoryCredentials(); const repo = new SessionRepository(store, 'consent-profile'); const oauth = new StubOAuth(); oauth.nextTokens = { ...tokenSet(), scopes: ['openid'] };
  const manager = new SessionManager(repo, 'Consent', oauth, new StubCatalog());
  let opened!: (url: string) => void; const url = new Promise<string>(resolve => { opened = resolve; });
  const attempt = manager.signIn({ mode: 'connect' }, new AbortController().signal, notice => { if (notice.url) opened(notice.url); });
  const rejected = assert.rejects(attempt, { code: 'INSUFFICIENT_SCOPE' });
  const authorization = new URL(await url); const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'test-code', client_id: registration.clientId }).toString();
  await fetch(callback); await rejected;
  const session = await repo.read(); assert.equal(session.tokens, undefined); assert.equal(session.activeClientId, registration.clientId); assert.equal(session.state, 'needs-reconnect');
});

test('cancellation during browser sign-in leaves no active tokens', async () => {
  const repo = new SessionRepository(new MemoryCredentials(), 'cancel-profile'); const manager = new SessionManager(repo, 'Cancel', new StubOAuth(), new StubCatalog()); const controller = new AbortController();
  const attempt = manager.signIn({ mode: 'connect' }, controller.signal, () => controller.abort());
  await assert.rejects(attempt, { code: 'ABORTED' }); assert.equal((await repo.read()).tokens, undefined);
});

test('incomplete stored consent invalidates tokens even before expiry', async () => {
  const { manager, repo } = await fixture();
  await repo.update(async session => ({ ...session, tokens: { ...session.tokens!, scopes: ['openid', 'chatgpt.tokens.use.direct'] } }));
  await assert.rejects(manager.activeGrant(), { code: 'INSUFFICIENT_SCOPE' });
  assert.equal((await repo.read()).tokens, undefined); assert.equal((await manager.status()).state, 'needs-reconnect');
});

test('cancellation after token exchange revokes the unused grant and retains the issued client', async () => {
  const repo = new SessionRepository(new MemoryCredentials(), 'unused-grant'); const oauth = new StubOAuth(); const controller = new AbortController();
  oauth.exchange = async () => { controller.abort(); return { registration, tokens: tokenSet() }; };
  const manager = new SessionManager(repo, 'Unused grant', oauth, new StubCatalog());
  let open!: (url: string) => void; const url = new Promise<string>(resolve => { open = resolve; });
  const signingIn = manager.signIn({ mode: 'connect' }, controller.signal, notice => { if (notice.url) open(notice.url); });
  const rejected = assert.rejects(signingIn, { code: 'ABORTED' });
  const authorization = new URL(await url); const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'test-code', client_id: registration.clientId }).toString();
  await fetch(callback); await rejected;
  assert.equal(oauth.revocations.length, 1); assert.equal((await repo.read()).tokens, undefined);
  await manager.disconnect(); assert.equal((await repo.read()).pendingClientId, registration.clientId);
});

test('cancelling after activation keeps a valid connected session without catalog HTTP', async () => {
  const repo = new SessionRepository(new MemoryCredentials(), 'late-cancel'); const oauth = new StubOAuth(); const controller = new AbortController();
  const catalog = new StubCatalog(); catalog.initialize = async () => { controller.abort(); };
  const manager = new SessionManager(repo, 'Late cancel', oauth, catalog);
  let open!: (url: string) => void; const url = new Promise<string>(resolve => { open = resolve; });
  const signingIn = manager.signIn({ mode: 'connect' }, controller.signal, notice => { if (notice.url) open(notice.url); });
  const authorization = new URL(await url); const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'test-code', client_id: registration.clientId }).toString();
  await fetch(callback); await signingIn; await manager.waitForAuthorization();
  assert.equal((await manager.status()).state, 'connected'); assert.ok((await repo.read()).tokens); assert.equal(oauth.revocations.length, 0);
});

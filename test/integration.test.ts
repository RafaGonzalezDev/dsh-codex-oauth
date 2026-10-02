import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { Context } from '@deepseek-ai/cordis';
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local';
import { AuthorizationService } from '@deepseek-ai/dsh-authorization';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { SessionManager, SessionRepository } from '../packages/plugin/src/session.ts';
import { StubCatalog, StubOAuth, registration, tokenSet } from './helpers.ts';
import { PI_CATALOG_URL } from '../packages/plugin/src/models.ts';
import * as plugin from '../packages/plugin/lib/index.js';
import { TYPERT_REMOTE } from '../packages/plugin/lib/typert.remote-client.js';

const require = createRequire(import.meta.url);

function windowsSecurity(script: string, path: string): string {
  // Do not mix PowerShell 7 module paths into Windows PowerShell 5.1.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${script}`], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true, env: { ...env, DSH_TEST_CREDENTIAL_PATH: path },
  });
}

function preparePrivateFixtureDirectory(directory: string): void {
  if (process.platform !== 'win32') return;
  assert.ok(directory.startsWith(join(tmpdir(), 'dsh-plan-credentials-')));
  // mkdtemp is private on POSIX. On Windows explicitly secure ONLY this new
  // synthetic fixture root; the machine's shared TEMP ACL may be broader.
  windowsSecurity(`
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($owner)
    foreach ($id in @($owner.Value, 'S-1-5-18', 'S-1-5-32-544')) {
      $sid = [System.Security.Principal.SecurityIdentifier]::new($id)
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $env:DSH_TEST_CREDENTIAL_PATH -AclObject $acl
  `, directory);
}

async function assertPrivateCredentialFile(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    return;
  }
  // Windows storage inherits the private profile DACL, not POSIX mode bits.
  const acl = JSON.parse(windowsSecurity(`
    $acl = Get-Acl -LiteralPath $env:DSH_TEST_CREDENTIAL_PATH
    $sid = [System.Security.Principal.SecurityIdentifier]
    [pscustomobject]@{
      user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object {
        [pscustomobject]@{ sid = $_.IdentityReference.Value; allow = ($_.AccessControlType -eq 'Allow'); inheritOnly = (($_.PropagationFlags -band 2) -ne 0); rights = [int]$_.FileSystemRights }
      })
    } | ConvertTo-Json -Depth 4 -Compress
  `, path)) as { user: string; rules: Array<{ sid: string; allow: boolean; inheritOnly: boolean; rights: number }> };
  const trusted = new Set([acl.user, 'S-1-5-18', 'S-1-5-32-544']);
  const grants = acl.rules.filter(rule => rule.allow && !rule.inheritOnly);
  assert.ok(grants.some(rule => rule.sid === acl.user && (rule.rights & 1) !== 0), 'The current user can read its credential file.');
  for (const rule of grants) assert.ok(trusted.has(rule.sid), `Unexpected credential file ACL principal: ${rule.sid}`);
}

test('native credentials serialize concurrent rotating tokens, persist privately, and survive reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-plan-credentials-'));
  preparePrivateFixtureDirectory(directory);
  const path = join(directory, '.credentials.yaml'); const first = new Context(); const second = new Context();
  const one = first.plugin(LocalCredentialProvider, { path, watch: false }); await one;
  const two = second.plugin(LocalCredentialProvider, { path, watch: false }); await two;
  try {
    const repo = new SessionRepository(first.credentials, 'native-profile');
    await repo.update(async () => ({ version: 1, generation: 1, state: 'connected', activeClientId: registration.clientId, registrations: [registration], tokens: tokenSet(true), models: [] }));
    const oauth = new StubOAuth(); const left = new SessionManager(repo, 'Native', oauth, new StubCatalog());
    const rightRepo = new SessionRepository(second.credentials, 'native-profile'); const right = new SessionManager(rightRepo, 'Native', oauth, new StubCatalog());
    await left.initialize(); await right.initialize();
    const grants = await Promise.all([left.activeGrant(), right.activeGrant(), left.activeGrant()]);
    assert.equal(oauth.refreshes, 1); assert.ok(grants.every(grant => grant.tokens.refreshToken === oauth.nextTokens.refreshToken));
    await assertPrivateCredentialFile(path);
    const text = await readFile(path, 'utf8'); assert.ok(text.includes('test-refresh-token'));
    const isolated = new SessionRepository(first.credentials, 'other-profile'); assert.equal((await isolated.read()).state, 'disconnected');
    await left.disconnect(); assert.equal((await repo.read()).tokens, undefined);
    await two.dispose(); const fresh = second.plugin(LocalCredentialProvider, { path, watch: false }); await fresh;
    assert.equal((await new SessionRepository(second.credentials, 'native-profile').read()).tokens, undefined); await fresh.dispose();
  } finally { await one.dispose(); await two.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('the compiled external Host mounts native RPC without waiting for catalog HTTP and unloads cleanly', async t => {
  const startup = t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    assert.equal(String(input), PI_CATALOG_URL);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal; assert.ok(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const directory = await mkdtemp(join(tmpdir(), 'dsh-plan-host-')); const ctx = new Context();
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(directory, '.credentials.yaml'), watch: false }); await credentials;
  const authorization = ctx.plugin(AuthorizationService); await authorization;
  const llm = ctx.plugin(LlmRuntime); await llm;
  ctx.provide('profileContext'); ctx.set('profileContext', { name: 'external-host-test', dir: directory });
  ctx.provide('attachments'); ctx.set('attachments', { imageLimits: { maxImageBytes: 1000 } });
  const instance = ctx.plugin(plugin); await instance;
  try {
    assert.equal((await ctx.chatgptPlan.getStatus()).state, 'disconnected');
    assert.equal(ctx.authorization.list().length, 1);
    const status = await ctx.chatgptPlan.disconnect(); assert.equal(status.status.state, 'disconnected');
    const stream = ctx.chatgptPlan.authorize({ mode: 'connect' }, new AbortController().signal);
    const notice = await stream.next(); assert.equal(notice.value.type, 'notice');
    await ctx.chatgptPlan.cancel();
    const events = [notice.value]; for await (const event of stream) events.push(event);
    assert.equal(events.at(-1).outcome, 'cancelled');
    assert.equal(startup.mock.callCount(), 1);
    assert.equal((await ctx.chatgptPlan.getStatus()).catalog?.source, 'pi');
    await instance.dispose(); assert.equal(ctx.authorization.list().length, 0); assert.equal(ctx.get('chatgptPlan'), undefined);
  } finally { await instance.dispose(); await llm.dispose(); await authorization.dispose(); await credentials.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('native generated RPC descriptors expose only the intended token-free public contract', () => {
  assert.deepEqual(TYPERT_REMOTE.descriptors.map(method => method.method).sort(), ['authorize', 'cancel', 'disconnect', 'getStatus', 'refreshModels']);
  const status = TYPERT_REMOTE.descriptors.find(method => method.method === 'getStatus')!;
  const schema = status.result.create();
  const value = schema.parse({ state: 'disconnected', profile: 'test', models: [], preferredModelAvailable: false, accessToken: 'must-not-cross-rpc', catalog: { source: 'pi', sourceUrl: PI_CATALOG_URL, loadedFrom: 'cache', revision: 'test-revision', lastCheckedAt: 123, refreshing: false, accessToken: 'must-not-cross-rpc' } });
  assert.equal('accessToken' in value, false); assert.equal('accessToken' in value.catalog!, false);
  assert.equal(value.catalog?.source, 'pi'); assert.equal(value.catalog?.revision, 'test-revision');
  const authorization = TYPERT_REMOTE.descriptors.find(method => method.method === 'authorize')!;
  assert.equal(authorization.mode, 'stream'); assert.equal(authorization.cancellation?.parameter, 'signal');
  assert.equal(JSON.stringify(TYPERT_REMOTE).includes('refreshToken'), false);
});

test('the Client is a native lazy-CJS factory and imports neither secrets nor Node or OAuth code', async () => {
  const source = await readFile(new URL('../packages/plugin/lib/client.js', import.meta.url), 'utf8'); let contribution: any;
  runInNewContext(source, { window: { __ModuleLoader__: { load: (value: unknown) => { contribution = value; } } } });
  assert.equal(contribution.id, 'dsh-chatgpt-plan');
  const requested: string[] = []; const client = contribution.factory((name: string) => { requested.push(name); return require(name); });
  assert.deepEqual([...requested].sort(), ['react', 'react/jsx-runtime']); assert.equal(typeof client.apply, 'function');
  assert.deepEqual([...client.inject], ['slots', 'remote']);
  for (const forbidden of ['node:crypto', 'node:http', 'accessToken', 'refreshToken', 'auth.openai.com']) assert.equal(source.includes(forbidden), false);
});

test('the compiled Client shares sidebar and Models state across Host updates and disconnect', async () => {
  let contribution: any; let reads = 0; let disconnects = 0;
  let readFailure: 'throw' | 'result' | undefined;
  const registrations = new Map<string, { options: any; component: Function }>();
  const injectedSlots: string[] = [];
  const hostListeners = new Map<string, () => void>();
  let status = { state: 'connected', profile: 'test', models: [], preferredModelAvailable: false };
  const source = await readFile(new URL('../packages/plugin/lib/client.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window: { location: { hostname: '127.0.0.1' }, __ModuleLoader__: { load: (value: unknown) => { contribution = value; } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  });
  const client = contribution.factory(require); const ctx = new Context();
  ctx.provide('remote'); ctx.set('remote', {
    $mount: async () => () => {},
    $on: (name: string, listener: () => void) => {
      hostListeners.set(name, listener); return () => { hostListeners.delete(name); };
    },
    chatgptPlan: {
      getStatus: async () => {
        reads++;
        if (readFailure === 'throw') throw new Error('Connection is not ready');
        if (readFailure === 'result') return { ok: false, error: { message: 'Connection is not ready' } };
        return { ok: true, value: status };
      },
      disconnect: async () => {
        disconnects++; status = { ...status, state: 'disconnected' };
        return { ok: true, value: { status } };
      },
    },
  });
  ctx.provide('remote.chatgptPlan'); ctx.set('remote.chatgptPlan', ctx.remote.chatgptPlan);
  ctx.provide('slots'); ctx.set('slots', {
    inject: (name: string, install: () => void) => { injectedSlots.push(name); install(); },
    register: (options: any, component: Function) => {
      const key = `${options.name}:${options.id}`;
      assert.equal(registrations.has(key), false, `Duplicate registration: ${key}`);
      registrations.set(key, { options, component });
    },
  });
  const instance = ctx.plugin(client); await instance;
  const subscriptions: (() => void)[] = [];
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...registrations.keys()].sort(), ['settings.models.footer:chatgpt-plan', 'shell.overlay:chatgpt-plan-onboarding', 'sidebar.footer.action:chatgpt-plan']);
    assert.deepEqual(injectedSlots.sort(), ['settings.models.footer', 'shell.overlay', 'sidebar.footer.action']);
    const panel = registrations.get('settings.models.footer:chatgpt-plan')!;
    const sidebar = registrations.get('sidebar.footer.action:chatgpt-plan')!;
    const overlay = registrations.get('shell.overlay:chatgpt-plan-onboarding')!;
    assert.equal(panel.options.order, 10); assert.equal(sidebar.options.order, 10); assert.equal(overlay.options.order, 100);
    assert.equal(typeof panel.component, 'function'); assert.equal(typeof sidebar.component, 'function'); assert.equal(typeof overlay.component, 'function');
    assert.notEqual(panel.component, sidebar.component);
    assert.notEqual(overlay.component, panel.component); assert.notEqual(overlay.component, sidebar.component);
    const panelProps = panel.options.inject(); const sidebarProps = sidebar.options.inject(); const overlayProps = overlay.options.inject();
    const observable = panelProps.hooks.connection;
    assert.equal(sidebarProps.hooks.connection, observable);
    assert.equal(overlayProps.hooks.connection, observable);
    assert.equal(observable.getSnapshot().status.state, 'connected');
    let panelUpdates = 0; let sidebarUpdates = 0;
    subscriptions.push(observable.subscribe(() => { panelUpdates++; }));
    subscriptions.push(sidebarProps.hooks.connection.subscribe(() => { sidebarUpdates++; }));
    await new Promise(resolve => setImmediate(resolve));
    const update = hostListeners.get('llm/adapters-updated'); assert.ok(update);
    for (const failure of ['throw', 'result'] as const) {
      readFailure = failure; update();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(observable.getSnapshot().status, undefined, `Clear stale connected state after ${failure}`);
      assert.equal(sidebarProps.hooks.connection.getSnapshot().status, undefined);
      assert.equal(typeof observable.getSnapshot().message, 'string');
      assert.equal(sidebar.component({ wide: true, useConnection: (select: Function) => select(observable.getSnapshot()) }), null);
      readFailure = undefined; update();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(observable.getSnapshot().status.state, 'connected');
      assert.equal(sidebarProps.hooks.connection.getSnapshot().status.state, 'connected');
      assert.equal(observable.getSnapshot().message, undefined);
    }
    panelUpdates = 0; sidebarUpdates = 0;
    status = { ...status, state: 'needs-reconnect' };
    const previousReads = reads; update();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, previousReads + 1);
    assert.equal(observable.getSnapshot().status.state, 'needs-reconnect');
    assert.equal(sidebarProps.hooks.connection.getSnapshot(), observable.getSnapshot());
    assert.equal(panelUpdates, 1); assert.equal(sidebarUpdates, 1);
    panelProps.disconnect();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disconnects, 1);
    assert.equal(observable.getSnapshot().status.state, 'disconnected');
    assert.equal(sidebarProps.hooks.connection.getSnapshot().status.state, 'disconnected');
    assert.equal(observable.getSnapshot().busy, false);
    assert.ok(panelUpdates > 1); assert.equal(sidebarUpdates, panelUpdates);
    overlayProps.acknowledgeOnboarding();
    assert.equal(observable.getSnapshot().acknowledgedCopyVersion, 1);
  } finally { for (const unsubscribe of subscriptions) unsubscribe(); await instance.dispose(); }
  assert.equal(hostListeners.size, 0);
});

test('the compiled Client recovers when the panel mounts after connection startup', async () => {
  let contribution: any; let reads = 0;
  const registrations = new Map<string, any>();
  const source = await readFile(new URL('../packages/plugin/lib/client.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window: { location: { hostname: '127.0.0.1' }, __ModuleLoader__: { load: (value: unknown) => { contribution = value; } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  });
  const client = contribution.factory(require); const ctx = new Context();
  ctx.provide('remote'); ctx.set('remote', {
    $mount: async () => () => {}, $on: () => () => {},
    chatgptPlan: { getStatus: async () => {
      reads++; if (reads === 1) throw new Error('Connection is not ready');
      return { ok: true, value: { state: 'disconnected', profile: 'test', models: [], preferredModelAvailable: false } };
    } },
  });
  ctx.provide('remote.chatgptPlan'); ctx.set('remote.chatgptPlan', ctx.remote.chatgptPlan);
  ctx.provide('slots'); ctx.set('slots', {
    inject: (_name: string, install: () => void) => install(),
    register: (options: any) => { registrations.set(`${options.name}:${options.id}`, options); },
  });
  const instance = ctx.plugin(client); await instance;
  try {
    await new Promise(resolve => setImmediate(resolve));
    const observable = registrations.get('settings.models.footer:chatgpt-plan').inject().hooks.connection;
    assert.equal(registrations.get('sidebar.footer.action:chatgpt-plan').inject().hooks.connection, observable);
    assert.equal(observable.getSnapshot().status, undefined);
    const unsubscribe = observable.subscribe(() => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observable.getSnapshot().status.state, 'disconnected'); assert.equal(observable.getSnapshot().message, undefined); assert.equal(reads, 2); unsubscribe();
  } finally { await instance.dispose(); }
});

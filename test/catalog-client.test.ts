import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Context } from '@deepseek-ai/cordis';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { AuthorizationEvent, ConnectionStatus, DisconnectResult } from '../packages/plugin/src/contracts.ts';
import type { PanelInjected, PanelState } from '../packages/plugin/src/client/Panel.tsx';

const require = createRequire(import.meta.url);
type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
type Element = ReactElement<Record<string, any>>;

function success<T>(value: T): Result<T> { return { ok: true, value }; }

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

// Drain scheduled continuations once per controlled operation, without polling or sleeping.
function turn(): Promise<void> { return new Promise(resolve => setImmediate(resolve)); }

function status(state: ConnectionStatus['state'] = 'connected'): ConnectionStatus {
  return {
    state, profile: 'client-test', preferredModelAvailable: state === 'connected',
    ...(state === 'connected' ? { account: { label: 'Original account' } } : {}),
    models: state === 'connected'
      ? [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', available: true, inputModalities: ['text', 'image'] }]
      : [],
    catalog: {
      source: 'pi', sourceUrl: 'https://pi.dev/api/models/providers/openai-codex?types=chat',
      loadedFrom: 'cache', revision: 'a'.repeat(64), refreshing: false,
      lastCheckedAt: Date.parse('2026-10-01T10:00:00Z'), lastUpdatedAt: Date.parse('2026-10-01T09:00:00Z'),
    },
  };
}

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).filter(Boolean).join(' ');
  if (isValidElement<Record<string, any>>(node)) return text(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

function button(node: ReactNode, label: string): Element {
  const found = elements(node).find(item => item.type === 'button' && text(item) === label);
  assert.ok(found, `Expected a native button labelled ${label}`);
  return found;
}

async function mountClient(initial = status()) {
  let contribution: any;
  const registrations = new Map<string, { options: any; component: Function }>();
  const hostListeners = new Map<string, () => void>();
  const calls = { reads: 0, refreshes: 0, disconnects: 0, authorizations: 0 };
  let current = structuredClone(initial);
  const refresh = deferred<Result<ConnectionStatus>>();
  const authorizationFinished = deferred<void>();
  const authorizationNotice = 'Complete the test authorization in your browser.';
  const authorizationUrl = 'https://auth.openai.com/authorize?test=fictional';
  const handlers = {
    getStatus: async (): Promise<Result<ConnectionStatus>> => success(structuredClone(current)),
    disconnect: async (): Promise<Result<DisconnectResult>> => {
      current = { ...current, state: 'disconnected', models: [], preferredModelAvailable: false };
      return success({ status: structuredClone(current), revocationConfirmed: true });
    },
  };
  const source = await readFile(new URL('../packages/plugin/lib/client.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window: {
      location: { hostname: '127.0.0.1' }, open() {},
      __ModuleLoader__: { load: (value: unknown) => { contribution = value; } },
    },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  });
  const client = contribution.factory(require);
  const ctx = new Context();
  ctx.provide('remote');
  ctx.set('remote', {
    $mount: async () => () => {},
    $on: (name: string, listener: () => void) => {
      assert.equal(hostListeners.has(name), false);
      hostListeners.set(name, listener);
      return () => { hostListeners.delete(name); };
    },
    chatgptPlan: {
      getStatus: () => { calls.reads++; return handlers.getStatus(); },
      refreshModels: () => { calls.refreshes++; return refresh.promise; },
      disconnect: () => { calls.disconnects++; return handlers.disconnect(); },
      authorize: () => {
        calls.authorizations++;
        current = { ...current, state: 'authorizing' };
        const stream = (async function* (): AsyncGenerator<AuthorizationEvent> {
          yield { type: 'status', status: structuredClone(current) };
          yield { type: 'notice', message: authorizationNotice, url: authorizationUrl };
          await authorizationFinished.promise;
          yield { type: 'status', status: structuredClone(current) };
        })();
        return Object.assign(stream, { dispose: () => { authorizationFinished.resolve(); } });
      },
      cancel: async () => { authorizationFinished.resolve(); },
    },
  });
  ctx.provide('remote.chatgptPlan'); ctx.set('remote.chatgptPlan', ctx.remote.chatgptPlan);
  ctx.provide('slots');
  ctx.set('slots', {
    inject: (_name: string, install: () => void) => install(),
    register: (options: any, component: Function) => {
      registrations.set(`${options.name}:${options.id}`, { options, component });
    },
  });
  const instance = ctx.plugin(client);
  await instance;
  await turn();
  const panel = registrations.get('settings.models.footer:chatgpt-plan');
  const sidebar = registrations.get('sidebar.footer.action:chatgpt-plan');
  assert.ok(panel); assert.ok(sidebar);
  const props = panel.options.inject() as PanelInjected;
  const observable = props.hooks.connection;
  assert.equal(sidebar.options.inject().hooks.connection, observable);
  const snapshots: PanelState[] = [];
  const unsubscribe = observable.subscribe(() => { snapshots.push(observable.getSnapshot()); });
  await turn();
  snapshots.length = 0;
  return {
    calls, props, handlers, refresh, snapshots, authorizationNotice, authorizationUrl,
    snapshot: () => observable.getSnapshot(),
    setStatus: (value: ConnectionStatus) => { current = structuredClone(value); },
    finishAuthorization: () => { authorizationFinished.resolve(); },
    adaptersUpdated: () => {
      const listener = hostListeners.get('llm/adapters-updated');
      assert.ok(listener);
      listener();
    },
    render: () => panel.component({ ...props, useConnection: (select: (value: PanelState) => unknown) => select(observable.getSnapshot()) }) as ReactNode,
    dispose: async () => {
      unsubscribe();
      await instance.dispose();
      authorizationFinished.resolve();
      refresh.resolve(success(current));
      await turn();
      assert.equal(hostListeners.size, 0);
    },
  };
}

test('a late catalog RPC result cannot restore a connected account after disconnect', async () => {
  const initial = status();
  const client = await mountClient(initial);
  try {
    client.props.refresh();
    client.props.refresh();
    assert.equal(client.calls.refreshes, 1, 'Coalesce repeated clicks while updating');
    assert.equal(client.snapshot().busy, false);
    assert.equal(client.snapshot().updatingModels, true);
    client.props.disconnect();
    await turn();
    assert.equal(client.snapshot().status?.state, 'disconnected');
    client.snapshots.length = 0;
    const reads = client.calls.reads;
    client.refresh.resolve(success(initial));
    await turn();
    assert.equal(client.calls.reads, reads + 1, 'Read current status instead of applying a stale RPC payload');
    assert.equal(client.snapshot().status?.state, 'disconnected');
    assert.equal(client.snapshot().busy, false);
    assert.equal(client.snapshot().updatingModels, false);
    assert.ok(client.snapshots.every(value => value.status?.state === 'disconnected'));
  } finally { await client.dispose(); }
});

test('catalog completion cannot clear the busy state of an in-flight disconnect', async () => {
  const initial = status();
  const client = await mountClient(initial);
  const disconnect = deferred<Result<DisconnectResult>>();
  client.handlers.disconnect = () => disconnect.promise;
  try {
    client.props.refresh();
    client.props.disconnect();
    assert.equal(client.snapshot().busy, true);
    client.refresh.resolve(success(initial));
    await turn();
    assert.equal(client.snapshot().busy, true);
    assert.equal(client.snapshot().updatingModels, false);
    assert.equal(button(client.render(), 'Disconnect').props.disabled, true);
    const disconnected = status('disconnected');
    client.setStatus(disconnected);
    disconnect.resolve(success({ status: disconnected, revocationConfirmed: true }));
    await turn();
    assert.equal(client.snapshot().status?.state, 'disconnected');
    assert.equal(client.snapshot().busy, false);
  } finally { await client.dispose(); }
});

test('a catalog-triggered status read started before disconnect cannot overwrite its committed result', async () => {
  const initial = status();
  const client = await mountClient(initial);
  const staleRead = deferred<Result<ConnectionStatus>>();
  try {
    client.props.refresh();
    client.handlers.getStatus = () => staleRead.promise;
    const reads = client.calls.reads;
    client.refresh.resolve(success(initial));
    await turn();
    assert.equal(client.calls.reads, reads + 1);
    client.props.disconnect();
    await turn();
    assert.equal(client.snapshot().status?.state, 'disconnected');
    client.snapshots.length = 0;
    staleRead.resolve(success(initial));
    await turn();
    assert.equal(client.snapshot().status?.state, 'disconnected');
    assert.equal(client.snapshot().busy, false);
    assert.equal(client.snapshots.length, 0, 'Invalidate the old read rather than publishing it');
  } finally { await client.dispose(); }
});

for (const completion of ['during sign-in', 'after sign-in'] as const) {
  test(`a stale catalog result ${completion} preserves the current account and authorization state`, async () => {
    const initial = status('disconnected');
    const client = await mountClient(initial);
    try {
      client.props.refresh();
      client.props.connect(false);
      await turn();
      assert.equal(client.snapshot().status?.state, 'authorizing');
      assert.equal(client.snapshot().busy, true);
      assert.equal(client.snapshot().message, client.authorizationNotice);
      if (completion === 'after sign-in') {
        client.setStatus({ ...status(), account: { label: 'New account' } });
        client.finishAuthorization();
        await turn();
        assert.equal(client.snapshot().status?.account?.label, 'New account');
        assert.equal(client.snapshot().busy, false);
      }
      client.refresh.resolve(success(initial));
      await turn();
      assert.equal(client.snapshot().updatingModels, false);
      assert.equal(client.snapshot().message, client.authorizationNotice);
      if (completion === 'during sign-in') {
        assert.equal(client.snapshot().status?.state, 'authorizing');
        assert.equal(client.snapshot().busy, true, 'Catalog completion must not settle the authorization flow');
        assert.equal(client.snapshot().authorizationUrl, client.authorizationUrl);
        assert.notEqual(button(client.render(), 'Cancel sign-in').props.disabled, true);
      } else {
        assert.equal(client.snapshot().status?.state, 'connected');
        assert.equal(client.snapshot().status?.account?.label, 'New account');
        assert.equal(client.snapshot().busy, false);
        assert.equal(client.snapshot().authorizationUrl, undefined);
      }
    } finally { await client.dispose(); }
  });
}

for (const failure of ['result', 'throw'] as const) {
  test(`a catalog ${failure} failure keeps the OAuth notice, URL and busy state separate`, async () => {
    const initial = status('needs-reconnect');
    initial.warning = 'The account requires renewed consent.';
    initial.errorCode = 'INSUFFICIENT_SCOPE';
    const client = await mountClient(initial);
    try {
      client.props.refresh();
      client.props.connect(false);
      await turn();
      if (failure === 'result') client.refresh.resolve({ ok: false, error: { message: 'Synthetic catalog transport failure' } });
      else client.refresh.reject(new Error('Synthetic catalog transport failure'));
      await turn();
      assert.equal(client.snapshot().status?.state, 'authorizing');
      assert.equal(client.snapshot().busy, true);
      assert.equal(client.snapshot().updatingModels, false);
      assert.equal(client.snapshot().message, client.authorizationNotice);
      assert.equal(client.snapshot().authorizationUrl, client.authorizationUrl);
      assert.equal(client.snapshot().status?.warning, initial.warning);
      assert.equal(client.snapshot().status?.errorCode, 'INSUFFICIENT_SCOPE');
      assert.equal(typeof client.snapshot().catalogMessage, 'string');
      const region = elements(client.render()).find(item => item.type === 'section' && item.props['aria-label'] === 'Model catalog');
      assert.ok(region);
      assert.ok(text(region).includes(client.snapshot().catalogMessage!));
      assert.ok(!text(region).includes(client.authorizationNotice));
    } finally { await client.dispose(); }
  });
}

test('the existing adapter update event rereads catalog names, provenance and freshness without another refresh RPC', async () => {
  const initial = status();
  initial.models[0]!.name = 'Old catalog label';
  initial.catalog!.warning = 'A previous catalog check failed.';
  const client = await mountClient(initial);
  try {
    const next = status();
    next.catalog = {
      ...next.catalog!, loadedFrom: 'remote', revision: 'b'.repeat(64),
      lastCheckedAt: Date.parse('2026-10-01T12:30:00Z'), lastUpdatedAt: Date.parse('2026-10-01T12:00:00Z'),
    };
    client.setStatus(next);
    const reads = client.calls.reads;
    client.adaptersUpdated();
    await turn();
    assert.equal(client.calls.reads, reads + 1);
    assert.equal(client.calls.refreshes, 0);
    assert.equal(client.snapshot().status?.models[0]?.id, 'gpt-6.1-sol');
    assert.equal(client.snapshot().status?.models[0]?.name, 'GPT-6.1 Sol');
    assert.equal(client.snapshot().status?.catalog?.revision, next.catalog.revision);
    assert.equal(client.snapshot().status?.catalog?.loadedFrom, 'remote');
    assert.equal(client.snapshot().status?.catalog?.warning, undefined);
    const nodes = elements(client.render());
    assert.ok(nodes.some(item => item.type === 'strong' && text(item) === 'GPT-6.1 Sol'));
    assert.ok(nodes.some(item => item.type === 'span' && text(item) === 'Remote catalog'));
    assert.ok(nodes.some(item => item.type === 'code' && item.props.title === next.catalog!.revision));
    assert.deepEqual(nodes.filter(item => item.type === 'time').map(item => item.props.dateTime), [
      '2026-10-01T12:30:00.000Z', '2026-10-01T12:00:00.000Z',
    ]);
    assert.ok(!text(client.render()).includes('Old catalog label'));
  } finally { await client.dispose(); }
});

for (const accountState of ['connected', 'disconnected'] as const) {
  test(`automatic catalog progress only disables the catalog CTA for a ${accountState} account`, async () => {
    const initial = status(accountState);
    initial.catalog!.refreshing = true;
    const client = await mountClient(initial);
    try {
      assert.equal(client.snapshot().busy, false);
      const tree = client.render();
      const update = button(tree, 'Update models now');
      assert.equal(update.props.disabled, true);
      assert.equal(update.props['aria-busy'], true);
      const accountAction = accountState === 'connected' ? 'Disconnect' : 'Continue with ChatGPT';
      assert.equal(button(tree, accountAction).props.disabled, false);
      client.props.refresh();
      assert.equal(client.calls.refreshes, 0, 'Do not start a redundant RPC while the Host is already refreshing');
      initial.catalog!.refreshing = false;
      client.setStatus(initial);
      client.adaptersUpdated();
      await turn();
      assert.equal(button(client.render(), 'Update models now').props.disabled, false);
      assert.equal(client.snapshot().busy, false);
    } finally { await client.dispose(); }
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { ConnectionPanel, type PanelInjected, type PanelState } from '../packages/plugin/src/client/Panel.tsx';
import type { CatalogInfo, ConnectionStatus } from '../packages/plugin/src/contracts.ts';

type Element = ReactElement<Record<string, any>>;

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

function element(node: ReactNode, type: string, label: string): Element {
  const found = elements(node).find(item => item.type === type && text(item) === label);
  assert.ok(found, `Expected a ${type} containing ${label}`);
  return found;
}

function render(state: PanelState, actions: Partial<PanelInjected> = {}) {
  let subscriptions = 0;
  // Root-level tsx tests use classic JSX rather than the Client build's automatic runtime.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  try {
    const result = ConnectionPanel({
      local: true, connect: () => {}, cancel: () => {}, disconnect: () => {}, refresh: () => {},
      ...actions,
      useConnection: <T,>(selector: (value: PanelState) => T) => { subscriptions++; return selector(state); },
    } as Parameters<typeof ConnectionPanel>[0]);
    assert.equal(subscriptions, 1, 'Use the shared connection observable without another data source');
    return result;
  } finally {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  }
}

function catalog(overrides: Partial<CatalogInfo> = {}): CatalogInfo {
  return {
    source: 'pi', sourceUrl: 'https://pi.dev/api/models/providers/openai-codex?types=chat',
    loadedFrom: 'remote', revision: 'abcdef0123456789abcdef0123456789', refreshing: false,
    ...overrides,
  };
}

function state(overrides: Partial<ConnectionStatus> = {}): PanelState {
  return {
    busy: false,
    status: {
      state: 'connected', profile: 'test', preferredModelAvailable: true, catalog: catalog(),
      models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', available: true, inputModalities: ['text', 'image'] }],
      ...overrides,
    },
  };
}

for (const [loadedFrom, label] of [
  ['bundled', 'Bundled snapshot'], ['cache', 'Cached catalog'], ['remote', 'Remote catalog'],
] as const) {
  test(`the panel identifies Pi and the current ${loadedFrom} source in text`, () => {
    const result = render(state({ catalog: catalog({ loadedFrom }) }));
    element(result, 'span', 'Pi catalog');
    element(result, 'span', label);
    const link = element(result, 'a', 'View Pi catalog source (opens in a new tab)');
    assert.equal(link.props.href, catalog().sourceUrl);
    assert.equal(link.props.target, '_blank');
    assert.deepEqual(link.props.rel.split(/\s+/).sort(), ['noopener', 'noreferrer']);
    assert.ok(text(result).includes('Listed models are not a guarantee of access'));
  });
}

test('catalog revision is short visually and complete in its title, with machine-readable dates', () => {
  const lastCheckedAt = Date.parse('2026-10-01T12:30:00Z');
  const lastUpdatedAt = Date.parse('2026-10-01T10:00:00Z');
  const result = render(state({ catalog: catalog({ lastCheckedAt, lastUpdatedAt }) }));
  const revision = element(result, 'code', catalog().revision.slice(0, 12));
  assert.equal(revision.props.title, catalog().revision);
  assert.deepEqual(elements(result).filter(item => item.type === 'time').map(item => item.props.dateTime), [
    '2026-10-01T12:30:00.000Z', '2026-10-01T10:00:00.000Z',
  ]);
  element(result, 'dt', 'Last checked');
  element(result, 'dt', 'Last updated');
});

test('missing catalog dates use a readable placeholder rather than a fabricated check', () => {
  const result = render(state());
  assert.equal(elements(result).filter(item => item.type === 'time').length, 0);
  assert.equal(elements(result).filter(item => item.type === 'dd' && text(item) === 'Not yet recorded').length, 2);
});

test('a Host without optional catalog metadata remains usable without claiming a Pi revision', () => {
  const value = state();
  delete value.status!.catalog;
  const result = render(value);
  element(result, 'p', 'Catalog source details are not available from this Host.');
  element(result, 'strong', 'GPT-6.1 Sol');
  assert.equal(element(result, 'button', 'Update models now').props.disabled, false);
  assert.equal(elements(result).filter(item => item.type === 'time').length, 0);
  assert.equal(elements(result).filter(item => item.type === 'span' && text(item) === 'Pi catalog').length, 0);
});

test('the panel preserves human names and technical model IDs without aliases', () => {
  const result = render(state());
  element(result, 'strong', 'GPT-6.1 Sol');
  element(result, 'code', 'gpt-6.1-sol');
  element(result, 'span', 'text + image');
  assert.ok(!text(result).includes('official account catalog'));
  assert.ok(!text(result).includes('Account models'));
});

test('an empty valid catalog is explained and exposes a native update action', () => {
  let updates = 0;
  let accountActions = 0;
  const result = render(state({ models: [], preferredModelAvailable: false }), {
    refresh: () => { updates++; }, connect: () => { accountActions++; }, disconnect: () => { accountActions++; },
  });
  element(result, 'p', 'The current catalog has no selectable models. Use Update models now to check Pi again.');
  element(result, 'p', 'GPT-6.1 Sol is not selectable in the local catalog. No model has been substituted.');
  assert.equal(elements(result).filter(item => item.type === 'li').length, 0);
  const update = element(result, 'button', 'Update models now');
  assert.equal(update.props.type, 'button');
  assert.equal(update.props.disabled, false);
  update.props.onClick();
  assert.equal(updates, 1);
  assert.equal(accountActions, 0);
});

for (const progressSource of ['host', 'client'] as const) {
  test(`${progressSource} catalog progress disables only the update action, not the account controls`, () => {
    const value = state({ catalog: catalog({ refreshing: progressSource === 'host' }) });
    value.updatingModels = progressSource === 'client';
    const result = render(value);
    const update = element(result, 'button', 'Update models now');
    assert.equal(update.props.disabled, true);
    assert.equal(update.props['aria-busy'], true);
    assert.equal(element(result, 'button', 'Disconnect').props.disabled, false);
    element(result, 'strong', 'GPT-6.1 Sol');
    const live = elements(result).find(item => item.props.role === 'status' && text(item).includes('Checking Pi for model updates'));
    assert.ok(live);
    assert.equal(live.props['aria-live'], 'polite');
    assert.equal(live.props['aria-atomic'], 'true');
  });
}

test('catalog updates stay separate from sign-in and cancellation state', () => {
  const value = state({ state: 'authorizing', catalog: catalog({ refreshing: true }) });
  value.busy = true;
  value.authorizationUrl = 'https://auth.openai.com/authorize';
  const result = render(value);
  assert.equal(element(result, 'button', 'Continue with ChatGPT').props.disabled, true);
  assert.equal(element(result, 'button', 'Update models now').props.disabled, true);
  assert.notEqual(element(result, 'button', 'Cancel sign-in').props.disabled, true);
  assert.equal(element(result, 'a', 'Open sign-in page').props.href, value.authorizationUrl);
});

test('a disconnected account can update metadata without blocking sign-in', () => {
  const result = render(state({ state: 'disconnected', catalog: catalog({ refreshing: true }) }));
  assert.equal(element(result, 'button', 'Continue with ChatGPT').props.disabled, false);
  assert.equal(element(result, 'button', 'Update models now').props.disabled, true);
  element(result, 'span', 'Pi catalog');
});

test('fallback warnings and catalog RPC errors do not become OAuth errors', () => {
  const fallback = 'Pi is unavailable. Using the last valid cached catalog.';
  const authWarning = 'Reconnect to restore account access.';
  const value = state({ state: 'needs-reconnect', warning: authWarning, catalog: catalog({ loadedFrom: 'cache', warning: fallback }) });
  value.catalogMessage = 'The Host could not be reached for the catalog update.';
  const result = render(value);
  const catalogRegion = elements(result).find(item => item.type === 'section' && item.props['aria-label'] === 'Model catalog');
  assert.ok(catalogRegion);
  assert.ok(text(catalogRegion).includes(fallback));
  assert.ok(text(catalogRegion).includes(value.catalogMessage));
  assert.ok(!text(catalogRegion).includes(authWarning));
  assert.ok(elements(catalogRegion).some(item => item.props.role === 'status'));
  assert.equal(element(result, 'p', authWarning).props.role, 'alert');
  element(result, 'span', 'Reconnect required');
});

test('unknown Host status does not offer a misleading catalog update', () => {
  const result = render({ busy: false });
  assert.equal(element(result, 'button', 'Update models now').props.disabled, true);
  element(result, 'span', 'Loading connection status…');
  element(result, 'p', 'Catalog source details are not available from this Host.');
});

test('the quota wording and usage destination remain unchanged', () => {
  const result = render(state());
  element(result, 'p', 'Usage is charged to your ChatGPT plan and any credits you have enabled for this app in ChatGPT settings.');
  assert.equal(element(result, 'a', 'ChatGPT Settings → Usage').props.href, 'https://chatgpt.com/settings/usage');
});

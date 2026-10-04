import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { ChatGPTSidebarNotice } from '../packages/plugin/src/client/SidebarNotice.tsx';
import type { PanelState } from '../packages/plugin/src/client/Panel.tsx';
import { styles } from '../packages/plugin/src/client/styles.ts';

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

function render(state: PanelState, wide: boolean) {
  let subscriptions = 0;
  // Root-level tsx tests use classic JSX rather than the Client build's automatic runtime.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  try {
    const result = ChatGPTSidebarNotice({
      wide,
      useConnection: <T,>(selector: (value: PanelState) => T) => { subscriptions++; return selector(state); },
    } as Parameters<typeof ChatGPTSidebarNotice>[0]);
    assert.equal(subscriptions, 1, 'Read the injected connection state without a separate data source');
    return result;
  } finally {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  }
}

function state(value: NonNullable<PanelState['status']>['state']): PanelState {
  return { busy: false, status: { state: value, profile: 'test', models: [], preferredModelAvailable: false } };
}

test('sidebar styles wrap the flex parent around the display-contents slot and match native geometry', () => {
  assert.ok(styles.includes('div:has(> div > .chatgpt-plan-sidebar) { flex-wrap: wrap; }'));
  assert.ok(!styles.includes('div:has(> .chatgpt-plan-sidebar)'));
  assert.match(styles, /\.chatgpt-plan-sidebar \{[^}]*gap: 8px;[^}]*min-height: 44px;[^}]*padding: 6px;[^}]*font-size: 14px;/);
  assert.match(styles, /\.chatgpt-plan-sidebar-icon \{[^}]*width: 24px; height: 24px;/);
  assert.match(styles, /\.chatgpt-plan-sidebar-compact \{[^}]*width: 36px; height: 36px; border: 0;/);
  assert.ok(styles.includes('background: var(--dsw-alias-interactive-bg-hover)'));
});

for (const wide of [true, false]) {
  test(`the sidebar notice hides unknown, disconnected and authorizing states (wide=${wide})`, () => {
    assert.equal(render({ busy: false }, wide), null);
    for (const value of ['disconnected', 'authorizing'] as const) assert.equal(render(state(value), wide), null);
  });
}

test('the expanded connected notice shows the plan status and a safe usage link', () => {
  const result = render(state('connected'), true);
  assert.ok(result);
  assert.match(text(result), /Using ChatGPT plan/);
  const icon = elements(result).find(element => element.type === 'svg');
  assert.equal(icon?.props.width, 16);
  assert.equal(icon?.props.height, 16);
  assert.doesNotMatch(text(result), /Reconnect in Models|reconnection required/);
  const links = elements(result).filter(element => element.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(text(links[0]), 'View usage');
  assert.equal(links[0].props.href, 'https://chatgpt.com/settings/usage');
  assert.equal(links[0].props.target, '_blank');
  assert.deepEqual(links[0].props.rel.split(/\s+/).sort(), ['noopener', 'noreferrer']);
});

test('the expanded reconnect notice gives Models instructions without claiming a connection', () => {
  const result = render(state('needs-reconnect'), true);
  assert.ok(result);
  assert.match(text(result), /ChatGPT reconnection required/);
  assert.match(text(result), /Reconnect in Models/);
  assert.doesNotMatch(text(result), /Using ChatGPT plan|View usage/);
  assert.equal(elements(result).filter(element => element.type === 'a').length, 0);
});

for (const [value, label] of [
  ['connected', 'Using ChatGPT plan'],
  ['needs-reconnect', 'ChatGPT reconnection required'],
] as const) {
  test(`the compact ${value} notice uses a native-sized icon with a complete accessible status`, () => {
    const result = render(state(value), false);
    assert.ok(result);
    assert.equal(text(result), '');
    const nodes = elements(result);
    const icon = nodes.find(element => element.type === 'svg');
    assert.equal(icon?.props.width, 18);
    assert.equal(icon?.props.height, 18);
    assert.ok(nodes.some(element => element.props.className === 'chatgpt-plan-sidebar-icon' && element.props['aria-hidden'] === 'true'));
    assert.ok(nodes.some(element => String(element.props['aria-label'] ?? '').includes(label)));
    assert.ok(nodes.some(element => String(element.props.title ?? '').includes(label)));
    const links = nodes.filter(element => element.type === 'a');
    if (value === 'connected') {
      assert.equal(links.length, 1);
      assert.equal(links[0].props.href, 'https://chatgpt.com/settings/usage');
      assert.equal(links[0].props.target, '_blank');
      assert.deepEqual(links[0].props.rel.split(/\s+/).sort(), ['noopener', 'noreferrer']);
    } else {
      assert.equal(links.length, 0);
      const labels = nodes.map(element => `${element.props['aria-label'] ?? ''} ${element.props.title ?? ''}`).join(' ');
      assert.match(labels, /Reconnect in Models/);
      assert.doesNotMatch(labels, /Using ChatGPT plan/);
    }
  });
}

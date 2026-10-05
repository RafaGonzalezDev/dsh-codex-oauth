import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { ChatGPTLogo } from '../packages/plugin/src/client/ChatGPTLogo.tsx';
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

function withReact<T>(render: () => T): T {
  // Root-level tsx tests use classic JSX rather than the Client build's automatic runtime.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  try {
    return render();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  }
}

function render(state: PanelState, wide: boolean) {
  return withReact(() => {
    let subscriptions = 0;
    const result = ChatGPTSidebarNotice({
      wide,
      useConnection: <T,>(selector: (value: PanelState) => T) => { subscriptions++; return selector(state); },
    } as Parameters<typeof ChatGPTSidebarNotice>[0]);
    assert.equal(subscriptions, 1, 'Read the injected connection state without a separate data source');
    return result;
  });
}

function state(value: NonNullable<PanelState['status']>['state']): PanelState {
  return { busy: false, status: { state: value, profile: 'test', models: [], preferredModelAvailable: false } };
}

test('sidebar styles wrap the flex parent around the display-contents slot and match native geometry', () => {
  assert.ok(styles.includes('div:has(> div > .chatgpt-plan-sidebar) { flex-wrap: wrap; }'));
  assert.ok(!styles.includes('div:has(> .chatgpt-plan-sidebar)'));
  assert.match(styles, /\.chatgpt-plan-sidebar \{[^}]*position: relative;[^}]*gap: 8px;[^}]*height: 44px;[^}]*min-height: 44px;[^}]*padding: 6px;[^}]*font-size: 14px;/);
  assert.match(styles, /\.chatgpt-plan-sidebar-icon \{[^}]*width: 24px; height: 24px;/);
  assert.match(styles, /\.chatgpt-plan-sidebar-compact \{[^}]*width: 36px; height: 36px; border: 0;/);
  assert.ok(styles.includes('.chatgpt-plan-sidebar:has(a:hover) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }'));
});

test('both expanded states stay on one line and the compact row retains its height', () => {
  assert.match(styles, /\.chatgpt-plan-sidebar-label \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.chatgpt-plan-sidebar\[data-wide="false"\] \{[^}]*height: 36px;[^}]*min-height: 36px;/);
  assert.doesNotMatch(styles, /chatgpt-plan-sidebar-(copy|hint|usage)/);
});

for (const size of [16, 18]) {
  test(`the supplied logo is a decorative, theme-aware SVG (size=${size})`, () => {
    const logo = withReact(() => ChatGPTLogo({ size }));
    assert.equal(logo.type, 'svg');
    assert.equal(logo.props.width, size);
    assert.equal(logo.props.height, size);
    assert.equal(logo.props.viewBox, '0 0 320 320');
    assert.equal(logo.props.fill, 'currentColor');
    assert.equal(logo.props['aria-hidden'], 'true');
    assert.equal(logo.props.focusable, 'false');
    const nodes = elements(logo);
    assert.deepEqual(nodes.map(node => node.type), ['svg', 'path']);
    assert.match(nodes[1].props.d, /^m297\.06 130\.97/);
  });
}

test('the usage link is the whole-row pointer, hover and focus target', () => {
  assert.ok(styles.includes('.chatgpt-plan-sidebar:has(a) { cursor: pointer; }'));
  assert.ok(styles.includes(".chatgpt-plan-sidebar a::after { content: ''; position: absolute; inset: 0; }"));
  assert.ok(styles.includes('.chatgpt-plan-sidebar:has(a:focus-visible) { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }'));
  assert.ok(styles.includes('.chatgpt-plan-sidebar a:focus-visible { outline: none; }'));
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
  assert.equal(text(result), 'Using ChatGPT plan');
  const icon = elements(result).find(element => element.type === ChatGPTLogo);
  assert.equal(icon?.props.size, 16);
  assert.doesNotMatch(text(result), /Reconnect in Models|reconnection required/);
  const links = elements(result).filter(element => element.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(text(links[0]), 'Using ChatGPT plan');
  assert.equal(links[0].props['aria-label'], 'Using ChatGPT plan. View usage. Opens in a new tab');
  assert.equal(links[0].props.title, links[0].props['aria-label']);
  assert.equal(result.props.title, links[0].props.title);
  assert.equal(links[0].props.href, 'https://chatgpt.com/settings/usage');
  assert.equal(links[0].props.target, '_blank');
  assert.deepEqual(links[0].props.rel.split(/\s+/).sort(), ['noopener', 'noreferrer']);
});

test('the expanded reconnect notice gives Models instructions without claiming a connection', () => {
  const result = render(state('needs-reconnect'), true);
  assert.ok(result);
  assert.equal(text(result), 'ChatGPT reconnection required');
  assert.equal(result.props['aria-label'], 'ChatGPT reconnection required. Reconnect in Models');
  assert.equal(result.props.title, result.props['aria-label']);
  const icon = elements(result).find(element => element.type === ChatGPTLogo);
  assert.equal(icon?.props.size, 16);
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
    const icon = nodes.find(element => element.type === ChatGPTLogo);
    assert.equal(icon?.props.size, 18);
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

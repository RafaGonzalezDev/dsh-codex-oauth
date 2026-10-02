import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { OnboardingDialog } from '../packages/plugin/src/client/OnboardingDialog.tsx';
import {
  ONBOARDING_COPY_VERSION, ONBOARDING_SURFACE_ID, ONBOARDING_TITLE_ID,
  dialogKeyAction, onboardingStorageKey, readAcknowledgedVersion, shouldShowOnboarding, writeAcknowledgedVersion,
} from '../packages/plugin/src/client/onboarding.ts';
import type { ConnectionStatus } from '../packages/plugin/src/contracts.ts';

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

/** Render the confirmation the way the root-level tsx tests render every Client surface. */
function render(dismiss: () => void = () => {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  try {
    return OnboardingDialog({ dismiss, onKeyDown: () => {} });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  }
}

function status(state: ConnectionStatus['state'], account = true): ConnectionStatus {
  return {
    state, profile: 'test', models: [], preferredModelAvailable: false,
    ...(account ? { account: { label: 'test-account' } } : {}),
  };
}

function withStorage(value: unknown, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('the confirmation is a labelled modal with a single dismiss action', () => {
  let dismissed = 0;
  const result = render(() => { dismissed++; });
  assert.ok(result);
  const dialog = elements(result).find(item => item.props.role === 'dialog');
  assert.ok(dialog, 'Expected a dialog surface');
  assert.equal(dialog.props.id, ONBOARDING_SURFACE_ID);
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.equal(dialog.props['aria-labelledby'], ONBOARDING_TITLE_ID);
  const title = elements(result).find(item => item.props.id === ONBOARDING_TITLE_ID);
  assert.ok(title, 'Expected the title element referenced by aria-labelledby');
  assert.equal(text(title), "You're using your ChatGPT plan");
  const button = elements(result).find(item => item.type === 'button');
  assert.ok(button);
  assert.equal(text(button), 'Got it');
  assert.equal(button.props.autoFocus, true, 'Move focus into the confirmation');
  button.props.onClick();
  assert.equal(dismissed, 1);
});

test('the confirmation links to the official usage settings without credentials', () => {
  const result = render();
  const link = elements(result).find(item => item.type === 'a');
  assert.ok(link);
  assert.equal(text(link), 'Manage usage');
  assert.equal(link.props.href, 'https://chatgpt.com/settings/usage');
  assert.equal(link.props.target, '_blank');
  assert.deepEqual(link.props.rel.split(/\s+/).sort(), ['noopener', 'noreferrer']);
});

test('Escape dismisses the confirmation while Tab stays inside it', () => {
  assert.equal(dialogKeyAction('Escape'), 'dismiss');
  assert.equal(dialogKeyAction('Tab'), 'contain');
  for (const key of ['Enter', 'a', 'ArrowDown', 'Shift']) assert.equal(dialogKeyAction(key), 'ignore');
});

test('the confirmation requires an effective connected plan', () => {
  assert.equal(shouldShowOnboarding(status('connected'), undefined), true);
  assert.equal(shouldShowOnboarding(status('connected'), 0), true);
  assert.equal(shouldShowOnboarding(status('connected'), ONBOARDING_COPY_VERSION), false);
  assert.equal(shouldShowOnboarding(status('connected'), ONBOARDING_COPY_VERSION + 1), false);
  assert.equal(shouldShowOnboarding(status('connected', false), undefined), false);
  for (const state of ['disconnected', 'authorizing', 'needs-reconnect'] as const) {
    assert.equal(shouldShowOnboarding(status(state), undefined), false, state);
  }
  assert.equal(shouldShowOnboarding(undefined, undefined), false);
});

test('the acknowledged copy version survives a reload per profile', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  withStorage(fake, () => {
    assert.equal(readAcknowledgedVersion('desktop'), undefined);
    writeAcknowledgedVersion('desktop', ONBOARDING_COPY_VERSION);
    assert.equal(readAcknowledgedVersion('desktop'), ONBOARDING_COPY_VERSION);
    assert.equal(readAcknowledgedVersion('web'), undefined, 'Profiles acknowledge separately');
    assert.ok(store.has(onboardingStorageKey('desktop')));
  });
});

test('an unavailable or failing store never breaks the confirmation', () => {
  withStorage(undefined, () => {
    assert.equal(readAcknowledgedVersion('desktop'), undefined);
    writeAcknowledgedVersion('desktop', ONBOARDING_COPY_VERSION);
  });
  const throwing = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  withStorage(throwing, () => {
    assert.equal(readAcknowledgedVersion('desktop'), undefined);
    writeAcknowledgedVersion('desktop', ONBOARDING_COPY_VERSION);
  });
  withStorage({ getItem: () => 'not-a-number', setItem: () => {} }, () => {
    assert.equal(readAcknowledgedVersion('desktop'), undefined);
  });
});

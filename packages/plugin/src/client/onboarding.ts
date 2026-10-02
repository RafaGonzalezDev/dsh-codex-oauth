import type { ConnectionStatus } from '../contracts.ts';

/**
 * Copy version of the first-sign-in confirmation. Bump it when the copy changes so
 * the confirmation is shown once more, mirroring the versioned acknowledgement the
 * shell uses for its own welcome notice.
 */
export const ONBOARDING_COPY_VERSION = 1;

/** Stable id of the frame-wide overlay entry. */
export const ONBOARDING_SLOT_ID = 'chatgpt-plan-onboarding';

/** Id of the confirmation surface, used by the host to keep Tab inside it. */
export const ONBOARDING_SURFACE_ID = 'chatgpt-plan-onboarding-surface';

/** Id of the dialog title, referenced by `aria-labelledby`. */
export const ONBOARDING_TITLE_ID = 'chatgpt-plan-onboarding-title';

export function onboardingStorageKey(profile: string): string {
  return `dsh-chatgpt-plan:onboarding:${profile}`;
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** A missing or unreadable store keeps the confirmation process-local instead of failing. */
export function readAcknowledgedVersion(profile: string): number | undefined {
  try {
    const value = storage()?.getItem(onboardingStorageKey(profile));
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  } catch { return undefined; }
}

export function writeAcknowledgedVersion(profile: string, version: number): void {
  try { storage()?.setItem(onboardingStorageKey(profile), String(version)); } catch { /* process-local only */ }
}

/**
 * The confirmation describes an effective use of the plan, so it never appears for
 * a disconnected profile or for a session that only needs reconnection.
 */
export function shouldShowOnboarding(status: ConnectionStatus | undefined, acknowledgedVersion: number | undefined): boolean {
  return status?.state === 'connected'
    && Boolean(status.account)
    && (acknowledgedVersion ?? 0) < ONBOARDING_COPY_VERSION;
}

export type DialogKeyAction = 'dismiss' | 'contain' | 'ignore';

/** Escape dismisses the confirmation; Tab stays inside it, which `aria-modal` alone cannot enforce. */
export function dialogKeyAction(key: string): DialogKeyAction {
  if (key === 'Escape') return 'dismiss';
  if (key === 'Tab') return 'contain';
  return 'ignore';
}

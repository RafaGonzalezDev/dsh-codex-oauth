import type { KeyboardEvent, ReactNode } from 'react';
import { en } from './locales.ts';
import { ONBOARDING_SURFACE_ID, ONBOARDING_TITLE_ID } from './onboarding.ts';
import { CHATGPT_USAGE_URL } from './usage.ts';

export interface OnboardingDialogProps {
  dismiss(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

/**
 * Presentational confirmation surface. It stays free of hooks and DOM access so the
 * root-level tests can call it directly; the overlay host owns focus and key handling.
 */
export function OnboardingDialog(props: OnboardingDialogProps): ReactNode {
  return <div className="chatgpt-plan-overlay">
    <section id={ONBOARDING_SURFACE_ID} className="chatgpt-plan-dialog" role="dialog" aria-modal="true" aria-labelledby={ONBOARDING_TITLE_ID} onKeyDown={props.onKeyDown}>
      <h2 id={ONBOARDING_TITLE_ID}>{en.onboardingTitle}</h2>
      <p>{en.onboardingBody}</p>
      <div className="chatgpt-plan-dialog-actions">
        <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer">{en.onboardingUsage}</a>
        <button type="button" className="chatgpt-plan-dialog-primary" autoFocus onClick={props.dismiss}>{en.onboardingDismiss}</button>
      </div>
    </section>
  </div>;
}

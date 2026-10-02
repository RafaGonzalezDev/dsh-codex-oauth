import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PanelInjected } from './Panel.tsx';
import { OnboardingDialog } from './OnboardingDialog.tsx';
import { ONBOARDING_SURFACE_ID, dialogKeyAction, shouldShowOnboarding } from './onboarding.ts';

export type OnboardingOverlayInjected = Pick<PanelInjected, 'hooks' | 'acknowledgeOnboarding'>;
type OnboardingOverlayProps = PropsRuntime<'shell.overlay'> & InjectFace<OnboardingOverlayInjected>;

/**
 * First-sign-in confirmation, hosted in the frame-wide overlay layer. This Client ships
 * without the React DOM renderer, so the surface renders inside that layer instead of a
 * body portal; `aria-modal` plus the Tab containment below stand in for the root-inert
 * ownership the portal-based onboarding modal can rely on.
 */
export function ChatGPTPlanOnboarding(props: OnboardingOverlayProps): ReactNode {
  const state = props.useConnection(value => value);
  const visible = shouldShowOnboarding(state.status, state.acknowledgedCopyVersion);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    restore.current = document.activeElement;
    return () => {
      const target = restore.current;
      restore.current = null;
      if (target instanceof HTMLElement && document.body.contains(target)) target.focus();
    };
  }, [visible]);

  if (!visible) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const action = dialogKeyAction(event.key);
    if (action === 'dismiss') { event.preventDefault(); props.acknowledgeOnboarding(); return; }
    if (action !== 'contain') return;
    const focusable = document.getElementById(ONBOARDING_SURFACE_ID)?.querySelectorAll<HTMLElement>('button, a[href]');
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    if (!first || !last) return;
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  };

  return <OnboardingDialog dismiss={props.acknowledgeOnboarding} onKeyDown={onKeyDown} />;
}

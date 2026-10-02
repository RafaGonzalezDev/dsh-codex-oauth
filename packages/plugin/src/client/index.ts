import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import { TYPERT_REMOTE } from 'dsh-chatgpt-plan/remote';
import { ConnectionPanel, type PanelInjected, type PanelState } from './Panel.tsx';
import { ChatGPTPlanOnboarding } from './OnboardingOverlay.tsx';
import { ChatGPTSidebarNotice } from './SidebarNotice.tsx';
import { ONBOARDING_COPY_VERSION, ONBOARDING_SLOT_ID, readAcknowledgedVersion, writeAcknowledgedVersion } from './onboarding.ts';
import { styles } from './styles.ts';
import { en } from './locales.ts';

export const inject = ['slots', 'remote'];

export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  ctx.effect(() => () => unmount(), 'chatgpt-plan: RPC contribution');
  // The namespace is created by $mount; waiting for it in the entry's own
  // inject declaration would prevent that mount from ever running.
  ctx.inject(['slots', 'remote', 'remote.chatgptPlan'], applyPanel);
}

function applyPanel(ctx: Context): void {
  let disposed = false;
  let snapshot: PanelState = { busy: false };
  const listeners = new Set<() => void>();
  let login: ReturnType<typeof ctx.remote.chatgptPlan.authorize> | undefined;
  let refreshVersion = 0;
  const publish = (next: PanelState) => { if (!disposed) { snapshot = next; for (const listener of listeners) listener(); } };
  const connection = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      // The panel can mount after the initial Connection generation becomes ready.
      if (!disposed) void read();
      return () => { listeners.delete(listener); };
    },
  };
  const readFailed = () => {
    const { status: _status, ...retained } = snapshot;
    publish({ ...retained, message: en.failed });
  };
  // The acknowledgement is per profile: a profile change re-reads its own copy version.
  const acknowledgedVersionFor = (profile: string) => snapshot.status?.profile === profile && snapshot.acknowledgedCopyVersion !== undefined
    ? snapshot.acknowledgedCopyVersion
    : readAcknowledgedVersion(profile);
  const read = async () => {
    const version = ++refreshVersion;
    try {
      const result = await ctx.remote.chatgptPlan.getStatus();
      if (version !== refreshVersion) return;
      if (result.ok) {
        const { message, catalogMessage: _catalogMessage, ...retained } = snapshot;
        publish({ ...retained, status: result.value, acknowledgedCopyVersion: acknowledgedVersionFor(result.value.profile), ...(message && message !== en.failed ? { message } : {}) });
      }
      else readFailed();
    } catch { if (version === refreshVersion) readFailed(); }
  };
  const connect = async (changeAccount: boolean) => {
    if (snapshot.busy) return;
    ++refreshVersion;
    publish({ ...snapshot, busy: true });
    let stream: typeof login;
    try {
      stream = ctx.remote.chatgptPlan.authorize({ mode: changeAccount ? 'change-account' : 'connect', ...(snapshot.status?.errorCode === 'INSUFFICIENT_SCOPE' ? { reconsent: true } : {}) });
      login = stream;
      for await (const event of stream) {
        if (event.type === 'notice') {
          const { authorizationUrl: _url, ...retained } = snapshot;
          publish({ ...retained, message: event.message, ...(event.url ? { authorizationUrl: event.url } : {}) });
          if (event.url) window.open(event.url, '_blank', 'noopener,noreferrer');
        } else if (event.type === 'status') {
          ++refreshVersion;
          publish({ ...snapshot, status: event.status });
        } else if (event.type === 'error') publish({ ...snapshot, message: event.message });
      }
    } catch { publish({ ...snapshot, message: en.failed }); }
    finally {
      if (login === stream) login = undefined;
      ++refreshVersion;
      const { authorizationUrl: _url, ...retained } = snapshot;
      publish({ ...retained, busy: false });
      if (!disposed) await read();
    }
  };
  const cancel = async () => { try { await ctx.remote.chatgptPlan.cancel(); } catch { publish({ ...snapshot, message: en.failed }); } finally { login?.dispose(); } };
  const disconnect = async () => {
    ++refreshVersion;
    publish({ ...snapshot, busy: true });
    try {
      const result = await ctx.remote.chatgptPlan.disconnect();
      ++refreshVersion;
      if (result.ok) {
        const { message: _message, authorizationUrl: _url, ...retained } = snapshot;
        publish({ ...retained, status: result.value.status, busy: false });
      } else publish({ ...snapshot, busy: false, message: en.failed });
    } catch {
      ++refreshVersion;
      publish({ ...snapshot, busy: false, message: en.failed });
    }
  };
  const refresh = async () => {
    if (snapshot.busy || snapshot.updatingModels || snapshot.status?.catalog?.refreshing) return;
    const { catalogMessage: _message, ...retained } = snapshot;
    publish({ ...retained, updatingModels: true });
    try {
      const result = await ctx.remote.chatgptPlan.refreshModels();
      // Read the current account state after updating metadata; an account action
      // may have completed while the catalog request was in flight.
      if (result.ok) {
        publish({ ...snapshot, updatingModels: false });
        await read();
      } else publish({ ...snapshot, updatingModels: false, catalogMessage: en.catalogFailed });
    } catch { publish({ ...snapshot, updatingModels: false, catalogMessage: en.catalogFailed }); }
  };
  const acknowledgeOnboarding = () => {
    const profile = snapshot.status?.profile;
    if (!profile) return;
    writeAcknowledgedVersion(profile, ONBOARDING_COPY_VERSION);
    publish({ ...snapshot, acknowledgedCopyVersion: ONBOARDING_COPY_VERSION });
  };
  const injected = (): PanelInjected => ({
    hooks: { connection }, local: ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname) || 'dshDesktop' in globalThis,
    connect: value => { void connect(value); }, cancel: () => { void cancel(); },
    disconnect: () => { void disconnect(); }, refresh: () => { void refresh(); },
    acknowledgeOnboarding,
  });
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({ name: 'settings.models.footer', id: 'chatgpt-plan', order: 10, inject: injected }, ConnectionPanel));
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'chatgpt-plan', order: 10,
    inject: () => ({ hooks: { connection } }),
  }, ChatGPTSidebarNotice));
  // Frame-wide layer: the confirmation outlives the Models panel that started the sign-in.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: ONBOARDING_SLOT_ID, order: 100,
    inject: () => ({ hooks: { connection }, acknowledgeOnboarding }),
  }, ChatGPTPlanOnboarding));
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = 'dsh-chatgpt-plan'; style.textContent = styles;
    document.head.appendChild(style); return () => style.remove();
  }, 'chatgpt-plan: styles');
  ctx.effect(() => {
    const updated = ctx.remote.$on('llm/adapters-updated', () => { void read(); });
    const reset = ctx.on('connection/reset', () => { void read(); });
    void read();
    return () => { disposed = true; login?.dispose(); updated(); reset(); listeners.clear(); };
  }, 'chatgpt-plan: subscriptions');
}

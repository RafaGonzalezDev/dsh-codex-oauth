import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-app-boot';
import type {} from '@deepseek-ai/dsh-authorization';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-fs';
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { SessionManager, SessionRepository } from './session.ts';
import { ChatGPTPlanService } from './service.ts';
import { ChatGPTPlanAdapter } from './adapter.ts';
import { PROVIDER_ID } from './models.ts';

export { ChatGPTPlanService } from './service.ts';
export type { AccountView, AuthorizationOptions, AuthorizationEvent, ConnectionStatus, ModelView, DisconnectResult } from './contracts.ts';
export const inject = ['profileContext', 'credentials', 'authorization', 'llm', 'attachments'];

export async function apply(ctx: Context): Promise<void> {
  const key = await SessionRepository.profileKey(ctx.profileContext.dir);
  const repository = new SessionRepository(ctx.credentials, key);
  let disposed = false;
  let publish = () => {};
  const manager = new SessionManager(repository, ctx.profileContext.name, undefined, undefined, () => publish());
  await manager.initialize();
  const service = new ChatGPTPlanService(ctx, manager);
  const adapter = new ChatGPTPlanAdapter(manager, ctx.attachments,
    ref => resolveImageAttachmentAccess(ctx.attachments, path => ctx.get('fs')?.processPathFromHostPath(path), ref),
    ref => ctx.llm.fileRequestText(ref));
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
  publish = () => { if (!disposed) registration.replace([PROVIDER_ID]); };
  ctx.authorization.registerFlow({
    key: repository.key, label: 'ChatGPT Plan',
    methods: [{ id: 'connect', label: 'Continue with ChatGPT' }, { id: 'reconsent', label: 'Grant ChatGPT plan usage' }, { id: 'change-account', label: 'Use another ChatGPT account' }],
    run: session => manager.signIn({ mode: session.method === 'change-account' ? 'change-account' : 'connect', ...(session.method === 'reconsent' ? { reconsent: true } : {}) }, session.signal, notice => session.notify(notice)),
  });
  ctx.on('credentials/record-updated', async changed => {
    if (changed !== repository.key) return;
    await manager.initialize();
    publish();
  });
  ctx.effect(() => () => { disposed = true; ctx.authorization.cancel(repository.key); manager.dispose(); }, 'chatgpt-plan: lifecycle');
  // A live route advertises models to the native selector; the footer owns its
  // connection UI, so it needs no API-key settings namespace or generic editor.
  void service;
}

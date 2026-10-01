import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService, type RemoteStream } from '@deepseek-ai/dsh-typert-protocol';
import type { AuthorizationOptions, AuthorizationEvent, ConnectionStatus, DisconnectResult } from './contracts.ts';
import { EventQueue } from './event-queue.ts';
import { safeError } from './errors.ts';
import type { SessionManager } from './session.ts';
import type {} from '@deepseek-ai/dsh-authorization';

declare module '@deepseek-ai/cordis' {
  interface Context { chatgptPlan: ChatGPTPlanService }
}

export class ChatGPTPlanService extends TypertRemoteService {
  constructor(ctx: Context, private readonly manager: SessionManager) { super(ctx, 'chatgptPlan'); }

  @Remote
  async getStatus(): Promise<ConnectionStatus> { return this.manager.status(); }

  @Remote({ mode: 'stream' })
  async *authorize(options: AuthorizationOptions, signal: AbortSignal): RemoteStream<AuthorizationEvent> {
    const queue = new EventQueue<AuthorizationEvent>();
    const run = this.ctx.authorization.begin({
      key: this.manager.repository.key,
      method: options.mode === 'change-account' ? 'change-account' : options.reconsent ? 'reconsent' : 'connect',
      signal,
      interaction: {
        notify: notice => queue.push({ type: 'notice', message: notice.message, ...(notice.url ? { url: notice.url } : {}) }),
        prompt: async () => { throw new Error('This flow uses the system browser, without secret prompts.'); },
      },
    }).then(async result => {
      await this.manager.waitForAuthorization();
      const status = await this.manager.status();
      queue.push({ type: 'status', status });
      queue.push({ type: 'settled', outcome: result.status === 'cancelled' && status.state === 'connected' ? 'authorized' : result.status });
    }).catch(async error => {
      const failure = safeError(error);
      queue.push({ type: 'error', code: failure.code, message: failure.message });
      queue.push({ type: 'status', status: await this.manager.status() });
      queue.push({ type: 'settled', outcome: 'failed' });
    }).finally(() => queue.end());
    try { yield* queue; }
    finally { this.ctx.authorization.cancel(this.manager.repository.key); await run; }
  }

  @Remote
  async cancel(): Promise<void> { this.ctx.authorization.cancel(this.manager.repository.key); }

  @Remote
  async disconnect(): Promise<DisconnectResult> {
    this.ctx.authorization.cancel(this.manager.repository.key);
    return this.manager.disconnect();
  }

  @Remote
  async refreshModels(signal: AbortSignal): Promise<ConnectionStatus> {
    try { await this.manager.refreshModels(signal); return await this.manager.status(); }
    catch (error) {
      const failure = safeError(error);
      const status = await this.manager.status();
      // A public catalog outage is not an OAuth error and must not request reconsent.
      return { ...status, ...(status.catalog ? { catalog: { ...status.catalog, warning: failure.message } } : {}) };
    }
  }
}

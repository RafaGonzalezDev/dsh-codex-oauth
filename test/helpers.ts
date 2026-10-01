import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { OAuthClient, API_RESOURCE, DIRECT_SCOPE, OPENAI_ISSUER, type Registration, type TokenSet, type CallbackResult, type PendingAuthorization } from '../packages/plugin/src/oauth.ts';
import { SessionRepository, SessionManager } from '../packages/plugin/src/session.ts';
import { parseCatalog } from '../packages/plugin/src/models.ts';

export class MemoryCredentials {
  readonly records = new Map<CredentialKey, CredentialRecord>();
  private readonly pending = new Map<CredentialKey, Promise<void>>();
  async readRecord(key: CredentialKey) { return structuredClone(this.records.get(key)); }
  async modifyRecord(key: CredentialKey, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const previous = this.pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.pending.set(key, next);
    await previous;
    try {
      const value = await mutate(structuredClone(this.records.get(key)));
      if (value) this.records.set(key, structuredClone(value));
      return value;
    } finally { release(); if (this.pending.get(key) === next) this.pending.delete(key); }
  }
}

export const registration: Registration = { clientId: 'test-issued-client', subject: 'test-account', issuer: OPENAI_ISSUER, email: 'test@example.invalid' };
export function tokenSet(expired = false): TokenSet {
  return { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', idToken: 'test-id-token', expiresAt: Date.now() + (expired ? -1000 : 3600_000), scopes: ['openid', 'resource.invoke', DIRECT_SCOPE] };
}
export const wireCatalog = { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' }] };

export class StubOAuth extends OAuthClient {
  refreshes = 0;
  revocations: TokenSet[] = [];
  nextTokens = tokenSet();
  nextRegistration = registration;
  refreshError?: Error;
  refreshGate?: Promise<void>;
  revocationConfirmed = true;
  override async refresh(_registration: Registration, _previous: TokenSet) {
    this.refreshes++;
    await this.refreshGate;
    if (this.refreshError) throw this.refreshError;
    return this.nextTokens;
  }
  override async exchange(_callback: CallbackResult, _pending: PendingAuthorization, _redirect: string, _signal: AbortSignal) {
    return { registration: this.nextRegistration, tokens: this.nextTokens };
  }
  override async revoke(_registration: Registration, tokens: TokenSet) {
    this.revocations.push(tokens); return this.revocationConfirmed;
  }
}

export async function fixture(options: { store?: MemoryCredentials; profile?: string; expired?: boolean; oauth?: StubOAuth; transport?: typeof fetch } = {}) {
  const store = options.store ?? new MemoryCredentials();
  const repo = new SessionRepository(store, options.profile ?? 'test-profile');
  await repo.update(async () => ({ version: 1, generation: 1, state: 'connected', activeClientId: registration.clientId, registrations: [registration], tokens: tokenSet(options.expired), models: parseCatalog(wireCatalog) }));
  const oauth = options.oauth ?? new StubOAuth();
  const transport: typeof fetch = options.transport ?? (async input => {
    if (String(input) !== `${API_RESOURCE}/models`) throw new Error('Unexpected request');
    return Response.json(wireCatalog);
  });
  const manager = new SessionManager(repo, options.profile ?? 'test-profile', oauth, transport);
  await manager.initialize();
  return { store, repo, manager, oauth };
}

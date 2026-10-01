import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { OAuthClient, DIRECT_SCOPE, OPENAI_ISSUER, type Registration, type TokenSet, type CallbackResult, type PendingAuthorization } from '../packages/plugin/src/oauth.ts';
import { SessionRepository, SessionManager } from '../packages/plugin/src/session.ts';
import { parsePiCatalog, PI_CATALOG_URL, type CatalogModel } from '../packages/plugin/src/models.ts';
import type { CatalogInfo } from '../packages/plugin/src/contracts.ts';
import type { CatalogSource } from '../packages/plugin/src/pi-catalog.ts';
import { throwIfAborted } from '../packages/plugin/src/errors.ts';

export class MemoryCredentials {
  readonly records = new Map<CredentialKey, CredentialRecord>();
  writes = 0;
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
      if (value) { this.records.set(key, structuredClone(value)); this.writes++; }
      return value;
    } finally { release(); if (this.pending.get(key) === next) this.pending.delete(key); }
  }
}

export const registration: Registration = { clientId: 'test-issued-client', subject: 'test-account', issuer: OPENAI_ISSUER, email: 'test@example.invalid' };
export function tokenSet(expired = false): TokenSet {
  return { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', idToken: 'test-id-token', expiresAt: Date.now() + (expired ? -1000 : 3600_000), scopes: ['openid', 'resource.invoke', DIRECT_SCOPE] };
}
export const piCatalog = [{
  id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'openai-codex', type: 'chat',
  input: ['text', 'image'], contextWindow: 272000, reasoning: true,
  thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
}];

/** Offline source: credential and adapter tests must never discover models over HTTP. */
export class StubCatalog implements CatalogSource {
  values = parsePiCatalog(piCatalog);
  next?: CatalogModel[];
  refreshes = 0;
  refreshGate?: Promise<void>;
  refreshError?: Error;
  disposed = false;
  async initialize() {}
  models() { return structuredClone(this.values); }
  info(): CatalogInfo { return { source: 'pi', sourceUrl: PI_CATALOG_URL, loadedFrom: 'bundled', revision: 'test-revision', refreshing: false }; }
  async refresh(signal?: AbortSignal) {
    throwIfAborted(signal);
    this.refreshes++;
    await this.refreshGate;
    throwIfAborted(signal);
    if (this.refreshError) throw this.refreshError;
    if (this.next !== undefined) this.values = structuredClone(this.next);
    return this.models();
  }
  dispose() { this.disposed = true; }
}

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

export async function fixture(options: { store?: MemoryCredentials; profile?: string; expired?: boolean; oauth?: StubOAuth; catalog?: StubCatalog } = {}) {
  const store = options.store ?? new MemoryCredentials();
  const repo = new SessionRepository(store, options.profile ?? 'test-profile');
  await repo.update(async () => ({ version: 1, generation: 1, state: 'connected', activeClientId: registration.clientId, registrations: [registration], tokens: tokenSet(options.expired), models: [] }));
  const oauth = options.oauth ?? new StubOAuth();
  const catalog = options.catalog ?? new StubCatalog();
  const manager = new SessionManager(repo, options.profile ?? 'test-profile', oauth, catalog);
  await manager.initialize();
  return { store, repo, manager, oauth, catalog };
}

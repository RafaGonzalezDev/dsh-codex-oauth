import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { credentialKey, type CredentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { z } from 'zod';
import type { AuthorizationOptions, ConnectionStatus, DisconnectResult } from './contracts.ts';
import { CatalogModel, PREFERRED_MODEL, publicModel, selectionOrder } from './models.ts';
import type { CatalogSource } from './pi-catalog.ts';
import { DIRECT_SCOPE, OAuthClient, buildAuthorizationUrl, createPendingAuthorization, startCallbackListener, type Registration, type TokenSet } from './oauth.ts';
import { PlanError, safeError, throwIfAborted } from './errors.ts';

const RegistrationSchema = z.object({ clientId: z.string().min(1), subject: z.string().min(1), issuer: z.string().min(1), email: z.string().optional() });
const TokenSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), idToken: z.string().optional(), expiresAt: z.number().finite(), scopes: z.array(z.string()) });
const HostUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const HostId = z.string().regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const SessionSchema = z.object({
  version: z.literal(1), generation: z.number().int().nonnegative(),
  state: z.enum(['disconnected', 'connected', 'needs-reconnect']),
  registrations: z.array(RegistrationSchema), activeClientId: z.string().optional(), pendingClientId: z.string().optional(),
  tokens: TokenSchema.optional(),
  // Keep v1 records readable, but never trust or validate their obsolete catalog.
  // The next natural credential write drops it without migrating the OAuth grant.
  models: z.preprocess(() => [], z.array(CatalogModel)),
  warning: z.string().optional(), errorCode: z.string().optional(),
});
export type StoredSession = z.infer<typeof SessionSchema>;
type StorePort = Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>;

function emptySession(): StoredSession {
  return { version: 1, generation: 0, state: 'disconnected', registrations: [], models: [] };
}

function sessionFrom(record?: CredentialRecord): StoredSession {
  if (!record) return emptySession();
  const result = record.kind === 'grant' ? SessionSchema.safeParse(record.payload) : undefined;
  if (!result?.success) throw new PlanError('INVALID_CREDENTIAL', 'The plugin credential record is invalid. Restore the credential store before reconnecting.');
  // Only the retired account-catalog loader persisted warnings while connected.
  // Authentication/revocation warnings in other states must remain intact.
  if (result.data.state === 'connected') {
    const { warning: _warning, errorCode: _errorCode, ...retained } = result.data;
    return retained;
  }
  return result.data;
}

export class SessionRepository {
  readonly key: CredentialKey;
  constructor(private readonly store: StorePort, profileKey: string) {
    this.key = credentialKey('dsh-chatgpt-plan', `profile-${profileKey}`);
  }

  static async profileKey(directory: string): Promise<string> {
    return createHash('sha256').update(await realpath(directory)).digest('hex');
  }

  async hostId(): Promise<string> {
    const key = credentialKey('dsh-chatgpt-plan', 'installation');
    let hostId = '';
    await this.store.modifyRecord(key, async record => {
      if (record) {
        const parsed = record.kind === 'grant' ? z.object({ version: z.literal(1), hostId: z.union([HostId, HostUuid]) }).safeParse(record.payload) : undefined;
        if (!parsed?.success) throw new PlanError('INVALID_CREDENTIAL', 'The stored installation identifier is invalid.');
        hostId = parsed.data.hostId.startsWith('urn:uuid:') ? parsed.data.hostId : `urn:uuid:${parsed.data.hostId}`;
        // Preserve the UUID when upgrading an early development installation.
        return hostId === parsed.data.hostId ? undefined : { kind: 'grant', payload: { version: 1, hostId } };
      }
      hostId = `urn:uuid:${randomUUID()}`;
      return { kind: 'grant', payload: { version: 1, hostId } };
    });
    return hostId;
  }

  async read(): Promise<StoredSession> { return sessionFrom(await this.store.readRecord(this.key)); }

  async update(mutate: (session: StoredSession) => Promise<StoredSession | undefined>): Promise<void> {
    await this.store.modifyRecord(this.key, async record => {
      const next = await mutate(sessionFrom(record));
      return next ? { kind: 'grant', payload: SessionSchema.parse(next) } : undefined;
    });
  }
}

export interface ActiveGrant {
  registration: Registration;
  tokens: TokenSet;
  generation: number;
}

function activeRegistration(session: StoredSession): Registration | undefined {
  return session.registrations.find(registration => registration.clientId === session.activeClientId);
}

export class SessionManager {
  private blocked = false;
  private disconnecting = 0;
  private observedGeneration: number | undefined;
  private stateEpoch = 0;
  private readonly calls = new Set<AbortController>();
  private connected = false;
  private disposed = false;
  private liveAuthorization = false;
  private authorizationSettled: Promise<void> | undefined;

  constructor(
    readonly repository: SessionRepository,
    readonly profile: string,
    private readonly oauth = new OAuthClient(),
    private readonly catalog: CatalogSource,
    private readonly changed: () => void = () => {},
  ) {}

  async initialize(): Promise<void> {
    if (this.disposed) return;
    const epoch = this.stateEpoch;
    const session = await this.repository.read();
    if (epoch !== this.stateEpoch || !this.observeSession(session)) return;
    // Restoration is idempotent and local. Credential events never start network refreshes.
    await this.catalog.initialize();
  }

  private observeSession(session: Pick<StoredSession, 'generation' | 'state'>, committed = false): boolean {
    if (this.disposed || (this.observedGeneration !== undefined && session.generation < this.observedGeneration)) return false;
    if (committed) this.stateEpoch++;
    if (this.observedGeneration !== undefined && this.observedGeneration !== session.generation) this.stopCalls();
    this.observedGeneration = session.generation;
    this.connected = session.state === 'connected';
    // Cached reads may lag another process; only a committed local transition blocks
    // fresh admission under the record lock. A current connection can release that block.
    if (committed && !this.connected) this.blocked = true;
    else if (this.connected && this.disconnecting === 0) this.blocked = false;
    return true;
  }

  private confirmTransition(session: StoredSession | undefined): void {
    if (session && this.observeSession(session, true)) this.changed();
  }

  models(): CatalogModel[] { return this.connected && !this.blocked && !this.disposed ? selectionOrder(this.catalog.models()) : []; }

  async status(): Promise<ConnectionStatus> {
    const session = await this.repository.read();
    const registration = activeRegistration(session);
    const models = session.state === 'connected' && !this.blocked && !this.disposed ? selectionOrder(this.catalog.models()) : [];
    return {
      state: this.liveAuthorization && session.state !== 'connected' ? 'authorizing' : session.state,
      profile: this.profile,
      ...(registration ? { account: { label: registration.email ?? `ChatGPT account ${createHash('sha256').update(registration.subject).digest('hex').slice(0, 8)}`, ...(registration.email ? { email: registration.email } : {}) } } : {}),
      models: models.map(publicModel),
      preferredModelAvailable: models.some(model => model.id === PREFERRED_MODEL && model.available),
      catalog: this.catalog.info(),
      ...(session.warning ? { warning: session.warning } : {}),
      ...(session.errorCode ? { errorCode: session.errorCode } : {}),
    };
  }

  /** Every refresh is read-decide-replace under the native cross-process record lock. */
  async activeGrant(signal?: AbortSignal): Promise<ActiveGrant> {
    throwIfAborted(signal);
    if (this.blocked) throw new PlanError('MISSING_CREDENTIAL', 'This profile is disconnected. Continue with ChatGPT to connect it.');
    let grant: ActiveGrant | undefined;
    let failure: PlanError | undefined;
    let committed: StoredSession | undefined;
    await this.repository.update(async session => {
      throwIfAborted(signal);
      const registration = activeRegistration(session);
      if (this.blocked || session.state !== 'connected' || !session.tokens || !registration) {
        throw new PlanError('MISSING_CREDENTIAL', 'This profile has no active ChatGPT session. Continue with ChatGPT to connect it.');
      }
      try {
        if (!session.tokens.scopes.includes(DIRECT_SCOPE) || !session.tokens.scopes.includes('resource.invoke')) throw new PlanError('INSUFFICIENT_SCOPE', 'ChatGPT plan usage permission is missing. Reconnect.');
        if (session.tokens.expiresAt > Date.now() + 60_000) {
          grant = { registration, tokens: session.tokens, generation: session.generation };
          return undefined;
        }
        // Once refresh starts, persist its rotating replacement even if its caller cancels.
        const tokens = await this.oauth.refresh(registration, session.tokens);
        grant = { registration, tokens, generation: session.generation };
        return { ...session, tokens };
      } catch (error) {
        failure = safeError(error);
        if (['AUTH', 'INSUFFICIENT_SCOPE'].includes(failure.code)) {
          const { tokens: _tokens, ...retained } = session;
          committed = { ...retained, generation: session.generation + 1, state: 'needs-reconnect', models: [], warning: failure.message, errorCode: failure.code };
          return committed;
        }
        return undefined;
      }
    });
    this.confirmTransition(committed);
    if (failure) throw failure;
    throwIfAborted(signal);
    if (this.blocked || !grant) throw new PlanError('ABORTED', 'This profile was disconnected.');
    return grant;
  }

  /** The Host owns request cancellation; no tool execution takes place here. */
  requestSignal(external?: AbortSignal): { signal: AbortSignal; release(): void } {
    const controller = new AbortController();
    this.calls.add(controller);
    return {
      signal: external ? AbortSignal.any([external, controller.signal]) : controller.signal,
      release: () => { this.calls.delete(controller); },
    };
  }

  async waitForAuthorization(): Promise<void> { await this.authorizationSettled; }

  async signIn(options: AuthorizationOptions, signal: AbortSignal, notify: (notice: { message: string; url?: string }) => void): Promise<void> {
    const initial = await this.repository.read();
    if (initial.state === 'connected') throw new PlanError('ALREADY_CONNECTED', 'Disconnect this profile before reconnecting or changing accounts.');
    const previous = options.mode === 'change-account' ? undefined : activeRegistration(initial);
    const clientId = options.mode === 'change-account' ? undefined : initial.pendingClientId ?? previous?.clientId;
    const target = clientId ? { clientId, ...(previous?.clientId === clientId && previous.email ? { email: previous.email } : {}) } : undefined;
    const hostId = await this.repository.hostId();
    const pending = createPendingAuthorization();
    const listener = await startCallbackListener(pending.state, clientId, signal);
    this.liveAuthorization = true;
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    this.authorizationSettled = settled;
    let issued: { registration: Registration; tokens: TokenSet } | undefined;
    let activated = false;
    let revocationAttempted = false;
    try {
      notify({ message: 'Open the browser to sign in and authorize ChatGPT plan usage.', url: buildAuthorizationUrl(pending, listener.redirectUri, hostId, target, options.reconsent || initial.errorCode === 'INSUFFICIENT_SCOPE') });
      const callback = await listener.result;
      await this.repository.update(async current => {
        throwIfAborted(signal);
        if (current.generation !== initial.generation) throw new PlanError('ABORTED', 'The profile changed during sign-in. Start again.');
        return { ...current, pendingClientId: callback.clientId };
      });
      const result = await this.oauth.exchange(callback, pending, listener.redirectUri, signal);
      issued = result;
      if (previous?.clientId === result.registration.clientId && (previous.subject !== result.registration.subject || previous.issuer !== result.registration.issuer)) {
        throw new PlanError('ACCOUNT_MISMATCH', 'The returned account does not match this registration. Disconnect and use Change account.');
      }
      const permitted = result.tokens.scopes.includes(DIRECT_SCOPE) && result.tokens.scopes.includes('resource.invoke');
      if (!permitted) { revocationAttempted = true; await this.oauth.revoke(result.registration, result.tokens); }
      let committed: StoredSession | undefined;
      await this.repository.update(async current => {
        throwIfAborted(signal);
        if (current.generation !== initial.generation) throw new PlanError('ABORTED', 'The profile changed during sign-in. Start again.');
        const { tokens: _tokens, warning: _warning, errorCode: _error, pendingClientId: _pending, ...retained } = current;
        committed = {
          ...retained, generation: current.generation + 1,
          registrations: [...current.registrations.filter(entry => entry.clientId !== result.registration.clientId), result.registration],
          activeClientId: result.registration.clientId, state: permitted ? 'connected' : 'needs-reconnect', models: [],
          ...(permitted ? { tokens: result.tokens } : { warning: 'ChatGPT plan usage permission is missing. Reconnect and grant permission.', errorCode: 'INSUFFICIENT_SCOPE' }),
        };
        return committed;
      });
      activated = permitted;
      this.confirmTransition(committed);
      if (!permitted) throw new PlanError('INSUFFICIENT_SCOPE', 'ChatGPT plan usage permission is missing. Reconnect and grant permission.');
      // Grant activation is complete. Catalog/network failures or a late browser
      // cancellation must never revoke it; catalog updates have their own lifecycle.
      await this.initialize();
      if (this.connected && !this.blocked && !this.disposed && this.observedGeneration === committed?.generation) {
        notify({ message: 'Connected. Models are provided by the Pi catalog.' });
        this.changed();
      }
    } finally {
      try {
        await listener.close();
        if (issued && !activated && !revocationAttempted) await this.oauth.revoke(issued.registration, issued.tokens).catch(() => false);
      } finally {
        this.liveAuthorization = false;
        if (this.authorizationSettled === settled) this.authorizationSettled = undefined;
        settle();
      }
    }
  }

  async refreshModels(signal?: AbortSignal): Promise<CatalogModel[]> {
    if (this.disposed) throw new PlanError('ABORTED', 'The plugin was unloaded.');
    const call = this.requestSignal(signal);
    try {
      throwIfAborted(call.signal);
      await this.catalog.refresh(call.signal);
      throwIfAborted(call.signal);
      this.changed();
      return this.models();
    } catch (error) { throw safeError(error); }
    finally { call.release(); }
  }

  async invalidate(generation: number, error: PlanError): Promise<void> {
    let committed: StoredSession | undefined;
    await this.repository.update(async session => {
      if (session.generation !== generation || session.state !== 'connected') return undefined;
      const { tokens: _tokens, ...retained } = session;
      committed = { ...retained, generation: session.generation + 1, state: 'needs-reconnect', models: [], warning: error.message, errorCode: error.code };
      return committed;
    });
    this.confirmTransition(committed);
  }

  async disconnect(): Promise<DisconnectResult> {
    this.stateEpoch++;
    this.disconnecting++;
    try {
      this.blocked = true;
      this.stopCalls();
      this.connected = false;
      let revocationConfirmed = true;
      let committed: StoredSession | undefined;
      await this.repository.update(async session => {
        const registration = activeRegistration(session);
        if (session.tokens && registration) revocationConfirmed = await this.oauth.revoke(registration, session.tokens);
        const { tokens: _tokens, warning: _warning, errorCode: _error, ...retained } = session;
        committed = {
          ...retained, generation: session.generation + 1, state: 'disconnected', models: [],
          ...(!revocationConfirmed ? { warning: 'Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.' } : {}),
        };
        return committed;
      });
      this.confirmTransition(committed);
      return { status: await this.status(), revocationConfirmed };
    } finally { this.disconnecting--; }
  }

  private stopCalls(): void { for (const controller of this.calls) controller.abort(); this.calls.clear(); }
  dispose(): void { this.stateEpoch++; this.disposed = true; this.blocked = true; this.connected = false; this.stopCalls(); this.catalog.dispose(); }
}

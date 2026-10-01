import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { z } from 'zod';
import { PlanError, safeError, throwIfAborted } from './errors.ts';

export const OPENAI_ISSUER = 'https://auth.openai.com';
export const API_RESOURCE = 'https://api.openai.com/v1';
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export const DYNAMIC_CLIENT = 'dynamic_agent_client';
const AUTHORIZE_URL = `${OPENAI_ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${OPENAI_ISSUER}/api/accounts/oauth/token`;
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', DIRECT_SCOPE];

export interface Identity {
  subject: string;
  issuer: string;
  email?: string | undefined;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string | undefined;
  expiresAt: number;
  scopes: string[];
}

export interface Registration extends Identity {
  clientId: string;
}

export interface PendingAuthorization {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
}

export function createPendingAuthorization(): PendingAuthorization {
  const verifier = randomBytes(32).toString('base64url');
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

export function buildAuthorizationUrl(
  pending: PendingAuthorization,
  redirectUri: string,
  hostId: string,
  registration?: Pick<Registration, 'clientId' | 'email'>,
  reconsent = false,
): string {
  const url = new URL(AUTHORIZE_URL);
  const parameters: Record<string, string> = {
    client_id: registration?.clientId ?? DYNAMIC_CLIENT,
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    resource: API_RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: 'S256',
    code_challenge: pending.challenge,
  };
  if (!registration) parameters.agent_name_hint = 'DeepSeek Harness ChatGPT Plan';
  if (registration?.email) parameters.login_hint = registration.email;
  // ID-token hints are deliberately omitted: the URL is passed to the Client.
  if (reconsent) parameters.prompt = 'consent';
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.href;
}

export interface CallbackResult { code: string; clientId: string }
export interface CallbackListener {
  redirectUri: string;
  result: Promise<CallbackResult>;
  close(): Promise<void>;
}

function stateMatches(actual: string | null, expected: string): boolean {
  if (actual === null || actual.length !== expected.length) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Only the port varies; scheme, host, and callback path remain stable. */
export async function startCallbackListener(
  state: string,
  clientId: string | undefined,
  signal: AbortSignal,
  timeoutMs = 300_000,
): Promise<CallbackListener> {
  throwIfAborted(signal);
  let resolveResult!: (value: CallbackResult) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<CallbackResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // A cancellation can arrive before the flow starts awaiting the callback.
  void result.catch(() => {});
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expectedHost = '';
  const server: Server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method !== 'GET' || request.headers.host !== expectedHost || (request.url?.length ?? 0) > 8192) {
      response.writeHead(400).end('Invalid callback request.');
      return;
    }
    const url = new URL(request.url ?? '/', `http://${expectedHost}`);
    if (url.pathname !== '/auth/callback') { response.writeHead(404).end('Not found.'); return; }
    if (settled || url.searchParams.getAll('state').length !== 1 || !stateMatches(url.searchParams.get('state'), state)) {
      response.writeHead(400).end('Invalid authorization state.');
      return;
    }
    if (url.searchParams.has('error')) {
      response.writeHead(400).end('Authorization was declined. Return to DeepSeek Harness.');
      finish(new PlanError('CONSENT_DENIED', 'Authorization was declined. You can reconnect when ready.'));
      return;
    }
    const issuedClient = url.searchParams.get('client_id') ?? clientId;
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.getAll('code').length !== 1 || !issuedClient || issuedClient === DYNAMIC_CLIENT
      || url.searchParams.getAll('client_id').length > 1 || (clientId && issuedClient !== clientId)) {
      response.writeHead(400).end('Incomplete or mismatched registration. Return to DeepSeek Harness.');
      finish(new PlanError('INVALID_CALLBACK', 'OpenAI returned an incomplete or mismatched registration. Start sign-in again.'));
      return;
    }
    response.writeHead(200).end('Authorization received. Return to DeepSeek Harness to complete sign-in.');
    finish(undefined, { code, clientId: issuedClient });
  });

  function finish(error?: unknown, value?: CallbackResult): void {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (error) rejectResult(error); else resolveResult(value!);
  }
  function abort(): void {
    finish(new PlanError('ABORTED', 'Sign-in was cancelled.'));
    server.close();
    server.closeAllConnections();
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new PlanError('CALLBACK_FAILED', 'Could not start the local callback.'); }
  expectedHost = `127.0.0.1:${address.port}`;
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  timer = setTimeout(() => { finish(new PlanError('AUTH_TIMEOUT', 'Sign-in timed out. Start again.')); server.close(); }, timeoutMs);
  return {
    redirectUri: `http://${expectedHost}/auth/callback`, result,
    async close() {
      finish(new PlanError('ABORTED', 'Sign-in was cancelled.'));
      if (timer) clearTimeout(timer);
      server.closeAllConnections();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive().finite(),
  token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
  scope: z.string().optional(),
});

export interface IdentityVerifier {
  validate(token: string, clientId: string, nonce?: string): Promise<Identity>;
}

export class OpenAIIdentityVerifier implements IdentityVerifier {
  private keys?: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly transport: typeof fetch = fetch) {}

  async validate(token: string, clientId: string, nonce?: string): Promise<Identity> {
    try {
      if (!this.keys) {
        const discovery = await openidConfiguration(this.transport);
        this.keys = createRemoteJWKSet(new URL(discovery.jwks_uri), { [customFetch]: this.transport });
      }
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: OPENAI_ISSUER, audience: clientId,
        algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'],
        requiredClaims: ['sub', 'iss', 'aud', 'exp', ...(nonce ? ['nonce'] : [])],
      });
      if (!payload.sub || (nonce && payload.nonce !== nonce)) throw new Error('Invalid identity');
      return { subject: payload.sub, issuer: OPENAI_ISSUER, ...(typeof payload.email === 'string' ? { email: payload.email } : {}) };
    } catch { throw new PlanError('INVALID_IDENTITY', 'OpenAI identity validation failed. Start sign-in again.'); }
  }
}

const Configuration = z.object({ issuer: z.literal(OPENAI_ISSUER), jwks_uri: z.string().url(), revocation_endpoint: z.string().url().optional() });
export async function openidConfiguration(transport: typeof fetch): Promise<z.infer<typeof Configuration>> {
  const response = await transport(`${OPENAI_ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new PlanError('NETWORK', 'OpenAI identity discovery is temporarily unavailable.');
  const discovery = Configuration.parse(await response.json());
  for (const endpoint of [discovery.jwks_uri, discovery.revocation_endpoint]) {
    if (endpoint && new URL(endpoint).origin !== OPENAI_ISSUER) throw new PlanError('INVALID_DISCOVERY', 'OpenAI returned an untrusted identity endpoint.');
  }
  return discovery;
}

export class OAuthClient {
  constructor(private readonly transport: typeof fetch = fetch, private readonly verifier: IdentityVerifier = new OpenAIIdentityVerifier(transport)) {}

  private async token(parameters: Record<string, string>, signal?: AbortSignal) {
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await this.transport(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters), redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
    } catch (error) { throw safeError(error); }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const code = z.object({ error: z.string() }).safeParse(body);
      if (code.success && ['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(code.data.error)) {
        throw new PlanError('AUTH', 'The renewable session is no longer valid. Reconnect this profile.', response.status);
      }
      throw new PlanError(response.status >= 500 ? 'SERVER' : 'OAUTH_REJECTED', 'OpenAI could not complete authentication. Start sign-in again.', response.status);
    }
    const parsed = TokenResponse.safeParse(await response.json());
    if (!parsed.success) throw new PlanError('INVALID_TOKEN_RESPONSE', 'OpenAI returned an incomplete token response. Start sign-in again.');
    return parsed.data;
  }

  async exchange(callback: CallbackResult, pending: PendingAuthorization, redirectUri: string, signal: AbortSignal): Promise<{ registration: Registration; tokens: TokenSet }> {
    const result = await this.token({ grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code, code_verifier: pending.verifier, redirect_uri: redirectUri, resource: API_RESOURCE }, signal);
    if (!result.id_token || !result.refresh_token || !result.scope) throw new PlanError('INVALID_TOKEN_RESPONSE', 'OpenAI did not provide a complete renewable session.');
    const identity = await this.verifier.validate(result.id_token, callback.clientId, pending.nonce);
    throwIfAborted(signal);
    const tokens = this.normalize(result, result.refresh_token);
    return { registration: { ...identity, clientId: callback.clientId }, tokens };
  }

  async refresh(registration: Registration, previous: TokenSet, signal?: AbortSignal): Promise<TokenSet> {
    const result = await this.token({ grant_type: 'refresh_token', client_id: registration.clientId, refresh_token: previous.refreshToken, resource: API_RESOURCE }, signal);
    if (result.id_token) {
      const identity = await this.verifier.validate(result.id_token, registration.clientId);
      if (identity.subject !== registration.subject || identity.issuer !== registration.issuer) throw new PlanError('AUTH', 'The refreshed identity does not match this profile. Reconnect.');
    }
    const tokens = this.normalize(result, result.refresh_token ?? previous.refreshToken, previous);
    this.assertPermission(tokens);
    return tokens;
  }

  private normalize(result: z.infer<typeof TokenResponse>, refreshToken: string, previous?: TokenSet): TokenSet {
    return {
      accessToken: result.access_token, refreshToken,
      ...(result.id_token ?? previous?.idToken ? { idToken: result.id_token ?? previous?.idToken } : {}),
      expiresAt: Date.now() + result.expires_in * 1000,
      scopes: result.scope ? result.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [],
    };
  }

  private assertPermission(tokens: TokenSet): void {
    if (!tokens.scopes.includes(DIRECT_SCOPE) || !tokens.scopes.includes('resource.invoke')) {
      throw new PlanError('INSUFFICIENT_SCOPE', 'ChatGPT plan usage permission is missing. Reconnect and grant permission.');
    }
  }

  async revoke(registration: Registration, tokens: TokenSet): Promise<boolean> {
    try {
      const discovery = await openidConfiguration(this.transport);
      if (!discovery.revocation_endpoint) return false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await this.transport(discovery.revocation_endpoint, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: registration.clientId }),
          });
          if (response.status === 200) return true;
          if (response.status < 500) return false;
        } catch { /* Retry transient revocation failures while the token remains available. */ }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    } catch { /* Local sign-out still completes, with an explicit warning. */ }
    return false;
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { API_RESOURCE, DIRECT_SCOPE, DYNAMIC_CLIENT, OPENAI_ISSUER, OAuthClient, OpenAIIdentityVerifier, buildAuthorizationUrl, createPendingAuthorization, startCallbackListener } from '../packages/plugin/src/oauth.ts';
import { registration, tokenSet } from './helpers.ts';

test('dynamic registration binds fresh PKCE, state, nonce, resource and exact redirect', () => {
  const pending = createPendingAuthorization();
  const again = createPendingAuthorization();
  assert.notEqual(pending.state, again.state); assert.notEqual(pending.nonce, again.nonce);
  assert.equal(pending.challenge, createHash('sha256').update(pending.verifier).digest('base64url'));
  const url = new URL(buildAuthorizationUrl(pending, 'http://127.0.0.1:1234/auth/callback', 'test-host'));
  assert.equal(url.origin, OPENAI_ISSUER);
  assert.equal(url.searchParams.get('client_id'), DYNAMIC_CLIENT);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:1234/auth/callback');
  assert.equal(url.searchParams.get('resource'), API_RESOURCE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('scope')?.split(' ').includes(DIRECT_SCOPE));
  assert.equal(url.searchParams.get('nonce'), pending.nonce);
});

test('reauthorization keeps the issued client and never exposes an ID-token hint to Client', () => {
  const url = new URL(buildAuthorizationUrl(createPendingAuthorization(), 'http://127.0.0.1:4321/auth/callback', 'test-host', registration, true));
  assert.equal(url.searchParams.get('client_id'), registration.clientId);
  assert.equal(url.searchParams.get('agent_name_hint'), null);
  assert.equal(url.searchParams.get('id_token_hint'), null);
  assert.equal(url.searchParams.get('prompt'), 'consent');
});

test('callback rejects malformed states without accepting them, then accepts one valid callback', async () => {
  const controller = new AbortController();
  const listener = await startCallbackListener('test-state', undefined, controller.signal);
  try {
    const wrong = new URL(listener.redirectUri); wrong.search = new URLSearchParams({ state: 'xxxxxxxxxx', code: 'test-code', client_id: 'issued-client' }).toString();
    assert.equal((await fetch(wrong)).status, 400);
    wrong.searchParams.set('state', 'éééééééééé'); assert.equal((await fetch(wrong)).status, 400);
    const valid = new URL(listener.redirectUri); valid.search = new URLSearchParams({ state: 'test-state', code: 'test-code', client_id: 'issued-client' }).toString();
    assert.equal((await fetch(valid)).status, 200);
    assert.deepEqual(await listener.result, { code: 'test-code', clientId: 'issued-client' });
    assert.equal((await fetch(valid)).status, 400);
  } finally { await listener.close(); }
});

test('returning callback refuses a different client and cancellation closes the listener', async () => {
  const controller = new AbortController();
  const listener = await startCallbackListener('test-state', 'selected-client', controller.signal);
  const url = new URL(listener.redirectUri); url.search = new URLSearchParams({ state: 'test-state', code: 'test-code', client_id: 'different-client' }).toString();
  assert.equal((await fetch(url)).status, 400);
  await assert.rejects(listener.result, { code: 'INVALID_CALLBACK' }); await listener.close();
  const cancelled = await startCallbackListener('test-state', undefined, controller.signal);
  controller.abort(); await assert.rejects(cancelled.result, { code: 'ABORTED' }); await cancelled.close();
});

test('OIDC validates a real signature, audience, issuer, expiry, and nonce', async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const transport: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('openid-configuration')) return Response.json({ issuer: OPENAI_ISSUER, jwks_uri: `${OPENAI_ISSUER}/test-jwks` });
    assert.equal(url, `${OPENAI_ISSUER}/test-jwks`); return Response.json({ keys: [jwk] });
  };
  const verifier = new OpenAIIdentityVerifier(transport);
  const sign = (audience = 'issued-client', issuer = OPENAI_ISSUER, expires = Math.floor(Date.now() / 1000) + 300) => new SignJWT({ nonce: 'expected-nonce', email: 'test@example.invalid' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setSubject('verified-account').setAudience(audience).setExpirationTime(expires).sign(keys.privateKey);
  const valid = await sign();
  assert.equal((await verifier.validate(valid, 'issued-client', 'expected-nonce')).subject, 'verified-account');
  for (const [token, nonce] of [[await sign('wrong-client'), 'expected-nonce'], [await sign('issued-client', 'https://untrusted.invalid'), 'expected-nonce'], [await sign('issued-client', OPENAI_ISSUER, 1), 'expected-nonce'], [valid, 'wrong-nonce'], [`${valid.slice(0, -10)}AAAAAAAAAA`, 'expected-nonce']]) {
    await assert.rejects(verifier.validate(token!, 'issued-client', nonce!), { code: 'INVALID_IDENTITY' });
  }
});

test('code exchange and rotating refresh use form data with the issued client', async () => {
  const calls: URLSearchParams[] = [];
  const transport: typeof fetch = async (_input, init) => {
    calls.push(new URLSearchParams(String(init?.body)));
    return Response.json({ access_token: 'test-access', refresh_token: 'test-rotated-refresh', id_token: 'test-id', token_type: 'Bearer', expires_in: 3600, scope: `openid resource.invoke ${DIRECT_SCOPE}` });
  };
  const verifier = { validate: async () => ({ subject: registration.subject, issuer: OPENAI_ISSUER }) };
  const oauth = new OAuthClient(transport, verifier);
  const pending = createPendingAuthorization();
  const grant = await oauth.exchange({ code: 'test-code', clientId: registration.clientId }, pending, 'http://127.0.0.1:4567/auth/callback', new AbortController().signal);
  assert.equal(calls[0]?.get('client_id'), registration.clientId); assert.equal(calls[0]?.get('code_verifier'), pending.verifier);
  assert.equal(calls[0]?.get('redirect_uri'), 'http://127.0.0.1:4567/auth/callback');
  const rotated = await oauth.refresh(grant.registration, tokenSet());
  assert.equal(rotated.refreshToken, 'test-rotated-refresh');
  assert.equal(calls[1]?.get('grant_type'), 'refresh_token'); assert.equal(calls[1]?.get('scope'), null);
});

test('refresh preserves credentials on transient failure and classifies terminal grants', async () => {
  const unavailable = new OAuthClient(async () => Response.json({ error: 'server_error', error_description: 'must not appear in diagnostics' }, { status: 503 }));
  await assert.rejects(unavailable.refresh(registration, tokenSet()), { code: 'SERVER' });
  const invalid = new OAuthClient(async () => Response.json({ error: 'invalid_grant', error_description: 'secret-test-detail' }, { status: 400 }));
  await assert.rejects(invalid.refresh(registration, tokenSet()), error => (error as Error).message.indexOf('secret-test-detail') < 0 && (error as { code: string }).code === 'AUTH');
});

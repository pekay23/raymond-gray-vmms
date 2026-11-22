import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import type { Config } from '../src/config.js';
import { OidcClient, newAuthorizationParameters } from '../src/oidc-client.js';
import { verifyBackchannelLogout } from '../src/oidc-logout.js';

const clientId = 'vmms-oidc-test';
const clientSecret = 'synthetic-oidc-client-secret-only-for-loopback-tests';
const callbackUrl = 'http://127.0.0.1:4100/api/v1/auth/oidc/callback';
const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingJwk = signingKeys.publicKey.export({ format: 'jwk' });
let server: Server;
let issuer = '';
let provider: OidcClient;
let testConfig: Config;
let tokenOutage = false;
let jwksRequests = 0;
const receivedTokenCodes: string[] = [];
const challengesByCode = new Map<string, string>();
const tokensByCode = new Map<string, string>();
const oauthFormEncode = (value: string) => encodeURIComponent(value).replace(/(?:[-_.!~*'()]|%20)/g, (character) => {
  if (character === '%20') return '+';
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
});

function json(reply: ServerResponse, status: number, body: unknown) {
  reply.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  reply.end(JSON.stringify(body));
}

async function form(request: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return new URLSearchParams(body);
}

function signedToken(claims: Record<string, unknown>, key = signingKeys.privateKey, typ = 'JWT', alg = 'RS256') {
  const header = Buffer.from(JSON.stringify({ alg, typ, kid: 'vmms-test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url')}`;
}

async function setToken(code: string, options: {
  issuer?: string;
  audience?: string;
  nonce?: string;
  expiry?: number;
  acr?: string;
  amr?: string[];
  strictMfa?: boolean;
  provider?: OidcClient;
} = {}) {
  const parameters = newAuthorizationParameters();
  const activeProvider = options.provider ?? (options.strictMfa ? new OidcClient({ ...testConfig, OIDC_REQUIRE_MFA_ASSURANCE: true }) : provider);
  const authorizationUrl = await activeProvider.createAuthorizationUrl(parameters);
  const challenge = authorizationUrl.searchParams.get('code_challenge');
  assert.ok(challenge);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.get('client_id'), clientId);
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), callbackUrl);
  assert.equal(authorizationUrl.searchParams.get('state'), parameters.state);
  assert.equal(authorizationUrl.searchParams.get('nonce'), parameters.nonce);
  assert.ok(authorizationUrl.searchParams.get('scope')?.split(' ').includes('openid'));
  if (options.strictMfa) assert.equal(authorizationUrl.searchParams.get('acr_values'), 'urn:raymond-gray:auth:mfa');
  challengesByCode.set(code, challenge);
  const issuedAt = Math.floor(Date.now() / 1000);
  tokensByCode.set(code, signedToken({
    iss: options.issuer ?? issuer,
    sub: 'synthetic-subject',
    sid: 'synthetic-session',
    aud: options.audience ?? clientId,
    iat: issuedAt,
    exp: options.expiry ?? issuedAt + 300,
    nonce: options.nonce ?? parameters.nonce,
    ...(options.acr ? { acr: options.acr } : {}),
    ...(options.amr ? { amr: options.amr } : {}),
  }));
  const callback = new URL(callbackUrl);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', parameters.state);
  return { parameters, callback, issuedAt, activeProvider };
}

async function onRequest(request: IncomingMessage, reply: ServerResponse) {
  const address = request.url ?? '/';
  const issuerPath = new URL(issuer).pathname;
  if (request.method === 'GET' && address === `${issuerPath}/.well-known/openid-configuration`) {
    json(reply, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      end_session_endpoint: `${issuer}/logout`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      code_challenge_methods_supported: ['S256'],
    });
    return;
  }
  if (request.method === 'GET' && address === `${issuerPath}/jwks`) {
    jwksRequests += 1;
    json(reply, 200, { keys: [{ ...signingJwk, kid: 'vmms-test-key', use: 'sig', alg: 'RS256' }] });
    return;
  }
  if (request.method === 'POST' && address === `${issuerPath}/token`) {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from(`${oauthFormEncode(clientId)}:${oauthFormEncode(clientSecret)}`).toString('base64')}`);
    if (tokenOutage) {
      json(reply, 503, { error: 'temporarily_unavailable' });
      return;
    }
    const parameters = await form(request);
    const code = parameters.get('code') ?? '';
    receivedTokenCodes.push(code);
    const verifier = parameters.get('code_verifier') ?? '';
    const expectedChallenge = challengesByCode.get(code);
    const presentedChallenge = createHash('sha256').update(verifier).digest('base64url');
    if (parameters.get('grant_type') !== 'authorization_code'
      || parameters.get('redirect_uri') !== callbackUrl
      || !expectedChallenge
      || presentedChallenge !== expectedChallenge) {
      json(reply, 400, { error: 'invalid_grant' });
      return;
    }
    const token = tokensByCode.get(code);
    if (!token) {
      json(reply, 400, { error: 'invalid_grant' });
      return;
    }
    challengesByCode.delete(code);
    tokensByCode.delete(code);
    json(reply, 200, {
      access_token: 'synthetic-access-token',
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'openid profile email',
      id_token: token,
    });
    return;
  }
  json(reply, 404, { error: 'not_found' });
}

before(async () => {
  server = createServer((request, reply) => { void onRequest(request, reply); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The loopback OIDC test server did not open a TCP port.');
  issuer = `http://127.0.0.1:${address.port}/issuer`;
  testConfig = {
    DATABASE_URL: 'postgres://vmms_runtime:synthetic@127.0.0.1:5432/vmms',
    SESSION_SECRET: 'Synthetic-oidc-test-session-secret-long-enough',
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_REQUIRE_MFA_ASSURANCE: false,
    OIDC_CALLBACK_URL: callbackUrl,
    OIDC_LOGOUT_CALLBACK_URL: 'http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback',
    TRUSTED_PROXY_CIDRS: [],
    PORT: 4100,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    STAFF_MESSAGES_ENABLED: false,
  };
  provider = new OidcClient(testConfig);
});

test('configured MFA assurance is requested and verified from signed ID token claims', async () => {
  const valid = await setToken('mfa-valid-code', { strictMfa: true, acr: 'urn:raymond-gray:auth:mfa', amr: ['pwd', 'mfa'] });
  const accepted = await valid.activeProvider.exchangeAuthorizationCode({ ...valid.parameters, callbackUrl: valid.callback });
  assert.equal(accepted.subject, 'synthetic-subject');

  const missing = await setToken('mfa-missing-code', { strictMfa: true });
  await assert.rejects(missing.activeProvider.exchangeAuthorizationCode({ ...missing.parameters, callbackUrl: missing.callback }), /multi-factor authentication/);

  const wrongClass = await setToken('mfa-wrong-class-code', { strictMfa: true, acr: '0', amr: ['pwd'] });
  await assert.rejects(wrongClass.activeProvider.exchangeAuthorizationCode({ ...wrongClass.parameters, callbackUrl: wrongClass.callback }), /multi-factor authentication/);
});

test('OIDC client keeps an injected fetch adapter for the full provider exchange', async () => {
  let requests = 0;
  const injected = new OidcClient(testConfig, async (input, init) => {
    requests++;
    return fetch(new URL(input), init as unknown as RequestInit);
  });
  const transaction = await setToken('custom-fetch-code', { provider: injected });
  await injected.exchangeAuthorizationCode({ ...transaction.parameters, callbackUrl: transaction.callback });
  assert(requests >= 3, 'The injected fetch adapter should cover discovery, token exchange and JWKS retrieval.');
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('OIDC client validates callback binding, exact redirect, PKCE, issuer, audience, nonce, expiry and signature', async () => {
  const valid = await setToken('valid-code');
  const verified = await provider.exchangeAuthorizationCode({ ...valid.parameters, callbackUrl: valid.callback });
  assert.equal(verified.issuer, issuer);
  assert.equal(verified.subject, 'synthetic-subject');
  assert.equal(verified.sessionId, 'synthetic-session');
  assert.equal(verified.issuedAt, valid.issuedAt);
  assert(jwksRequests > 0, 'A valid ID token should be checked against the issuer JWKS.');

  const replayedCode = await setToken('single-use-code');
  await provider.exchangeAuthorizationCode({ ...replayedCode.parameters, callbackUrl: replayedCode.callback });
  await assert.rejects(provider.exchangeAuthorizationCode({ ...replayedCode.parameters, callbackUrl: replayedCode.callback }));

  const wrongState = await setToken('wrong-state-code');
  const changedState = new URL(wrongState.callback);
  changedState.searchParams.set('state', 'different-state');
  await assert.rejects(provider.exchangeAuthorizationCode({ ...wrongState.parameters, callbackUrl: changedState }));

  const wrongIssuer = await setToken('wrong-issuer-code', { issuer: `${issuer}/different` });
  await assert.rejects(provider.exchangeAuthorizationCode({ ...wrongIssuer.parameters, callbackUrl: wrongIssuer.callback }));

  const wrongAudience = await setToken('wrong-audience-code', { audience: 'another-relying-party' });
  await assert.rejects(provider.exchangeAuthorizationCode({ ...wrongAudience.parameters, callbackUrl: wrongAudience.callback }));

  const wrongNonce = await setToken('wrong-nonce-code', { nonce: 'different-nonce' });
  await assert.rejects(provider.exchangeAuthorizationCode({ ...wrongNonce.parameters, callbackUrl: wrongNonce.callback }));

  const expired = await setToken('expired-token-code', { expiry: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(provider.exchangeAuthorizationCode({ ...expired.parameters, callbackUrl: expired.callback }));

  const badSignature = await setToken('bad-signature-code');
  const [header, payload, signature] = tokensByCode.get('bad-signature-code')!.split('.');
  const unsignedInput = `${header}.${payload}`;
  const invalidSignature = Buffer.from(signature!, 'base64url');
  invalidSignature[0] = invalidSignature[0]! ^ 1;
  tokensByCode.set('bad-signature-code', `${unsignedInput}.${invalidSignature.toString('base64url')}`);
  assert.equal(verify('RSA-SHA256', Buffer.from(unsignedInput), signingKeys.publicKey, invalidSignature), false);
  let signatureError: unknown;
  try {
    await provider.exchangeAuthorizationCode({ ...badSignature.parameters, callbackUrl: badSignature.callback });
  } catch (error) {
    signatureError = error;
  }
  assert.ok(signatureError, 'ID tokens with a tampered signature must be rejected.');
  assert(signatureError instanceof Error);
  assert.match(signatureError.message, /invalid response encountered/i);
  assert.equal(receivedTokenCodes.at(-1), 'bad-signature-code');

  const wrongVerifier = await setToken('wrong-verifier-code');
  await assert.rejects(provider.exchangeAuthorizationCode({
    ...wrongVerifier.parameters,
    codeVerifier: `${wrongVerifier.parameters.codeVerifier}changed`,
    callbackUrl: wrongVerifier.callback,
  }));

  const redirected = await setToken('wrong-redirect-code');
  const wrongRedirect = new URL(redirected.callback);
  wrongRedirect.pathname = '/api/v1/not-the-callback';
  await assert.rejects(provider.exchangeAuthorizationCode({ ...redirected.parameters, callbackUrl: wrongRedirect }));

  tokenOutage = true;
  try {
    const unavailable = await setToken('provider-outage-code');
    await assert.rejects(provider.exchangeAuthorizationCode({ ...unavailable.parameters, callbackUrl: unavailable.callback }));
  } finally {
    tokenOutage = false;
  }
});

test('RP logout URL uses discovered endpoint and only the exact callback, client and state', async () => {
  const state = randomBytes(32).toString('base64url');
  const callback = 'http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback';
  const url = await provider.createLogoutUrl({ state, postLogoutRedirectUri: callback });
  assert.equal(url.origin, new URL(issuer).origin);
  assert.equal(url.pathname, `${new URL(issuer).pathname}/logout`);
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('post_logout_redirect_uri'), callback);
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.has('sid'), false);
  assert.equal(url.searchParams.has('id_token_hint'), false);
});

test('back-channel logout requires a signed, fresh, targeted logout token', async () => {
  const issuedAt=Math.floor(Date.now()/1000);
  const claims={iss:issuer,sub:'synthetic-subject',sid:'synthetic-session',aud:clientId,iat:issuedAt,exp:issuedAt+180,jti:'logout-jti-one',events:{'http://schemas.openid.net/event/backchannel-logout':{}}};
  const verified=await verifyBackchannelLogout(signedToken(claims,signingKeys.privateKey,'logout+jwt'),testConfig);
  assert.equal(verified.issuer,issuer);
  assert.equal(verified.clientId,clientId);
  assert.equal(verified.subject,'synthetic-subject');
  assert.equal(verified.sessionId,'synthetic-session');
  assert.equal(verified.issuedAt.getTime(),issuedAt*1000);
  assert.match(verified.jtiHash,/^[0-9a-f]{64}$/);

  await assert.rejects(verifyBackchannelLogout(signedToken(claims),testConfig),/logout token type/i);
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,nonce:'forbidden'},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,events:{'other-event':{}}},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,events:{'http://schemas.openid.net/event/backchannel-logout':[]}},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,sub:undefined,sid:undefined},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,aud:'different-client'},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,iss:`${issuer}/other`},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,exp:issuedAt-1},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken({...claims,iat:issuedAt+90,exp:issuedAt+300},signingKeys.privateKey,'logout+jwt'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken(claims,signingKeys.privateKey,'logout+jwt','HS256'),testConfig));
  await assert.rejects(verifyBackchannelLogout(signedToken(claims,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,'logout+jwt'),testConfig));
});

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Base64Url, toBase64Url } from '../src/util';
import { json, makeClient } from './helpers';

const CLIENT_ID = 'test-client-id';
const enc = new TextEncoder();

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
});

async function signJwt(claims: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const h = toBase64Url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })));
  const p = toBase64Url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${toBase64Url(new Uint8Array(sig))}`;
}

interface Mock {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  tokenRequests: URLSearchParams[];
}

function mockGoogle(claimsFor: (nonce: string) => Promise<Record<string, unknown>>, nonceRef: { nonce: string }): Mock {
  const tokenRequests: URLSearchParams[] = [];
  return {
    tokenRequests,
    fetch: async (input, init) => {
      if (input === 'https://oauth2.googleapis.com/token') {
        tokenRequests.push(new URLSearchParams(String(init?.body ?? '')));
        const id_token = await signJwt(await claimsFor(nonceRef.nonce));
        return new Response(JSON.stringify({ id_token, access_token: 'ignored' }), { status: 200 });
      }
      if (input === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    },
  };
}

const goodClaims = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-sub-123',
  email: 'Siti@Example.com',
  email_verified: true,
  name: 'Siti',
  nonce,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  ...over,
});

async function startFlow(c: ReturnType<typeof makeClient>, ret = '/halaman/7') {
  const res = await c.call('GET', `/auth/google/start?return=${encodeURIComponent(ret)}`, { headers: { 'CF-Connecting-IP': '198.51.100.1' } });
  const loc = new URL(res.headers.get('Location')!);
  const oauthCookie = res.headers.getSetCookie().find((s) => s.startsWith('mf_oauth='))!;
  return { res, loc, oauthCookie, state: loc.searchParams.get('state')!, nonce: loc.searchParams.get('nonce')! };
}

describe('Google OIDC authorization-code + PKCE', () => {
  it('happy path: start -> callback creates a session and redirects with ?sync=connected', async () => {
    const nonceRef = { nonce: '' };
    const mock = mockGoogle(async (n) => goodClaims(n), nonceRef);
    const c = makeClient({ fetch: mock.fetch });

    const { res, loc, oauthCookie, state, nonce } = await startFlow(c);
    nonceRef.nonce = nonce;
    expect(res.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(loc.searchParams.get('redirect_uri')).toBe('https://mushaf.test/api/v1/auth/google/callback');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(oauthCookie).toMatch(/HttpOnly/);
    const stored = await env.DB.prepare('SELECT state FROM oauth_states').all();
    expect(stored.results).toHaveLength(1);

    const cb = await c.call('GET', `/auth/google/callback?code=abc&state=${state}`, {
      cookie: oauthCookie.split(';')[0]!,
      headers: { 'CF-Connecting-IP': '198.51.100.1' },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('Location')).toBe('/halaman/7?sync=connected');

    // PKCE: the verifier sent to the token endpoint hashes to the challenge from /start.
    const sent = mock.tokenRequests[0]!;
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('abc');
    expect(sent.get('client_secret')).toBe('test-client-secret');
    expect(await sha256Base64Url(sent.get('code_verifier')!)).toBe(loc.searchParams.get('code_challenge'));

    const session = cb.headers.getSetCookie().find((s) => s.startsWith('mf_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/);
    const me = await json(await c.call('GET', '/me', { cookie: session.split(';')[0]! }));
    expect(me.data.user).toMatchObject({ email: 'siti@example.com', name: 'Siti' });

    // The same state cannot be replayed.
    const replay = await c.call('GET', `/auth/google/callback?code=abc&state=${state}`, { cookie: oauthCookie.split(';')[0]! });
    expect(replay.status).toBe(400);
  });

  it('a second login by the same Google subject reuses the account', async () => {
    const nonceRef = { nonce: '' };
    const c = makeClient({ fetch: mockGoogle(async (n) => goodClaims(n), nonceRef).fetch });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const f = await startFlow(c);
      nonceRef.nonce = f.nonce;
      const cb = await c.call('GET', `/auth/google/callback?code=x&state=${f.state}`, { cookie: f.oauthCookie.split(';')[0]! });
      const cookie = cb.headers.getSetCookie().find((s) => s.startsWith('mf_session='))!.split(';')[0]!;
      ids.push((await json(await c.call('GET', '/me', { cookie }))).data.user.id);
    }
    expect(ids[0]).toBe(ids[1]);
  });

  const failures: [string, (n: string) => Record<string, unknown>][] = [
    ['wrong audience', (n) => goodClaims(n, { aud: 'someone-else' })],
    ['wrong issuer', (n) => goodClaims(n, { iss: 'https://evil.example' })],
    ['expired', (n) => goodClaims(n, { exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['unverified email', (n) => goodClaims(n, { email_verified: false })],
    ['nonce mismatch', () => goodClaims('other-nonce')],
  ];
  for (const [label, claims] of failures) {
    it(`rejects an id_token with ${label}: no session, redirect ?sync=error`, async () => {
      const nonceRef = { nonce: '' };
      const c = makeClient({ fetch: mockGoogle(async (n) => claims(n), nonceRef).fetch });
      const f = await startFlow(c);
      nonceRef.nonce = f.nonce;
      const cb = await c.call('GET', `/auth/google/callback?code=x&state=${f.state}`, { cookie: f.oauthCookie.split(';')[0]! });
      expect(cb.status).toBe(302);
      expect(cb.headers.get('Location')).toBe('/halaman/7?sync=error');
      expect(cb.headers.getSetCookie().some((s) => s.startsWith('mf_session='))).toBe(false);
      expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n).toBe(0);
    });
  }

  it('rejects a tampered signature', async () => {
    const nonceRef = { nonce: '' };
    const base = mockGoogle(async (n) => goodClaims(n), nonceRef);
    const c = makeClient({
      fetch: async (input, init) => {
        const res = await base.fetch(input, init);
        if (input !== 'https://oauth2.googleapis.com/token') return res;
        const b = (await res.json()) as { id_token: string };
        const [h, , s] = b.id_token.split('.');
        const forged = toBase64Url(enc.encode(JSON.stringify(goodClaims(nonceRef.nonce, { sub: 'attacker' }))));
        return new Response(JSON.stringify({ id_token: `${h}.${forged}.${s}` }));
      },
    });
    const f = await startFlow(c);
    nonceRef.nonce = f.nonce;
    const cb = await c.call('GET', `/auth/google/callback?code=x&state=${f.state}`, { cookie: f.oauthCookie.split(';')[0]! });
    expect(cb.headers.get('Location')).toBe('/halaman/7?sync=error');
  });

  it('requires the browser-binding cookie and a known, unexpired state', async () => {
    const c = makeClient({ fetch: mockGoogle(async (n) => goodClaims(n), { nonce: '' }).fetch });
    const f = await startFlow(c);
    expect((await c.call('GET', `/auth/google/callback?code=x&state=${f.state}`)).status).toBe(400); // no cookie
    const f2 = await startFlow(c);
    expect((await c.call('GET', `/auth/google/callback?code=x&state=unknown`, { cookie: f2.oauthCookie.split(';')[0]! })).status).toBe(400);
    const f3 = await startFlow(c);
    await env.DB.prepare('UPDATE oauth_states SET expires_at = 1 WHERE state = ?1').bind(f3.state).run();
    expect((await c.call('GET', `/auth/google/callback?code=x&state=${f3.state}`, { cookie: f3.oauthCookie.split(';')[0]! })).status).toBe(400);
  });

  it('start sanitises the return path and the denied flow redirects back', async () => {
    const c = makeClient({ fetch: mockGoogle(async (n) => goodClaims(n), { nonce: '' }).fetch });
    const f = await startFlow(c, '//evil.example/x');
    const row = await env.DB.prepare('SELECT return_to FROM oauth_states WHERE state = ?1').bind(f.state).first<{ return_to: string }>();
    expect(row!.return_to).toBe('/');
    const cb = await c.call('GET', `/auth/google/callback?error=access_denied&state=${f.state}`, { cookie: f.oauthCookie.split(';')[0]! });
    expect(cb.headers.get('Location')).toBe('/?sync=denied');
  });

  it('start returns 503 when Google is not configured', async () => {
    const c = makeClient();
    const res = await c.call('GET', '/auth/google/start', { envOverride: { GOOGLE_CLIENT_ID: undefined } });
    expect(res.status).toBe(503);
  });
});

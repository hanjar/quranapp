import { fromBase64Url, isRecord } from './util';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

export interface JwksCache {
  get(kid: string, fetchFn: FetchFn, now: number): Promise<CryptoKey | null>;
}

/** Caches Google's signing keys (honouring a bounded TTL) and refetches once on an unknown kid. */
export function createJwksCache(): JwksCache {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = 0;
  const TTL_MS = 60 * 60 * 1000;
  const MIN_REFETCH_MS = 60 * 1000;

  async function load(fetchFn: FetchFn, now: number): Promise<void> {
    const res = await fetchFn(GOOGLE_JWKS_URL);
    if (!res.ok) throw new Error('jwks_fetch_failed');
    const body: unknown = await res.json();
    if (!isRecord(body) || !Array.isArray(body['keys'])) throw new Error('jwks_invalid');
    const next = new Map<string, CryptoKey>();
    for (const k of body['keys'] as unknown[]) {
      if (!isRecord(k) || k['kty'] !== 'RSA' || typeof k['kid'] !== 'string') continue;
      if (typeof k['n'] !== 'string' || typeof k['e'] !== 'string') continue;
      const jwk: Jwk = { kid: k['kid'], kty: 'RSA', n: k['n'], e: k['e'] };
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      next.set(jwk.kid, key);
    }
    keys = next;
    fetchedAt = now;
  }

  return {
    async get(kid, fetchFn, now) {
      const stale = now - fetchedAt > TTL_MS;
      const cached = keys.get(kid);
      if (cached && !stale) return cached;
      if (stale || now - fetchedAt > MIN_REFETCH_MS) await load(fetchFn, now);
      return keys.get(kid) ?? null;
    },
  };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export interface VerifyOptions {
  clientId: string;
  nonce: string;
  now: number; // ms
  fetchFn: FetchFn;
  jwks: JwksCache;
}

function decodeJsonPart(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as unknown;
}

/**
 * Verifies a Google OIDC id_token: RS256 signature against Google's JWKS and the iss / aud / exp /
 * nonce / email_verified claims. Throws on any failure (callers must not reveal the reason).
 */
export async function verifyGoogleIdToken(idToken: string, opts: VerifyOptions): Promise<GoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJsonPart(h);
  const claims = decodeJsonPart(p);
  if (!isRecord(header) || !isRecord(claims)) throw new Error('malformed');
  if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') throw new Error('bad_alg');

  const key = await opts.jwks.get(header['kid'], opts.fetchFn, opts.now);
  if (!key) throw new Error('unknown_kid');
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    fromBase64Url(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new Error('bad_signature');

  const iss = claims['iss'];
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') throw new Error('bad_iss');
  const aud = claims['aud'];
  const audOk = Array.isArray(aud) ? aud.includes(opts.clientId) : aud === opts.clientId;
  if (!audOk) throw new Error('bad_aud');
  const exp = claims['exp'];
  const SKEW_S = 60;
  if (typeof exp !== 'number' || exp + SKEW_S < opts.now / 1000) throw new Error('expired');
  if (claims['nonce'] !== opts.nonce) throw new Error('bad_nonce');
  const ev = claims['email_verified'];
  if (ev !== true && ev !== 'true') throw new Error('email_unverified');
  const sub = claims['sub'];
  const email = claims['email'];
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) throw new Error('bad_sub');
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) throw new Error('bad_email');
  const name = typeof claims['name'] === 'string' ? claims['name'].slice(0, 200) : null;
  return { sub, email: email.toLowerCase(), name };
}

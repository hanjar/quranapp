const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await sha256(input);
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Base64Url(input: string): Promise<string> {
  return toBase64Url(await sha256(input));
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only a same-origin relative path is acceptable as a post-login destination. */
export function sanitizeReturnPath(raw: string | null | undefined): string {
  const fallback = '/';
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, 'https://same-origin.invalid');
    if (u.origin !== 'https://same-origin.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

export function withSyncParam(path: string, value: 'connected' | 'error' | 'denied'): string {
  const u = new URL(path, 'https://same-origin.invalid');
  u.searchParams.set('sync', value);
  return u.pathname + u.search + u.hash;
}

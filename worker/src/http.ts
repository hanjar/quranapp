import type { Context } from 'hono';
import type { Env } from './env';

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string | null;
  name: string | null;
}

export interface AppBindings {
  Bindings: Env;
  Variables: { auth: AuthContext | null };
}

export type Ctx = Context<AppBindings>;

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const MAX_BODY_BYTES = 256 * 1024;

/** Reads and parses a JSON body with a hard byte cap (also enforced while streaming). */
export async function readJsonBody(c: Ctx, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = c.req.header('Content-Type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
  }
  const body = c.req.raw.body;
  if (!body) throw new ApiError(400, 'invalid_json', 'Request body is required.');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    merged.set(ch, off);
    off += ch.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

export function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function buildCookie(
  name: string,
  value: string,
  opts: { maxAge: number; path: string; secure: boolean },
): string {
  return `${name}=${value}; Max-Age=${opts.maxAge}; Path=${opts.path}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

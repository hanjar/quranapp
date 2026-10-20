import { env } from 'cloudflare:workers';
import { createApp, type Deps } from '../src/app';

export const ORIGIN = 'https://mushaf.test';
export const BASE = `${ORIGIN}/api/v1`;

export interface CallOpts {
  cookie?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  csrf?: boolean;
  envOverride?: Record<string, unknown>;
}

export function makeClient(deps: Partial<Deps> = {}) {
  const app = createApp(deps);
  async function call(method: string, path: string, opts: CallOpts = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    if (method !== 'GET' && opts.csrf !== false) headers['X-Mushaf-Client'] = '1';
    let body: string | undefined;
    if (opts.rawBody !== undefined) body = opts.rawBody;
    else if (opts.body !== undefined) body = JSON.stringify(opts.body);
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const e = { ...env, ...(opts.envOverride ?? {}) };
    return app.request(`${BASE}${path}`, { method, headers, body }, e);
  }
  async function login(email: string): Promise<string> {
    const res = await call('POST', '/auth/dev-login', { body: { email }, headers: { 'CF-Connecting-IP': `ip-${email}` } });
    if (res.status !== 200) throw new Error(`login failed ${res.status}`);
    return cookieFrom(res);
  }
  return { app, call, login };
}

export function cookieFrom(res: Response, name = 'mf_session'): string {
  const sc = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!sc) throw new Error(`no ${name} cookie`);
  return sc.split(';')[0] as string;
}

export const uid = (() => {
  let n = 0;
  return (p = 'op') => `${p}-${String(++n).padStart(6, '0')}-xxxxxxxx`;
})();

export function verseOp(id: string, surah: number, ayah: number, over: Record<string, unknown> = {}) {
  return {
    opId: uid(),
    entity: 'bookmark',
    entityId: id,
    action: 'upsert',
    baseRev: null,
    payload: {
      kind: 'verse',
      editionId: 'hafs-kfqc',
      page: 3,
      surah,
      ayah,
      key: `hafs-kfqc|verse|${surah}:${ayah}`,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      ...over,
    },
  };
}

export function prefsPayload(over: Record<string, unknown> = {}) {
  return {
    paperTheme: 'ivory',
    uiTheme: 'segar',
    layoutMode: 'auto',
    controlsAlwaysVisible: false,
    motion: 'system',
    highContrast: false,
    updatedAt: 1700000000000,
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json(res: Response): Promise<any> {
  return res.json();
}

import { Injectable } from '@angular/core';
import { APP_CONFIG } from '../config';
import { parseRetryAfter } from './backoff';
import { BatchResponse, MeUser, PullResponse, WireOp } from './sync-types';

export type SyncErrorKind = 'network' | 'unauthorized' | 'rate-limited' | 'server' | 'client' | 'protocol';

export class SyncHttpError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    readonly status: number | null = null,
    readonly code: string | null = null,
    readonly retryAfterMs: number | null = null,
    message?: string,
  ) {
    super(message ?? `Sync ${kind}${status ? ` (${status})` : ''}${code ? ` ${code}` : ''}`);
    this.name = 'SyncHttpError';
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** Thin typed wrapper over fetch for the frozen /api/v1 contract. */
@Injectable({ providedIn: 'root' })
export class SyncApiClient {
  private readonly base: string = APP_CONFIG.apiBase;

  startUrl(returnPath: string): string {
    return `${this.base}/auth/google/start?return=${encodeURIComponent(returnPath)}`;
  }

  async me(): Promise<MeUser | null> {
    try {
      const d = await this.request<{ user: MeUser | null }>('GET', '/me');
      return d.user ?? null;
    } catch (e) {
      if (e instanceof SyncHttpError && e.kind === 'unauthorized') return null;
      throw e;
    }
  }

  async devLogin(email: string): Promise<void> {
    await this.request('POST', '/auth/dev-login', { email });
  }

  async logout(): Promise<void> {
    await this.request('POST', '/auth/logout', {});
  }

  pull(cursor: number, limit = 500): Promise<PullResponse> {
    return this.request<PullResponse>('GET', `/sync?cursor=${cursor}&limit=${limit}`);
  }

  pushBatch(ops: WireOp[]): Promise<BatchResponse> {
    return this.request<BatchResponse>('POST', '/sync/batch', { ops });
  }

  async deleteMyData(): Promise<void> {
    await this.request('DELETE', '/me/data');
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'X-Mushaf-Client': '1', Accept: 'application/json' };
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(this.base + path, init);
    } catch {
      throw new SyncHttpError('network');
    }
    let env: Envelope<T> | null = null;
    try {
      env = (await res.json()) as Envelope<T>;
    } catch {
      env = null;
    }
    const code = env?.error?.code ?? null;
    if (res.status === 401) throw new SyncHttpError('unauthorized', 401, code);
    if (res.status === 429) {
      throw new SyncHttpError('rate-limited', 429, code, parseRetryAfter(res.headers.get('Retry-After')) ?? 0);
    }
    if (res.status >= 500) throw new SyncHttpError('server', res.status, code);
    if (!res.ok || env?.success === false) {
      throw new SyncHttpError('client', res.status, code, null, env?.error?.message);
    }
    if (!env) {
      throw new SyncHttpError('protocol', res.status, null, null, 'Respons server tidak valid');
    }
    return (env.data ?? ({} as T)) as T;
  }
}

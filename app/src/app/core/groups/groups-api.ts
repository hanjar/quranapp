import { Injectable } from '@angular/core';
import { APP_CONFIG } from '../config';

/** Khatam bersama (group khatam) — the /api/v1/groups contract. */

export interface GroupMember {
  id: string;
  nickname: string;
  isOwner: boolean;
}
export interface GroupJuz {
  juz: number;
  memberId: string | null;
  done: boolean;
}
export interface GroupDetail {
  id: string;
  name: string;
  round: number;
  khatamCount: number;
  inviteCode: string;
  isOwner: boolean;
  /** My member id in this group. */
  me: string;
  members: GroupMember[];
  juz: GroupJuz[];
}
export interface GroupSummary {
  id: string;
  name: string;
  round: number;
  khatamCount: number;
  memberCount: number;
  doneCount: number;
  myJuz: { juz: number; done: boolean }[];
}

export class GroupApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'GroupApiError';
  }
}

/** Indonesian message for an API failure. */
export function groupErrorText(e: unknown): string {
  if (!(e instanceof GroupApiError)) return 'Tidak tersambung. Periksa koneksi lalu coba lagi.';
  switch (e.code) {
    case 'unauthenticated':
      return 'Masuk dulu untuk memakai khatam bersama.';
    case 'not_found':
      return 'Grup atau undangan tidak ditemukan.';
    case 'group_full':
      return 'Grup ini sudah penuh.';
    case 'too_many_groups':
      return 'Anda sudah ikut terlalu banyak grup (maksimal 20).';
    case 'not_yours':
      return 'Juz ini milik anggota lain.';
    case 'round_open':
      return 'Masih ada juz yang belum selesai.';
    case 'forbidden':
      return 'Hanya pembuat grup yang bisa melakukan ini.';
    case 'validation_error':
      return 'Isian belum benar.';
    case 'rate_limited':
      return 'Terlalu sering. Tunggu sebentar.';
    default:
      return 'Terjadi kesalahan. Coba lagi.';
  }
}

/** Invite link for a code, on this app's origin. */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/grup/gabung/${code}`;
}

@Injectable({ providedIn: 'root' })
export class GroupsApi {
  private readonly base = `${APP_CONFIG.apiBase}/groups`;

  list(): Promise<GroupSummary[]> {
    return this.req<{ groups: GroupSummary[] }>('GET', '').then((d) => d.groups);
  }
  get(id: string): Promise<GroupDetail> {
    return this.req('GET', `/${enc(id)}`);
  }
  create(name: string, nickname?: string): Promise<GroupDetail> {
    return this.req('POST', '', { name, ...(nickname ? { nickname } : {}) });
  }
  invite(code: string): Promise<{ name: string; memberCount: number }> {
    return this.req('GET', `/invite/${enc(code)}`);
  }
  join(code: string, nickname?: string): Promise<GroupDetail> {
    return this.req('POST', '/join', { code, ...(nickname ? { nickname } : {}) });
  }
  update(id: string, patch: { name?: string; nickname?: string }): Promise<GroupDetail> {
    return this.req('PATCH', `/${enc(id)}`, patch);
  }
  mark(id: string, juz: number, done: boolean): Promise<GroupDetail> {
    return this.req('POST', `/${enc(id)}/juz/${juz}`, { done });
  }
  assign(id: string, juz: number, memberId: string | null): Promise<GroupDetail> {
    return this.req('POST', `/${enc(id)}/juz/${juz}/assign`, { memberId });
  }
  distribute(id: string): Promise<GroupDetail> {
    return this.req('POST', `/${enc(id)}/distribute`, {});
  }
  nextRound(id: string): Promise<GroupDetail> {
    return this.req('POST', `/${enc(id)}/next-round`, {});
  }
  leave(id: string): Promise<unknown> {
    return this.req('POST', `/${enc(id)}/leave`, {});
  }
  remove(id: string): Promise<unknown> {
    return this.req('DELETE', `/${enc(id)}`);
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['X-Mushaf-Client'] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new GroupApiError(0, 'network');
    }
    const j = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string } } | null;
    if (!res.ok || !j || j.data === undefined) throw new GroupApiError(res.status, j?.error?.code ?? 'server');
    return j.data;
  }
}

const enc = encodeURIComponent;

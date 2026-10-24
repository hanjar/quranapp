import { Injectable, effect, inject, signal } from '@angular/core';
import { APP_CONFIG } from './config';
import { SyncApi } from './contracts';

const KEY = 'mf-admin';

export interface UsageStats {
  today: string;
  days: { day: string; active: number; installed: number; signed_in: number }[];
  wau: number;
  mau: number;
  totalDevices: number;
  versions: { version: string | null; n: number }[];
  accounts: number;
  khatamFinished: number;
}

/** Owner-only extras (usage dashboard). The API enforces the allow-list; this only hides UI. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly sync = inject(SyncApi);
  readonly allowed = signal(read());
  private checkedFor: string | null = null;

  constructor() {
    effect(() => {
      const acc = this.sync.account();
      if (!acc) {
        this.checkedFor = null;
        return;
      }
      if (this.checkedFor === acc.id) return;
      this.checkedFor = acc.id;
      void fetch(`${APP_CONFIG.apiBase}/stats/access`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data?: { allowed?: boolean } } | null) => {
          if (j) this.set(j.data?.allowed === true);
        })
        .catch(() => undefined);
    });
  }

  async stats(): Promise<UsageStats> {
    const r = await fetch(`${APP_CONFIG.apiBase}/stats`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()) as { data: UsageStats }).data;
  }

  private set(v: boolean): void {
    this.allowed.set(v);
    try {
      if (v) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  }
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

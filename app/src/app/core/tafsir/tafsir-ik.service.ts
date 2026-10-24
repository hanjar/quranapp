import { Injectable, effect, inject, signal } from '@angular/core';
import { APP_CONFIG } from '../config';
import { SyncApi } from '../contracts';
import type { TafsirFile } from '../../features/tafsir/tafsir-format';

const ACCESS_KEY = 'mf-tafsir-ik-access';
const CACHE = 'mf-tafsir-ik-v1';

/**
 * Private Tafsir Ibnu Katsir (AI translation, not reviewed): only allow-listed accounts get it
 * from the API. Surahs once read stay in Cache Storage for offline reading.
 */
@Injectable({ providedIn: 'root' })
export class TafsirIkService {
  private readonly sync = inject(SyncApi);
  /** Remembered per device so the menu entry shows offline too. */
  readonly allowed = signal(readAccess());
  private checkedFor: string | null = null;
  private readonly memory = new Map<number, TafsirFile>();

  constructor() {
    effect(() => {
      const acc = this.sync.account();
      // No account yet (still loading, or a guest): keep the remembered answer; the API
      // itself refuses anyone not on the list.
      if (!acc) {
        this.checkedFor = null;
        return;
      }
      if (this.checkedFor === acc.id) return;
      this.checkedFor = acc.id;
      void this.checkAccess();
    });
  }

  private async checkAccess(): Promise<void> {
    try {
      const r = await fetch(`${APP_CONFIG.apiBase}/tafsir/access`, { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = (await r.json()) as { data?: { allowed?: boolean } };
      this.setAllowed(j.data?.allowed === true);
    } catch {
      /* offline: keep the remembered answer */
    }
  }

  private setAllowed(v: boolean): void {
    this.allowed.set(v);
    try {
      if (v) localStorage.setItem(ACCESS_KEY, '1');
      else localStorage.removeItem(ACCESS_KEY);
    } catch {
      /* storage blocked */
    }
  }

  /** One surah; network first, then the offline copy. */
  async load(surah: number): Promise<TafsirFile> {
    const hit = this.memory.get(surah);
    if (hit) return hit;
    const url = `${APP_CONFIG.apiBase}/tafsir/ik/${surah}`;
    let file: TafsirFile | null = null;
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (r.status === 401 || r.status === 403) throw new TafsirAccessError();
      if (r.ok) {
        file = (await r.clone().json()) as TafsirFile;
        void putCache(url, r);
      }
    } catch (e) {
      if (e instanceof TafsirAccessError) throw e;
    }
    file ??= await readCache(url);
    if (!file || file.format !== 'mushaf-tafsir-ik') throw new Error('unavailable');
    this.memory.set(surah, file);
    if (this.memory.size > 4) this.memory.delete(this.memory.keys().next().value!);
    return file;
  }
}

export class TafsirAccessError extends Error {
  constructor() {
    super('forbidden');
    this.name = 'TafsirAccessError';
  }
}

function readAccess(): boolean {
  try {
    return localStorage.getItem(ACCESS_KEY) === '1';
  } catch {
    return false;
  }
}

async function putCache(url: string, res: Response): Promise<void> {
  try {
    const c = await caches.open(CACHE);
    await c.put(url, res);
  } catch {
    /* no Cache Storage */
  }
}

async function readCache(url: string): Promise<TafsirFile | null> {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(url);
    return r ? ((await r.json()) as TafsirFile) : null;
  } catch {
    return null;
  }
}

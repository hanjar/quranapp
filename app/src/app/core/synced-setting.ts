import { Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { UserDataApi } from './contracts';

/**
 * A small setting that follows the account: stored in prefs.extra (merged per key across devices,
 * see sync/prefs-merge.ts) and mirrored to its old localStorage key, which code outside Angular
 * (and the first paint) still reads. A value set only on this device before syncing existed is
 * moved to the cloud once, with the oldest possible time, so a value already in the cloud wins.
 * Call in an injection context. Without UserDataApi (tests) it is a plain localStorage setting.
 */
export interface SyncedSetting<T> {
  readonly value: Signal<T>;
  set(v: T): void;
}

/**
 * `decode(raw)` turns the stored text (null = nothing stored) into a value; `encode(v)` gives the
 * text to store (null = the default, nothing stored).
 */
export function syncedSetting<T>(
  key: string,
  localKey: string,
  decode: (raw: string | null) => T,
  encode: (v: T) => string | null,
): SyncedSetting<T> {
  const data = inject(UserDataApi, { optional: true });
  const local = signal<string | null>(storageGet(localKey));
  /** Cloud text when the account has one ('' = the default), else this device's text. */
  const raw = computed<string | null>(() => {
    const c = data?.prefs().extra?.[key];
    if (c === undefined) return local();
    const s = String(c);
    return s === '' ? null : s;
  });
  const value = computed(() => decode(raw()));

  // Keep the old key in step with the cloud (read by plain functions and on the next start).
  effect(() => {
    const r = raw();
    untracked(() => storageSet(localKey, r));
  });
  if (data) {
    effect(() => {
      if (!data.ready()) return;
      const known = data.prefs().extra?.[key] !== undefined;
      untracked(() => {
        const l = storageGet(localKey);
        if (!known && l !== null) void data.setExtra(key, l, 1);
      });
    });
  }
  return {
    value,
    set(v: T) {
      const e = encode(v);
      local.set(e);
      storageSet(localKey, e);
      void data?.setExtra(key, e ?? '');
    },
  };
}

function storageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function storageSet(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}

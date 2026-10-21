/** Test-only: a minimal in-memory UserDataApi exposing just prefs()/setPrefs(). */
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { UserDataApi } from './contracts';
import { DEFAULT_PREFERENCES, Preferences } from './models';

export function fakeUserData(initial: Partial<Preferences> = {}) {
  const prefs = signal<Preferences>({ ...DEFAULT_PREFERENCES, ...initial });
  const setPrefs = vi.fn(async (patch: Partial<Preferences>) => {
    prefs.update((p) => ({ ...p, ...patch }));
  });
  return { prefs, setPrefs, provider: { provide: UserDataApi, useValue: { prefs, setPrefs } } };
}

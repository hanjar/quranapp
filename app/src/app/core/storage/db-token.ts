import { InjectionToken } from '@angular/core';
import { db, MushafDb } from './db';

/** Injectable Dexie instance so specs can supply a fresh `new MushafDb(...)`. */
export const MUSHAF_DB = new InjectionToken<MushafDb>('MUSHAF_DB', {
  providedIn: 'root',
  factory: () => db,
});

import { InjectionToken } from '@angular/core';
import { MushafDb, db } from '../storage/db';

/** DB used by the sync layer. Tests provide their own MushafDb. */
export const SYNC_DB = new InjectionToken<MushafDb>('SYNC_DB', {
  providedIn: 'root',
  factory: () => db,
});

import { isRecord } from './util';

/** Anonymous daily usage ("how many devices opened the app"), for the owner's dashboard. */

export const USAGE_RETENTION_DAYS = 400;
export const USAGE_PER_HOUR = 20;

export interface UsagePing {
  deviceId: string;
  standalone: boolean;
  appVersion: string | null;
}

export function parseUsage(raw: unknown): UsagePing | null {
  if (!isRecord(raw)) return null;
  const id = raw['deviceId'];
  const v = raw['appVersion'];
  if (typeof id !== 'string' || id.length < 8 || id.length > 64) return null;
  if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 20)) return null;
  return { deviceId: id, standalone: raw['standalone'] === true, appVersion: (v as string | null | undefined) ?? null };
}

/** Calendar day in Indonesia (UTC+7), "YYYY-MM-DD". */
export function jakartaDay(ms: number): string {
  return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Same as jakartaDay, `n` days earlier. */
export function dayMinus(ms: number, n: number): string {
  return jakartaDay(ms - n * 86_400_000);
}

/** True when `email` is in the comma-separated list (case-insensitive). */
export function inList(list: string | undefined, email: string | null | undefined): boolean {
  if (!list || !email) return false;
  const e = email.trim().toLowerCase();
  return e !== '' && list.split(',').some((x) => x.trim().toLowerCase() === e);
}

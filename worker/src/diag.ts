import { isRecord } from './util';
import type { Result } from './validate';

export const DIAG_MAX_BODY = 12 * 1024;
export const DIAG_MAX_ENTRIES = 20;
export const DIAG_PER_HOUR = 30;
export const DIAG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface DiagEntry {
  op: string;
  name: string;
  message: string;
  at: number;
}

export interface DiagInput {
  deviceId: string | null;
  appVersion: string | null;
  standalone: boolean | null;
  platform: string | null;
  entries: DiagEntry[];
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const optString = (v: unknown, max: number): string | null | undefined =>
  v === undefined || v === null ? null : typeof v === 'string' && v.length <= max ? v : undefined;

export function parseDiag(raw: unknown, now: number): Result<DiagInput> {
  if (!isRecord(raw)) return fail('Data tidak valid.');
  const deviceId = optString(raw['deviceId'], 64);
  const appVersion = optString(raw['appVersion'], 20);
  const platform = optString(raw['platform'], 120);
  if (deviceId === undefined || appVersion === undefined || platform === undefined) return fail('Info perangkat tidak valid.');
  const s = raw['standalone'];
  if (s !== undefined && s !== null && typeof s !== 'boolean') return fail('Info perangkat tidak valid.');
  const list = raw['entries'];
  if (!Array.isArray(list) || list.length === 0 || list.length > DIAG_MAX_ENTRIES) return fail('Daftar galat tidak valid.');
  const entries: DiagEntry[] = [];
  for (const e of list) {
    if (!isRecord(e)) return fail('Galat tidak valid.');
    const op = optString(e['op'], 40);
    const name = optString(e['name'], 60);
    const message = optString(e['message'], 300);
    const at = e['at'];
    if (!op || !name || message === undefined || typeof at !== 'number' || !Number.isFinite(at)) return fail('Galat tidak valid.');
    // Device clocks drift; anything far off is stored as "now".
    entries.push({ op, name, message: message ?? '', at: Math.abs(at - now) > 7 * 86_400_000 ? now : Math.round(at) });
  }
  return { ok: true, value: { deviceId, appVersion, standalone: (s as boolean | undefined) ?? null, platform, entries } };
}

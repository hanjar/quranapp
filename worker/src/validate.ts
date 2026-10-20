import { isRecord } from './util';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const MAX_OPS = 100;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const OP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EDITION_RE = /^[a-z0-9-]{1,32}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const PAPER_THEMES = ['photo', 'ivory', 'antique', 'cream'] as const;
export const UI_THEMES = ['klasik', 'segar', 'ceria', 'samudra'] as const;
export const LAYOUT_MODES = ['auto', 'single', 'spread'] as const;
export const MOTION_PREFS = ['system', 'reduce'] as const;
export const NIGHT_MODES = ['off', 'on', 'auto'] as const;
export const NIGHT_AUTOS = ['system', 'schedule'] as const;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Entity = 'bookmark' | 'position' | 'prefs' | 'folder' | 'readday' | 'khatam' | 'readmark';

export const MAX_DAILY_TARGET = 40;

export interface BookmarkData {
  kind: 'verse' | 'page';
  editionId: string;
  page: number;
  surah: number | null;
  ayah: number | null;
  key: string;
  folderId: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FolderData {
  name: string;
  nameKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface PositionData {
  editionId: string;
  page: number;
  surah: number | null;
  ayah: number | null;
  updatedAt: number;
  deviceId: string;
}

export interface PrefsData {
  paperTheme: (typeof PAPER_THEMES)[number];
  uiTheme: (typeof UI_THEMES)[number];
  layoutMode: (typeof LAYOUT_MODES)[number];
  controlsAlwaysVisible: boolean;
  motion: (typeof MOTION_PREFS)[number];
  highContrast: boolean;
  onboardingDone: boolean;
  /** Optional so older clients that never send them do not reset the stored values. */
  dailyTarget?: number;
  trackProgress?: boolean;
  nightMode?: (typeof NIGHT_MODES)[number];
  nightAuto?: (typeof NIGHT_AUTOS)[number];
  nightStart?: string;
  nightEnd?: string;
  updatedAt: number;
}

/** `[firstAt, lastAt]` epoch ms. */
export type PageSpan = [number, number];

export interface ReadDayData {
  day: string;
  pages: Record<string, PageSpan>;
  updatedAt: number;
}

export interface RoundData {
  n: number;
  startedAt: number;
  finishedAt: number | null;
  updatedAt: number;
}

export interface ParsedOp {
  opId: string;
  entity: Entity;
  entityId: string;
  action: 'upsert' | 'delete';
  baseRev: number | null;
  payload: unknown;
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function nullableInt(v: unknown, min: number, max: number): Result<number | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  const n = int(v, min, max);
  return n === null ? fail('out_of_range') : { ok: true, value: n };
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function timestamp(v: unknown): number | null {
  return int(v, 0, 8_640_000_000_000_000);
}

export function bookmarkKey(
  editionId: string,
  kind: 'verse' | 'page',
  page: number,
  surah: number | null,
  ayah: number | null,
): string {
  return kind === 'verse' ? `${editionId}|verse|${surah}:${ayah}` : `${editionId}|page|${page}`;
}

export function parseBookmark(raw: unknown): Result<BookmarkData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  const kind = oneOf(raw['kind'], ['verse', 'page'] as const);
  if (!kind) return fail('kind must be verse or page');
  const editionId = raw['editionId'];
  if (typeof editionId !== 'string' || !EDITION_RE.test(editionId)) return fail('invalid editionId');
  const page = int(raw['page'], 1, 604);
  if (page === null) return fail('page must be 1-604');
  const surah = nullableInt(raw['surah'], 1, 114);
  if (!surah.ok) return fail('surah must be 1-114');
  const ayah = nullableInt(raw['ayah'], 1, 286);
  if (!ayah.ok) return fail('ayah must be 1-286');
  if (kind === 'verse' && (surah.value === null || ayah.value === null)) {
    return fail('verse bookmark requires surah and ayah');
  }
  const createdAt = timestamp(raw['createdAt']);
  const updatedAt = timestamp(raw['updatedAt']);
  if (createdAt === null || updatedAt === null) return fail('invalid timestamps');
  const folderRaw = raw['folderId'];
  if (folderRaw !== undefined && folderRaw !== null && (typeof folderRaw !== 'string' || !ID_RE.test(folderRaw))) {
    return fail('invalid folderId');
  }
  const noteRaw = raw['note'];
  if (noteRaw !== undefined && noteRaw !== null && (typeof noteRaw !== 'string' || noteRaw.length > 500)) {
    return fail('note must be a string of at most 500 characters');
  }
  const folderId = typeof folderRaw === 'string' ? folderRaw : null;
  const note = typeof noteRaw === 'string' && noteRaw.length > 0 ? noteRaw : null;
  const s = kind === 'verse' ? surah.value : null;
  const a = kind === 'verse' ? ayah.value : null;
  // The semantic key is always derived server-side; a client-supplied key is ignored.
  return {
    ok: true,
    value: { kind, editionId, page, surah: s, ayah: a, key: bookmarkKey(editionId, kind, page, s, a), folderId, note, createdAt, updatedAt },
  };
}

export function parseFolder(raw: unknown): Result<FolderData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (name.length < 1 || [...name].length > 40) return fail('name must be 1-40 characters');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return fail('name contains control characters');
  const createdAt = timestamp(raw['createdAt']);
  const updatedAt = timestamp(raw['updatedAt']);
  if (createdAt === null || updatedAt === null) return fail('invalid timestamps');
  return { ok: true, value: { name, nameKey: name.toLowerCase(), createdAt, updatedAt } };
}

export function parsePosition(raw: unknown): Result<PositionData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  const editionId = raw['editionId'];
  if (typeof editionId !== 'string' || !EDITION_RE.test(editionId)) return fail('invalid editionId');
  const page = int(raw['page'], 1, 604);
  if (page === null) return fail('page must be 1-604');
  const surah = nullableInt(raw['surah'], 1, 114);
  if (!surah.ok) return fail('surah must be 1-114');
  const ayah = nullableInt(raw['ayah'], 1, 286);
  if (!ayah.ok) return fail('ayah must be 1-286');
  const updatedAt = timestamp(raw['updatedAt']);
  if (updatedAt === null) return fail('invalid updatedAt');
  const deviceId = raw['deviceId'];
  if (typeof deviceId !== 'string' || !DEVICE_RE.test(deviceId)) return fail('invalid deviceId');
  return { ok: true, value: { editionId, page, surah: surah.value, ayah: ayah.value, updatedAt, deviceId } };
}

export function parsePrefs(raw: unknown): Result<PrefsData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  const paperTheme = oneOf(raw['paperTheme'], PAPER_THEMES);
  const uiTheme = oneOf(raw['uiTheme'], UI_THEMES);
  const layoutMode = oneOf(raw['layoutMode'], LAYOUT_MODES);
  const motion = oneOf(raw['motion'], MOTION_PREFS);
  if (!paperTheme || !uiTheme || !layoutMode || !motion) return fail('invalid theme/layout/motion value');
  const cav = raw['controlsAlwaysVisible'];
  const hc = raw['highContrast'];
  const ob = raw['onboardingDone'] ?? false;
  if (typeof cav !== 'boolean' || typeof hc !== 'boolean' || typeof ob !== 'boolean') {
    return fail('flags must be booleans');
  }
  const updatedAt = timestamp(raw['updatedAt']);
  if (updatedAt === null) return fail('invalid updatedAt');
  const value: PrefsData = {
    paperTheme,
    uiTheme,
    layoutMode,
    controlsAlwaysVisible: cav,
    motion,
    highContrast: hc,
    onboardingDone: ob,
    updatedAt,
  };
  if (raw['dailyTarget'] !== undefined) {
    const dt = int(raw['dailyTarget'], 1, MAX_DAILY_TARGET);
    if (dt === null) return fail('dailyTarget must be 1-40');
    value.dailyTarget = dt;
  }
  if (raw['trackProgress'] !== undefined) {
    if (typeof raw['trackProgress'] !== 'boolean') return fail('trackProgress must be a boolean');
    value.trackProgress = raw['trackProgress'];
  }
  if (raw['nightMode'] !== undefined) {
    const nm = oneOf(raw['nightMode'], NIGHT_MODES);
    if (!nm) return fail('nightMode must be off, on or auto');
    value.nightMode = nm;
  }
  if (raw['nightAuto'] !== undefined) {
    const na = oneOf(raw['nightAuto'], NIGHT_AUTOS);
    if (!na) return fail('nightAuto must be system or schedule');
    value.nightAuto = na;
  }
  for (const k of ['nightStart', 'nightEnd'] as const) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !HHMM_RE.test(v)) return fail(`${k} must be HH:MM`);
    value[k] = v;
  }
  return { ok: true, value };
}

const DAY_RE = /^(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True for a real calendar day 'YYYY-MM-DD' in 2000-2099. */
export function validDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseReadDay(raw: unknown): Result<ReadDayData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  if (!validDay(raw['day'])) return fail('invalid day');
  const pagesRaw = raw['pages'];
  if (!isRecord(pagesRaw)) return fail('pages must be an object');
  const keys = Object.keys(pagesRaw);
  if (keys.length === 0 || keys.length > 604) return fail('pages must hold 1-604 entries');
  const pages: Record<string, PageSpan> = {};
  for (const k of keys) {
    const page = Number(k);
    if (!Number.isInteger(page) || page < 1 || page > 604 || String(page) !== k) return fail('page must be 1-604');
    const span = pagesRaw[k];
    if (!Array.isArray(span) || span.length !== 2) return fail('page span must be [firstAt, lastAt]');
    const a = timestamp(span[0]);
    const b = timestamp(span[1]);
    if (a === null || b === null || a > b) return fail('invalid page span');
    pages[k] = [a, b];
  }
  const updatedAt = timestamp(raw['updatedAt']);
  if (updatedAt === null) return fail('invalid updatedAt');
  return { ok: true, value: { day: raw['day'], pages, updatedAt } };
}

export interface MarksData {
  marks: Record<string, PageSpan>;
  updatedAt: number;
}

/** `{marks: {"<page>": [markedAt, unmarkedAt]}, updatedAt}`; unmarkedAt 0 = never unmarked. */
export function parseReadMarks(raw: unknown): Result<MarksData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  const m = raw['marks'];
  if (!isRecord(m)) return fail('marks must be an object');
  const keys = Object.keys(m);
  if (keys.length === 0 || keys.length > 604) return fail('marks must hold 1-604 entries');
  const marks: Record<string, PageSpan> = {};
  for (const k of keys) {
    const page = Number(k);
    if (!Number.isInteger(page) || page < 1 || page > 604 || String(page) !== k) return fail('page must be 1-604');
    const v = m[k];
    if (!Array.isArray(v) || v.length !== 2) return fail('mark must be [markedAt, unmarkedAt]');
    const a = timestamp(v[0]);
    const b = timestamp(v[1]);
    if (a === null || b === null) return fail('invalid mark timestamps');
    marks[k] = [a, b];
  }
  const updatedAt = timestamp(raw['updatedAt']);
  if (updatedAt === null) return fail('invalid updatedAt');
  return { ok: true, value: { marks, updatedAt } };
}

export function parseRound(raw: unknown): Result<RoundData> {
  if (!isRecord(raw)) return fail('payload must be an object');
  const n = int(raw['n'], 1, 1000);
  if (n === null) return fail('n must be 1-1000');
  const startedAt = timestamp(raw['startedAt']);
  const updatedAt = timestamp(raw['updatedAt']);
  if (startedAt === null || updatedAt === null) return fail('invalid timestamps');
  let finishedAt: number | null = null;
  if (raw['finishedAt'] !== undefined && raw['finishedAt'] !== null) {
    finishedAt = timestamp(raw['finishedAt']);
    if (finishedAt === null || finishedAt < startedAt) return fail('invalid finishedAt');
  }
  return { ok: true, value: { n, startedAt, finishedAt, updatedAt } };
}

export function validEntityId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

/** Shape check of one operation. Returns the opId (when salvageable) so callers can reject per-op. */
export function parseOp(raw: unknown): { opId: string | null; op: Result<ParsedOp> } {
  if (!isRecord(raw)) return { opId: null, op: fail('operation must be an object') };
  const opId = typeof raw['opId'] === 'string' && OP_ID_RE.test(raw['opId']) ? raw['opId'] : null;
  if (!opId) return { opId: null, op: fail('invalid opId') };
  const entity = oneOf(raw['entity'], ['bookmark', 'folder', 'position', 'prefs', 'readday', 'khatam', 'readmark'] as const);
  if (!entity) return { opId, op: fail('invalid entity') };
  const entityId = raw['entityId'];
  if (!validEntityId(entityId)) return { opId, op: fail('invalid entityId') };
  const action = oneOf(raw['action'], ['upsert', 'delete'] as const);
  if (!action) return { opId, op: fail('invalid action') };
  const br = raw['baseRev'];
  let baseRev: number | null = null;
  if (br !== null && br !== undefined) {
    baseRev = int(br, 0, Number.MAX_SAFE_INTEGER);
    if (baseRev === null) return { opId, op: fail('invalid baseRev') };
  }
  if (action === 'upsert' && !isRecord(raw['payload'])) return { opId, op: fail('payload must be an object') };
  return { opId, op: { ok: true, value: { opId, entity, entityId, action, baseRev, payload: raw['payload'] } } };
}

export function parseEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

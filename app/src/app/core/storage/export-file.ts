import {
  AUDIO_MODE_IDS,
  AudioMode,
  PAGE_RENDERER_IDS,
  PageRendererId,
  snapScale,
  BOOKMARK_NOTE_MAX,
  Bookmark,
  clampDailyTarget,
  FOLDER_NAME_MAX,
  bookmarkKey,
  DEFAULT_EDITION,
  DEFAULT_PREFERENCES,
  isHHMM,
  isValidPage,
  Preferences,
  ReadingPosition,
} from '../models';
import { isPaperThemeId, parseCustomThemes } from '../custom-theme';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_BOOKMARKS = 20000;

const fail = (msg: string): never => {
  throw new Error(msg);
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const isSurah = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 114;
const isAyah = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 286;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], label: string): T =>
  allowed.includes(v as T)
    ? (v as T)
    : fail(`Berkas tidak valid: pengaturan "${label}" tidak dikenal.`);

const paperThemeOf = (v: unknown): Preferences['paperTheme'] =>
  isPaperThemeId(v) ? v : fail('Berkas tidak valid: pengaturan "paperTheme" tidak dikenal.');

export function validateBookmark(raw: unknown, i: number, version: 1 | 2 = 2): Bookmark {
  const n = `penanda #${i + 1}`;
  if (!isObj(raw)) return fail(`Berkas tidak valid: ${n} rusak.`);
  const kind = raw['kind'];
  if (kind !== 'verse' && kind !== 'page') return fail(`Berkas tidak valid: jenis ${n} salah.`);
  if (!isValidPage(raw['page'])) return fail(`Berkas tidak valid: halaman ${n} di luar 1–604.`);
  const page = raw['page'];
  let surah: number | null = null;
  let ayah: number | null = null;
  if (kind === 'verse') {
    if (!isSurah(raw['surah'])) return fail(`Berkas tidak valid: surah ${n} di luar 1–114.`);
    if (!isAyah(raw['ayah'])) return fail(`Berkas tidak valid: ayat ${n} tidak sah.`);
    surah = raw['surah'];
    ayah = raw['ayah'];
  }
  const createdAt = isTime(raw['createdAt'])
    ? raw['createdAt']
    : fail(`Berkas tidak valid: waktu ${n} salah.`);
  const updatedAt = isTime(raw['updatedAt']) ? raw['updatedAt'] : createdAt;
  return {
    id: '', // assigned on import
    kind,
    editionId: DEFAULT_EDITION,
    page,
    surah,
    ayah,
    key: bookmarkKey(DEFAULT_EDITION, kind, { page, surah, ayah }),
    createdAt,
    updatedAt,
    deletedAt: null,
    rev: null,
    // File folder id (remapped on import); only meaningful for v2 files.
    folderId: version === 2 ? validateFolderRef(raw['folderId'], n) : null,
    note: version === 2 ? validateNote(raw['note'], n) : null,
  };
}

function validateFolderRef(v: unknown, n: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.length >= 1 && v.length <= 64) return v;
  return fail(`Berkas tidak valid: folder ${n} salah.`);
}

function validateNote(v: unknown, n: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return fail(`Berkas tidak valid: catatan ${n} salah.`);
  const t = v.trim();
  if (t.length > BOOKMARK_NOTE_MAX) return fail(`Berkas tidak valid: catatan ${n} terlalu panjang.`);
  return t || null;
}

export interface ImportedFolder {
  id: string;
  name: string;
  createdAt: number;
}

export function validateFolder(raw: unknown, i: number): ImportedFolder {
  const n = `folder #${i + 1}`;
  if (!isObj(raw)) return fail(`Berkas tidak valid: ${n} rusak.`);
  const id = raw['id'];
  if (typeof id !== 'string' || id.length < 1 || id.length > 64) return fail(`Berkas tidak valid: id ${n} salah.`);
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (!name || name.length > FOLDER_NAME_MAX) return fail(`Berkas tidak valid: nama ${n} harus 1–${FOLDER_NAME_MAX} karakter.`);
  return { id, name, createdAt: isTime(raw['createdAt']) ? raw['createdAt'] : 0 };
}

export function validatePosition(raw: unknown): ReadingPosition | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) return fail('Berkas tidak valid: posisi baca rusak.');
  if (!isValidPage(raw['page']))
    return fail('Berkas tidak valid: halaman posisi baca di luar 1–604.');
  const surah = raw['surah'] ?? null;
  const ayah = raw['ayah'] ?? null;
  if (surah !== null && !isSurah(surah))
    return fail('Berkas tidak valid: surah posisi baca salah.');
  if (ayah !== null && !isAyah(ayah)) return fail('Berkas tidak valid: ayat posisi baca salah.');
  if (!isTime(raw['updatedAt'])) return fail('Berkas tidak valid: waktu posisi baca salah.');
  return {
    editionId: DEFAULT_EDITION,
    page: raw['page'],
    surah,
    ayah,
    updatedAt: raw['updatedAt'],
    deviceId: '',
    rev: null,
  };
}

export function validatePreferences(raw: unknown): Preferences {
  if (!isObj(raw)) return fail('Berkas tidak valid: pengaturan rusak.');
  const bool = (k: string): boolean =>
    typeof raw[k] === 'boolean'
      ? (raw[k] as boolean)
      : fail(`Berkas tidak valid: pengaturan "${k}" salah.`);
  return {
    paperTheme: paperThemeOf(raw['paperTheme']),
    customThemes: parseCustomThemes(raw['customThemes']),
    uiTheme: oneOf(raw['uiTheme'], ['klasik', 'segar', 'ceria', 'samudra'], 'uiTheme'),
    layoutMode: oneOf(raw['layoutMode'], ['auto', 'single', 'spread'], 'layoutMode'),
    controlsAlwaysVisible: bool('controlsAlwaysVisible'),
    motion: oneOf(raw['motion'], ['system', 'reduce'], 'motion'),
    highContrast: bool('highContrast'),
    onboardingDone:
      typeof raw['onboardingDone'] === 'boolean'
        ? raw['onboardingDone']
        : DEFAULT_PREFERENCES.onboardingDone,
    dailyTarget:
      typeof raw['dailyTarget'] === 'number'
        ? clampDailyTarget(raw['dailyTarget'])
        : DEFAULT_PREFERENCES.dailyTarget,
    trackProgress:
      typeof raw['trackProgress'] === 'boolean'
        ? raw['trackProgress']
        : DEFAULT_PREFERENCES.trackProgress,
    nightMode:
      raw['nightMode'] === 'on' || raw['nightMode'] === 'auto' || raw['nightMode'] === 'off'
        ? raw['nightMode']
        : DEFAULT_PREFERENCES.nightMode,
    nightAuto:
      raw['nightAuto'] === 'system' || raw['nightAuto'] === 'schedule'
        ? raw['nightAuto']
        : DEFAULT_PREFERENCES.nightAuto,
    nightStart: isHHMM(raw['nightStart']) ? raw['nightStart'] : DEFAULT_PREFERENCES.nightStart,
    nightEnd: isHHMM(raw['nightEnd']) ? raw['nightEnd'] : DEFAULT_PREFERENCES.nightEnd,
    lineRules:
      typeof raw['lineRules'] === 'boolean' ? raw['lineRules'] : DEFAULT_PREFERENCES.lineRules,
    showLatin:
      typeof raw['showLatin'] === 'boolean' ? raw['showLatin'] : DEFAULT_PREFERENCES.showLatin,
    translationScale:
      typeof raw['translationScale'] === 'number'
        ? snapScale(raw['translationScale'])
        : DEFAULT_PREFERENCES.translationScale,
    audioMode: AUDIO_MODE_IDS.includes(raw['audioMode'] as AudioMode)
      ? (raw['audioMode'] as AudioMode)
      : DEFAULT_PREFERENCES.audioMode,
    audioFollow:
      typeof raw['audioFollow'] === 'boolean' ? raw['audioFollow'] : DEFAULT_PREFERENCES.audioFollow,
    pageRenderer: PAGE_RENDERER_IDS.includes(raw['pageRenderer'] as PageRendererId)
      ? (raw['pageRenderer'] as PageRendererId)
      : DEFAULT_PREFERENCES.pageRenderer,
    updatedAt: isTime(raw['updatedAt']) ? raw['updatedAt'] : 0,
    rev: null,
  };
}

export interface ParsedExport {
  bookmarks: Bookmark[];
  folders: ImportedFolder[];
  position: ReadingPosition | null;
  preferences: Preferences;
}

/** Parses + validates an export file's text. Throws Indonesian Error messages. */
export function parseExportText(text: string, size = text.length): ParsedExport {
  if (size > MAX_IMPORT_BYTES) fail('Berkas terlalu besar (maksimal 2 MB).');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('Berkas bukan JSON yang valid.');
  }
  if (!isObj(data) || data['format'] !== 'mushaf-digital-export') {
    return fail('Berkas ini bukan ekspor Mushaf Digital.');
  }
  const version = data['version'];
  if (version !== 1 && version !== 2) fail('Versi berkas ekspor tidak didukung.');
  if (data['editionId'] !== DEFAULT_EDITION) fail('Edisi mushaf pada berkas tidak didukung.');
  const list = data['bookmarks'];
  if (!Array.isArray(list)) return fail('Berkas tidak valid: daftar penanda tidak ada.');
  if (list.length > MAX_BOOKMARKS) fail('Berkas tidak valid: terlalu banyak penanda.');
  const v = version as 1 | 2;
  const rawFolders = v === 2 ? (data['folders'] ?? []) : [];
  if (!Array.isArray(rawFolders)) return fail('Berkas tidak valid: daftar folder rusak.');
  if (rawFolders.length > 1000) fail('Berkas tidak valid: terlalu banyak folder.');
  return {
    bookmarks: list.map((b, i) => validateBookmark(b, i, v)),
    folders: rawFolders.map(validateFolder),
    position: validatePosition(data['position']),
    preferences: validatePreferences(data['preferences']),
  };
}

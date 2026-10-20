import {
  Bookmark,
  bookmarkKey,
  DEFAULT_EDITION,
  DEFAULT_PREFERENCES,
  ExportFile,
  isValidPage,
  Preferences,
  ReadingPosition,
} from '../models';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_BOOKMARKS = 20000;

const fail = (msg: string): never => {
  throw new Error(msg);
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const isSurah = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 114;
const isAyah = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 286;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], label: string): T =>
  allowed.includes(v as T) ? (v as T) : fail(`Berkas tidak valid: pengaturan "${label}" tidak dikenal.`);

export function validateBookmark(raw: unknown, i: number): Bookmark {
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
  const createdAt = isTime(raw['createdAt']) ? raw['createdAt'] : fail(`Berkas tidak valid: waktu ${n} salah.`);
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
  };
}

export function validatePosition(raw: unknown): ReadingPosition | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) return fail('Berkas tidak valid: posisi baca rusak.');
  if (!isValidPage(raw['page'])) return fail('Berkas tidak valid: halaman posisi baca di luar 1–604.');
  const surah = raw['surah'] ?? null;
  const ayah = raw['ayah'] ?? null;
  if (surah !== null && !isSurah(surah)) return fail('Berkas tidak valid: surah posisi baca salah.');
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
    typeof raw[k] === 'boolean' ? (raw[k] as boolean) : fail(`Berkas tidak valid: pengaturan "${k}" salah.`);
  return {
    paperTheme: oneOf(raw['paperTheme'], ['photo', 'ivory', 'antique'], 'paperTheme'),
    uiTheme: oneOf(raw['uiTheme'], ['klasik', 'segar', 'ceria', 'samudra'], 'uiTheme'),
    layoutMode: oneOf(raw['layoutMode'], ['auto', 'single', 'spread'], 'layoutMode'),
    controlsAlwaysVisible: bool('controlsAlwaysVisible'),
    motion: oneOf(raw['motion'], ['system', 'reduce'], 'motion'),
    highContrast: bool('highContrast'),
    onboardingDone: typeof raw['onboardingDone'] === 'boolean' ? raw['onboardingDone'] : DEFAULT_PREFERENCES.onboardingDone,
    updatedAt: isTime(raw['updatedAt']) ? raw['updatedAt'] : 0,
    rev: null,
  };
}

export interface ParsedExport {
  bookmarks: Bookmark[];
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
  if (!isObj(data) || data['format'] !== ('mushaf-digital-export' satisfies ExportFile['format'])) {
    return fail('Berkas ini bukan ekspor Mushaf Digital.');
  }
  if (data['version'] !== 1) fail('Versi berkas ekspor tidak didukung.');
  if (data['editionId'] !== DEFAULT_EDITION) fail('Edisi mushaf pada berkas tidak didukung.');
  const list = data['bookmarks'];
  if (!Array.isArray(list)) return fail('Berkas tidak valid: daftar penanda tidak ada.');
  if (list.length > MAX_BOOKMARKS) fail('Berkas tidak valid: terlalu banyak penanda.');
  return {
    bookmarks: list.map(validateBookmark),
    position: validatePosition(data['position']),
    preferences: validatePreferences(data['preferences']),
  };
}

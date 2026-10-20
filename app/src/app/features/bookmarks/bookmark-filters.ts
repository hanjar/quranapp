import { Bookmark, BookmarkFolder, SurahMeta } from '../../core/models';
import { normalizeName } from '../sheets/search-parser';

export type SortMode = 'mushaf' | 'recent';
export type KindFilter = 'all' | 'verse' | 'page';
/** 'all' = every folder, 'none' = Tanpa folder, otherwise a folder id. */
export type FolderFilter = 'all' | 'none' | (string & {});

export interface FilterContext {
  surahs: readonly SurahMeta[];
  /** Primary surah of a page (for page bookmarks). */
  surahOfPage(page: number): SurahMeta | undefined;
}

export interface FilterOptions {
  query: string;
  kind: KindFilter;
  folder: FolderFilter;
  sort: SortMode;
}

/** Folder id that really exists, else null (dangling ids count as "Tanpa folder"). */
export function effectiveFolderId(
  b: Pick<Bookmark, 'folderId'>,
  folders: readonly Pick<BookmarkFolder, 'id'>[],
): string | null {
  if (!b.folderId) return null;
  return folders.some((f) => f.id === b.folderId) ? b.folderId : null;
}

export function matchesFolder(
  b: Bookmark,
  folder: FolderFilter,
  folders: readonly BookmarkFolder[],
): boolean {
  if (folder === 'all') return true;
  const eff = effectiveFolderId(b, folders);
  return folder === 'none' ? eff === null : eff === folder;
}

export function matchesQuery(b: Bookmark, query: string, ctx: FilterContext): boolean {
  const q = query.trim();
  if (!q) return true;

  // "2:255" / "2.255"
  let m = q.match(/^(\d{1,3})\s*[:.]\s*(\d{1,3})$/);
  if (m) return b.kind === 'verse' && b.surah === +m[1] && b.ayah === +m[2];

  // bare number: surah number, ayah's page, or the page itself
  if (/^\d{1,4}$/.test(q)) {
    const n = +q;
    return b.surah === n || b.page === n;
  }

  // "hal 50"
  m = q.match(/^(?:halaman|hal|h)\.?\s*(\d{1,4})$/i);
  if (m) return b.page === +m[1];

  const note = (b.note ?? '').toLowerCase();
  const lower = q.toLowerCase();
  if (note.includes(lower)) return true;

  const nq = normalizeName(q);
  if (!nq) return false;
  const surah = b.surah ? ctx.surahs[b.surah - 1] : ctx.surahOfPage(b.page);
  if (!surah) return false;
  const arabic = /\p{Script=Arabic}/u.test(q);
  const names = arabic ? [surah.nameArabic] : [surah.nameLatin, surah.nameEnglish];
  return names.some((n) => normalizeName(n).includes(nq));
}

/** Mushaf order: page, then surah, then ayah; ties by creation. */
export function compareMushaf(a: Bookmark, b: Bookmark): number {
  return (
    a.page - b.page ||
    (a.surah ?? 0) - (b.surah ?? 0) ||
    (a.ayah ?? 0) - (b.ayah ?? 0) ||
    a.createdAt - b.createdAt
  );
}

export function compareRecent(a: Bookmark, b: Bookmark): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;
}

export function sortBookmarks(list: readonly Bookmark[], sort: SortMode): Bookmark[] {
  return [...list].sort(sort === 'mushaf' ? compareMushaf : compareRecent);
}

export function filterBookmarks(
  list: readonly Bookmark[],
  folders: readonly BookmarkFolder[],
  opts: FilterOptions,
  ctx: FilterContext,
): Bookmark[] {
  const out = list.filter(
    (b) =>
      (opts.kind === 'all' || b.kind === opts.kind) &&
      matchesFolder(b, opts.folder, folders) &&
      matchesQuery(b, opts.query, ctx),
  );
  return sortBookmarks(out, opts.sort);
}

export interface FolderCounts {
  all: number;
  none: number;
  byFolder: Record<string, number>;
}

export function folderCounts(
  list: readonly Bookmark[],
  folders: readonly BookmarkFolder[],
): FolderCounts {
  const byFolder: Record<string, number> = {};
  for (const f of folders) byFolder[f.id] = 0;
  let none = 0;
  for (const b of list) {
    const id = effectiveFolderId(b, folders);
    if (id === null) none++;
    else byFolder[id]++;
  }
  return { all: list.length, none, byFolder };
}

/** Next "Khatam ke-N" where N = 1 + highest existing number (case-insensitive). */
export function suggestKhatamName(folderNames: readonly string[]): string {
  let max = 0;
  for (const name of folderNames) {
    const m = name.trim().match(/^khatam\s+ke-?\s*(\d+)$/i);
    if (m) max = Math.max(max, +m[1]);
  }
  return `Khatam ke-${max + 1}`;
}

/** Current Hijri year (Umm al-Qura-ish via Intl), or null when unsupported. */
export function hijriYear(date: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('id-u-ca-islamic', { year: 'numeric' }).formatToParts(
      date,
    );
    const y = parts.find((p) => p.type === 'year')?.value;
    const n = y ? parseInt(y.replace(/\D/g, ''), 10) : NaN;
    return Number.isFinite(n) && n > 1000 ? n : null;
  } catch {
    return null;
  }
}

export function suggestRamadhanName(date: Date = new Date()): string | null {
  const y = hijriYear(date);
  return y ? `Ramadhan ${y} · Khatam 1` : null;
}

/** Name suggestions for the "Folder baru" form, skipping names already taken. */
export function folderNameSuggestions(
  folderNames: readonly string[],
  date: Date = new Date(),
): string[] {
  const taken = new Set(folderNames.map((n) => n.trim().toLowerCase()));
  return [suggestKhatamName(folderNames), suggestRamadhanName(date)].filter(
    (n): n is string => !!n && !taken.has(n.toLowerCase()),
  );
}

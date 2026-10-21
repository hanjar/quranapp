import { Bookmark, BookmarkFolder } from '../../core/models';

/**
 * Pure matching helpers for the universal search (features, bookmarks, translation).
 * Quran references/surah names stay in search-parser.ts.
 */

const IGNORED_CHARS = /['’‘`ʼʻ-]/g;

/** lowercase, no diacritics, no apostrophes/hyphens; other punctuation kept (1 char in, 1 char out or 0). */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(IGNORED_CHARS, '');
}

/** Words of a string after normalisation (letters and digits only). */
export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const STOP_WORDS = new Set([
  'cara',
  'untuk',
  'di',
  'ke',
  'yang',
  'dan',
  'atau',
  'the',
  'how',
  'to',
  'a',
  'ini',
  'dong',
  'mau',
  'ingin',
  'saya',
  'bisa',
  'gimana',
  'bagaimana',
  'menu',
  'fitur',
]);

/** Query words with filler removed (kept as-is when nothing else is left). */
export function queryTokens(raw: string): string[] {
  const all = tokenize(raw);
  const kept = all.filter((t) => !STOP_WORDS.has(t));
  return kept.length > 0 ? kept : all;
}

/** True when a and b differ by at most one insertion, deletion, substitution or adjacent swap. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la || i === lb) return true; // one is a prefix of the other (length differs by 1)
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** How well a query word matches one indexed word: 0 = no match. */
export function wordScore(q: string, word: string): number {
  if (q === word) return 1;
  if (q.length >= 2 && word.startsWith(q)) return 0.8;
  if (q.length >= 5 && word.length >= 4) {
    if (withinOneEdit(q, word)) return 0.55;
    if (word.length > q.length && withinOneEdit(q, word.slice(0, q.length))) return 0.45;
  }
  return 0;
}

/** Weighted word list searched by `scoreFields`. */
export interface SearchField {
  words: string[];
  weight: number;
}

/**
 * Every query word must match at least one field word. Score = sum of the best
 * weighted word scores; null when any query word is unmatched.
 */
export function scoreFields(q: readonly string[], fields: readonly SearchField[]): number | null {
  if (q.length === 0) return null;
  let total = 0;
  for (const qt of q) {
    let best = 0;
    for (const f of fields) {
      for (const w of f.words) {
        const s = wordScore(qt, w) * f.weight;
        if (s > best) best = s;
      }
    }
    if (best === 0) return null;
    total += best;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export interface Searchable {
  id: string;
  title: string;
  description: string;
  keywords: readonly string[];
}

/** Pre-tokenised entry so typing does not re-normalise the registry on every key. */
export interface IndexedEntry<T extends Searchable> {
  entry: T;
  fields: SearchField[];
  phrases: string[];
}

export function indexEntries<T extends Searchable>(entries: readonly T[]): IndexedEntry<T>[] {
  return entries.map((entry) => ({
    entry,
    fields: [
      { words: tokenize(entry.title), weight: 5 },
      { words: entry.keywords.flatMap(tokenize), weight: 4 },
      { words: tokenize(entry.description), weight: 1.5 },
    ],
    phrases: [entry.title, ...entry.keywords].map((p) => tokenize(p).join(' ')),
  }));
}

export function searchEntries<T extends Searchable>(
  raw: string,
  index: readonly IndexedEntry<T>[],
  max = 8,
): T[] {
  const q = queryTokens(raw);
  if (q.length === 0) return [];
  const phrase = q.join(' ');
  const scored: { entry: T; score: number; order: number }[] = [];
  index.forEach((it, order) => {
    const base = scoreFields(q, it.fields);
    if (base === null) return;
    const bonus = it.phrases.some((p) => p === phrase)
      ? 4
      : it.phrases.some((p) => p.startsWith(phrase))
        ? 2
        : 0;
    scored.push({ entry: it.entry, score: base + bonus, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export interface BookmarkRow {
  bookmark: Bookmark;
  title: string;
  sub: string;
  fields: SearchField[];
}

export interface BookmarkNames {
  surahName(n: number): string;
  surahOfPage(page: number): string;
}

export function toBookmarkRows(
  bookmarks: readonly Bookmark[],
  folders: readonly BookmarkFolder[],
  names: BookmarkNames,
): BookmarkRow[] {
  return bookmarks.map((b) => {
    const folder = folders.find((f) => f.id === b.folderId)?.name ?? null;
    const isVerse = b.kind === 'verse' && b.surah !== null && b.ayah !== null;
    const surah = isVerse ? names.surahName(b.surah!) : names.surahOfPage(b.page);
    const title = isVerse ? `${surah} · Ayat ${b.ayah}` : `Halaman ${b.page} · ${surah}`;
    const sub = [folder, b.note, isVerse ? `Hal. ${b.page}` : null].filter(Boolean).join(' · ');
    return {
      bookmark: b,
      title,
      sub: sub || `Hal. ${b.page}`,
      fields: [
        { words: tokenize(surah), weight: 3 },
        { words: tokenize(folder ?? ''), weight: 3 },
        { words: tokenize(b.note ?? ''), weight: 2 },
        { words: tokenize(isVerse ? `ayat ${b.ayah} ${b.surah}` : `halaman ${b.page}`), weight: 1 },
      ],
    };
  });
}

export function searchBookmarks(raw: string, rows: readonly BookmarkRow[], max = 5): BookmarkRow[] {
  const q = tokenize(raw);
  if (q.length === 0) return [];
  const scored: { row: BookmarkRow; score: number }[] = [];
  for (const row of rows) {
    const score = scoreFields(q, row.fields);
    if (score !== null) scored.push({ row, score });
  }
  // Array.sort is stable: equal scores keep the newest-first order of the source list.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.row);
}

// ---------------------------------------------------------------------------
// Translation text
// ---------------------------------------------------------------------------

export interface TranslationIndex {
  keys: string[];
  /** normalizeText() of each ayah text, same order as keys. */
  norm: string[];
  texts: string[];
}

export function indexTranslation(ayahs: Record<string, string>): TranslationIndex {
  const keys = Object.keys(ayahs);
  const texts = keys.map((k) => ayahs[k]);
  return { keys, texts, norm: texts.map(normalizeText) };
}

export interface Segment {
  text: string;
  hit: boolean;
}

export interface TranslationHit {
  surah: number;
  ayah: number;
  segments: Segment[];
}

/** At least 3 letters, not a number/reference and not Arabic script. */
export function canSearchTranslation(raw: string): boolean {
  const q = raw.trim();
  if (isReferenceQuery(q) || /\p{Script=Arabic}/u.test(q)) return false;
  return (q.match(/\p{L}/gu) ?? []).length >= 3;
}

export function isReferenceQuery(raw: string): boolean {
  const q = raw.trim();
  return (
    /^\d{1,4}$/.test(q) ||
    /^\d{1,3}\s*[:.]\s*\d{1,3}$/.test(q) ||
    /^(?:halaman|hal|h)\.?\s*\d{1,4}$/i.test(q) ||
    /^juz\s*\d{1,3}$/i.test(q)
  );
}

/** normalised string plus, for each normalised char, the index of its source char. */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const n = normalizeText(ch);
    for (let k = 0; k < n.length; k++) map.push(i);
    norm += n;
    i += ch.length;
  }
  return { norm, map };
}

const SNIPPET_BEFORE = 45;
const SNIPPET_LEN = 150;

/** Snippet of `text` around the first hit with every token occurrence marked. */
export function makeSnippet(text: string, tokens: readonly string[]): Segment[] {
  const { norm, map } = normalizeWithMap(text);
  const ranges: [number, number][] = [];
  for (const t of tokens) {
    if (!t) continue;
    let from = 0;
    for (;;) {
      const at = norm.indexOf(t, from);
      if (at < 0) break;
      ranges.push([map[at], map[at + t.length - 1] + 1]);
      from = at + t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let start = Math.max(0, (merged[0]?.[0] ?? 0) - SNIPPET_BEFORE);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp >= 0 && sp < (merged[0]?.[0] ?? 0)) start = sp + 1;
  }
  const end = Math.min(text.length, start + SNIPPET_LEN);
  const segs: Segment[] = [];
  if (start > 0) segs.push({ text: '…', hit: false });
  let cur = start;
  for (const [a, b] of merged) {
    if (b <= start || a >= end) continue;
    const from = Math.max(a, start);
    const to = Math.min(b, end);
    if (from > cur) segs.push({ text: text.slice(cur, from), hit: false });
    segs.push({ text: text.slice(from, to), hit: true });
    cur = to;
  }
  if (cur < end) segs.push({ text: text.slice(cur, end), hit: false });
  if (end < text.length) segs.push({ text: '…', hit: false });
  return segs;
}

export function searchTranslation(
  raw: string,
  index: TranslationIndex,
  max = 20,
): TranslationHit[] {
  if (!canSearchTranslation(raw)) return [];
  const phrase = normalizeText(raw).replace(/\s+/g, ' ').trim();
  const words = tokenize(raw);
  if (!phrase || words.length === 0) return [];
  const picked: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < index.norm.length && picked.length < max; i++) {
    if (index.norm[i].includes(phrase)) {
      picked.push(i);
      seen.add(i);
    }
  }
  if (picked.length < max && words.length > 1) {
    for (let i = 0; i < index.norm.length && picked.length < max; i++) {
      if (!seen.has(i) && words.every((w) => index.norm[i].includes(w))) picked.push(i);
    }
  }
  const marks = words.length > 1 ? [phrase, ...words] : [phrase];
  return picked.map((i) => {
    const [surah, ayah] = index.keys[i].split(':').map(Number);
    return { surah, ayah, segments: makeSnippet(index.texts[i], marks) };
  });
}

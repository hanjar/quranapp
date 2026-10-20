import { describe, expect, it } from 'vitest';
import { Bookmark, BookmarkFolder, SurahMeta } from '../../core/models';
import {
  FilterContext,
  effectiveFolderId,
  filterBookmarks,
  folderCounts,
  folderNameSuggestions,
  hijriYear,
  isPageEndVerse,
  matchesFolder,
  matchesQuery,
  sortBookmarks,
  suggestKhatamName,
  suggestRamadhanName,
} from './bookmark-filters';

const surah = (
  number: number,
  nameLatin: string,
  nameEnglish: string,
  nameArabic: string,
): SurahMeta => ({
  number,
  nameLatin,
  nameEnglish,
  nameArabic,
  ayahCount: 300,
  startPage: 1,
  endPage: 1,
  juz: 1,
});
const SURAHS = Array.from({ length: 114 }, (_, i) =>
  surah(i + 1, `Surah ${i + 1}`, `Surah ${i + 1}`, 'س'),
);
SURAHS[1] = surah(2, 'Al-Baqarah', 'Al-Baqara', 'البقرة');
SURAHS[35] = surah(36, 'Yasin', 'Ya-Sin', 'يس');
const ctx: FilterContext = {
  surahs: SURAHS,
  surahOfPage: (p) => (p === 440 ? SURAHS[35] : SURAHS[1]),
};

let n = 0;
function bm(p: Partial<Bookmark>): Bookmark {
  n++;
  return {
    id: `b${n}`,
    kind: 'verse',
    editionId: 'hafs-kfqc',
    page: 1,
    surah: 2,
    ayah: 1,
    key: `k${n}`,
    createdAt: n,
    updatedAt: n,
    deletedAt: null,
    rev: null,
    folderId: null,
    note: null,
    ...p,
  };
}
const folder = (id: string, name: string): BookmarkFolder => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  rev: null,
});
const F1 = folder('f1', 'Khatam ke-1');
const F2 = folder('f2', 'Khatam ke-2');

describe('effectiveFolderId / matchesFolder', () => {
  it('treats dangling ids as Tanpa folder', () => {
    expect(effectiveFolderId({ folderId: 'gone' }, [F1])).toBeNull();
    expect(effectiveFolderId({ folderId: 'f1' }, [F1])).toBe('f1');
    expect(effectiveFolderId({ folderId: null }, [F1])).toBeNull();
  });
  it('filters all / none / specific', () => {
    const dangling = bm({ folderId: 'gone' });
    const inF1 = bm({ folderId: 'f1' });
    const free = bm({});
    const folders = [F1, F2];
    expect(matchesFolder(dangling, 'all', folders)).toBe(true);
    expect(matchesFolder(dangling, 'none', folders)).toBe(true);
    expect(matchesFolder(free, 'none', folders)).toBe(true);
    expect(matchesFolder(inF1, 'none', folders)).toBe(false);
    expect(matchesFolder(inF1, 'f1', folders)).toBe(true);
    expect(matchesFolder(inF1, 'f2', folders)).toBe(false);
    expect(matchesFolder(dangling, 'gone', folders)).toBe(false);
  });
});

describe('matchesQuery', () => {
  const verse = bm({ surah: 2, ayah: 255, page: 42, note: 'Ayat Kursi, hafalan' });
  const page = bm({ kind: 'page', surah: null, ayah: null, page: 440 });
  it('blank matches everything', () => {
    expect(matchesQuery(verse, '  ', ctx)).toBe(true);
  });
  it('matches ayah refs', () => {
    expect(matchesQuery(verse, '2:255', ctx)).toBe(true);
    expect(matchesQuery(verse, '2.255', ctx)).toBe(true);
    expect(matchesQuery(verse, '2:254', ctx)).toBe(false);
    expect(matchesQuery(page, '2:255', ctx)).toBe(false);
  });
  it('matches numbers as surah or page', () => {
    expect(matchesQuery(verse, '2', ctx)).toBe(true);
    expect(matchesQuery(verse, '42', ctx)).toBe(true);
    expect(matchesQuery(page, '440', ctx)).toBe(true);
    expect(matchesQuery(page, '2', ctx)).toBe(false);
  });
  it('matches "hal N"', () => {
    expect(matchesQuery(page, 'hal 440', ctx)).toBe(true);
    expect(matchesQuery(page, 'halaman 41', ctx)).toBe(false);
  });
  it('matches surah names Latin/English/Arabic ignoring hyphen and case', () => {
    expect(matchesQuery(verse, 'baqarah', ctx)).toBe(true);
    expect(matchesQuery(verse, 'AL BAQARA', ctx)).toBe(true);
    expect(matchesQuery(verse, 'البقرة', ctx)).toBe(true);
    expect(matchesQuery(verse, 'yasin', ctx)).toBe(false);
  });
  it('page bookmarks match the surah of the page', () => {
    expect(matchesQuery(page, 'yasin', ctx)).toBe(true);
    expect(matchesQuery(page, 'baqarah', ctx)).toBe(false);
  });
  it('matches note text case-insensitively', () => {
    expect(matchesQuery(verse, 'kursi', ctx)).toBe(true);
    expect(matchesQuery(verse, 'HAFALAN', ctx)).toBe(true);
    expect(matchesQuery(verse, 'xyz', ctx)).toBe(false);
  });
});

describe('sortBookmarks', () => {
  const a = bm({ page: 50, surah: 3, ayah: 2, updatedAt: 100 });
  const b = bm({ page: 2, surah: 2, ayah: 10, updatedAt: 300 });
  const c = bm({ page: 2, surah: 2, ayah: 3, updatedAt: 200 });
  const d = bm({ kind: 'page', page: 2, surah: null, ayah: null, updatedAt: 50 });
  it('mushaf order: page, surah, ayah', () => {
    expect(sortBookmarks([a, b, c, d], 'mushaf').map((x) => x.id)).toEqual([
      d.id,
      c.id,
      b.id,
      a.id,
    ]);
  });
  it('recent: updatedAt desc', () => {
    expect(sortBookmarks([a, b, c, d], 'recent').map((x) => x.id)).toEqual([
      b.id,
      c.id,
      a.id,
      d.id,
    ]);
  });
  it('does not mutate input', () => {
    const input = [a, b];
    sortBookmarks(input, 'mushaf');
    expect(input[0]).toBe(a);
  });
});

describe('filterBookmarks / folderCounts', () => {
  const v1 = bm({ page: 5, folderId: 'f1' });
  const v2 = bm({ page: 3, folderId: 'gone' });
  const p1 = bm({ kind: 'page', surah: null, ayah: null, page: 9, folderId: 'f2' });
  const all = [v1, v2, p1];
  const folders = [F1, F2];
  const base = { query: '', kind: 'all', folder: 'all', sort: 'mushaf' } as const;
  it('combines kind + folder + sort', () => {
    expect(filterBookmarks(all, folders, base, ctx).map((x) => x.id)).toEqual([
      v2.id,
      v1.id,
      p1.id,
    ]);
    expect(filterBookmarks(all, folders, { ...base, kind: 'page' }, ctx)).toEqual([p1]);
    expect(filterBookmarks(all, folders, { ...base, folder: 'none' }, ctx)).toEqual([v2]);
    expect(filterBookmarks(all, folders, { ...base, folder: 'f1', kind: 'page' }, ctx)).toEqual([]);
  });
  it('counts with dangling ids in none', () => {
    expect(folderCounts(all, folders)).toEqual({ all: 3, none: 1, byFolder: { f1: 1, f2: 1 } });
  });
});

describe('suggestions', () => {
  it('khatam: 1 + highest existing', () => {
    expect(suggestKhatamName([])).toBe('Khatam ke-1');
    expect(suggestKhatamName(['Khatam ke-1', 'Khatam ke-3'])).toBe('Khatam ke-4');
    expect(suggestKhatamName(['khatam ke-10', 'Khatam ke-2', 'Lainnya'])).toBe('Khatam ke-11');
    expect(suggestKhatamName(['Ramadhan 1447 · Khatam 1'])).toBe('Khatam ke-1');
  });
  it('hijri year is plausible', () => {
    const y = hijriYear(new Date(Date.UTC(2026, 2, 1)));
    if (y !== null) expect(y).toBe(1447);
  });
  it('ramadhan suggestion has the expected shape', () => {
    const s = suggestRamadhanName(new Date(Date.UTC(2026, 2, 1)));
    if (s !== null) expect(s).toMatch(/^Ramadhan \d{4} · Khatam 1$/);
  });
  it('skips names already taken', () => {
    const d = new Date(Date.UTC(2026, 2, 1));
    const ram = suggestRamadhanName(d);
    const taken = ['Khatam ke-1', ...(ram ? [ram.toUpperCase()] : [])];
    expect(folderNameSuggestions(taken, d)).toEqual(['Khatam ke-2']);
  });
});

describe('isPageEndVerse', () => {
  const last = (page: number) => (page === 528 ? { surah: 54, ayah: 6 } : null);
  it('is true only for the last ayah of the bookmarked page', () => {
    expect(isPageEndVerse({ kind: 'verse', page: 528, surah: 54, ayah: 6 }, last)).toBe(true);
    expect(isPageEndVerse({ kind: 'verse', page: 528, surah: 54, ayah: 5 }, last)).toBe(false);
  });
  it('is false for page bookmarks and unknown pages', () => {
    expect(isPageEndVerse({ kind: 'page', page: 528, surah: null, ayah: null }, last)).toBe(false);
    expect(isPageEndVerse({ kind: 'verse', page: 1, surah: 1, ayah: 7 }, last)).toBe(false);
  });
});

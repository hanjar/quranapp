import { describe, expect, it } from 'vitest';
import { Bookmark, BookmarkFolder } from '../../core/models';
import {
  canSearchTranslation,
  indexTranslation,
  isReferenceQuery,
  makeSnippet,
  normalizeText,
  queryTokens,
  searchBookmarks,
  searchTranslation,
  toBookmarkRows,
  tokenize,
  withinOneEdit,
  wordScore,
} from './universal-search';

function bm(p: Partial<Bookmark>): Bookmark {
  return {
    id: 'x',
    kind: 'verse',
    editionId: 'hafs-kfqc',
    page: 1,
    surah: 1,
    ayah: 1,
    key: 'k',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    rev: null,
    folderId: null,
    note: null,
    ...p,
  } as Bookmark;
}

describe('normalisation', () => {
  it('strips case, diacritics, apostrophes and hyphens', () => {
    expect(normalizeText("Al-Qur'ān")).toBe('alquran');
    expect(tokenize('Layar  menyala!')).toEqual(['layar', 'menyala']);
  });
  it('drops filler words but keeps a query that is only filler', () => {
    expect(queryTokens('cara install aplikasi')).toEqual(['install', 'aplikasi']);
    expect(queryTokens('cara')).toEqual(['cara']);
  });
});

describe('typo tolerance', () => {
  it('withinOneEdit covers substitution, insert, delete, swap', () => {
    expect(withinOneEdit('install', 'instal')).toBe(true);
    expect(withinOneEdit('setting', 'settign')).toBe(true);
    expect(withinOneEdit('abcd', 'abxd')).toBe(true);
    expect(withinOneEdit('abcd', 'axyd')).toBe(false);
    expect(withinOneEdit('a', 'abc')).toBe(false);
  });
  it('only tolerates typos for words of 5+ letters', () => {
    expect(wordScore('instal', 'install')).toBeGreaterThan(0);
    expect(wordScore('tem', 'tema')).toBeGreaterThan(0); // prefix
    expect(wordScore('tame', 'tema')).toBe(0); // short word: no typo match
    expect(wordScore('unduj', 'unduh')).toBeGreaterThan(0);
  });
});

describe('bookmarks', () => {
  const folders = [{ id: 'f1', name: 'Khatam ke-2' }] as BookmarkFolder[];
  const rows = toBookmarkRows(
    [
      bm({ id: 'a', surah: 36, ayah: 1, page: 440, note: 'hafalan malam' }),
      bm({ id: 'b', surah: 2, ayah: 255, page: 42, folderId: 'f1' }),
      bm({ id: 'c', kind: 'page', surah: null, ayah: null, page: 50 }),
    ],
    folders,
    { surahName: (n) => (n === 36 ? 'Yasin' : 'Al-Baqarah'), surahOfPage: () => 'Ali Imran' },
  );
  it('matches surah name, note and folder name', () => {
    expect(searchBookmarks('yasin', rows).map((r) => r.bookmark.id)).toEqual(['a']);
    expect(searchBookmarks('hafalan', rows).map((r) => r.bookmark.id)).toEqual(['a']);
    expect(searchBookmarks('khatam', rows).map((r) => r.bookmark.id)).toEqual(['b']);
    expect(searchBookmarks('imran', rows).map((r) => r.bookmark.id)).toEqual(['c']);
  });
  it('requires every word and honours the limit', () => {
    expect(searchBookmarks('yasin khatam', rows)).toEqual([]);
    expect(searchBookmarks('', rows)).toEqual([]);
    const many = toBookmarkRows(
      Array.from({ length: 9 }, (_, i) => bm({ id: String(i) })),
      [],
      { surahName: () => 'Yasin', surahOfPage: () => '' },
    );
    expect(searchBookmarks('yasin', many, 5)).toHaveLength(5);
  });
});

describe('translation search', () => {
  const idx = indexTranslation({
    '1:1': 'Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.',
    '1:2': 'Segala puji bagi Allah, Tuhan seluruh alam,',
    '2:255': 'Allah, tidak ada tuhan selain Dia. Yang Mahahidup, Yang terus-menerus mengurus (makhluk-Nya).',
  });
  it('is accent/case-insensitive and returns surah:ayah', () => {
    const hits = searchTranslation('PENGASIH', idx);
    expect(hits.map((h) => `${h.surah}:${h.ayah}`)).toEqual(['1:1']);
    expect(hits[0].segments.some((s) => s.hit && s.text === 'Pengasih')).toBe(true);
  });
  it('finds words regardless of hyphens and falls back to all-words match', () => {
    expect(searchTranslation('terusmenerus', idx)).toHaveLength(1);
    expect(searchTranslation('tuhan allah', idx).map((h) => h.ayah)).toEqual([2, 255]);
  });
  it('limits results and ignores references / short queries', () => {
    const big = indexTranslation(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`1:${i + 1}`, 'kata sama'])));
    expect(searchTranslation('sama', big, 20)).toHaveLength(20);
    expect(canSearchTranslation('al')).toBe(false);
    expect(canSearchTranslation('2:255')).toBe(false);
    expect(canSearchTranslation('hal 50')).toBe(false);
    expect(canSearchTranslation('allah')).toBe(true);
    expect(searchTranslation('50', idx)).toEqual([]);
  });
  it('snippet keeps original text, marks hits, never emits markup', () => {
    const segs = makeSnippet('Dengan <b>nama</b> Allah', ['nama']);
    expect(segs.map((s) => s.text).join('')).toBe('Dengan <b>nama</b> Allah');
    expect(segs.find((s) => s.hit)?.text).toBe('nama');
  });
  it('truncates long text with ellipses around the hit', () => {
    const text = `${'awal '.repeat(40)}TARGET ${'akhir '.repeat(40)}`;
    const segs = makeSnippet(text, ['target']);
    expect(segs[0].text).toBe('…');
    expect(segs[segs.length - 1].text).toBe('…');
    expect(segs.find((s) => s.hit)?.text).toBe('TARGET');
  });
});

describe('isReferenceQuery', () => {
  it('recognises reference shapes', () => {
    for (const q of ['2:255', '2.255', 'hal 50', 'h. 5', 'juz 30', '114']) expect(isReferenceQuery(q)).toBe(true);
    for (const q of ['yasin', 'tema', 'juz amma']) expect(isReferenceQuery(q)).toBe(false);
  });
});

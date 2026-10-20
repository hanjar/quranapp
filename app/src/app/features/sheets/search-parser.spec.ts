import { describe, expect, it } from 'vitest';
import { AyahRef, SurahMeta } from '../../core/models';
import { SearchContext, nameMatchRank, normalizeName, parseSearch } from './search-parser';

function s(number: number, nameLatin: string, nameEnglish: string, nameArabic: string, ayahCount: number, startPage: number, juz: number): SurahMeta {
  return { number, nameLatin, nameEnglish, nameArabic, ayahCount, startPage, endPage: startPage, juz };
}

const SURAHS: SurahMeta[] = [
  s(1, 'Al-Fatihah', 'Al-Fatiha', 'الفاتحة', 7, 1, 1),
  s(2, 'Al-Baqarah', 'Al-Baqara', 'البقرة', 286, 2, 1),
  s(3, 'Ali Imran', 'Ali Imran', 'آل عمران', 200, 50, 3),
  s(36, 'Yasin', 'Ya-Sin', 'يس', 83, 440, 22),
  s(112, 'Al-Ikhlas', 'Al-Ikhlas', 'الإخلاص', 4, 604, 30),
  s(113, 'Al-Falaq', 'Al-Falaq', 'الفلق', 5, 604, 30),
  s(114, 'An-Nas', 'An-Nas', 'الناس', 6, 604, 30),
];
// Sparse fake: build a 114-entry array so surahs[n-1] indexing works.
const ALL: SurahMeta[] = Array.from({ length: 114 }, (_, i) => {
  const found = SURAHS.find((x) => x.number === i + 1);
  return found ?? s(i + 1, `Surah ${i + 1}`, `Surah ${i + 1}`, 'س', 10, Math.min(604, i * 5 + 1), 1);
});

const JUZ_PAGES = Array.from({ length: 30 }, (_, i) => (i === 0 ? 1 : i * 20 + 2));

const ctx: SearchContext = {
  surahs: ALL,
  juzStartPage: (j) => JUZ_PAGES[j - 1] ?? null,
  pageOf: (r: AyahRef) => (r.surah === 2 && r.ayah === 255 ? 42 : r.surah === 36 && r.ayah === 1 ? 440 : r.surah * 3),
  surahAt: (p) => (p === 42 ? ALL[1] : p >= 440 && p < 445 ? ALL[35] : ALL[0]),
  juzAt: (p) => (p === 42 ? 3 : 1),
};

describe('normalizeName', () => {
  it('lowercases and strips non-letters and diacritics', () => {
    expect(normalizeName('Al-Baqarah')).toBe('albaqarah');
    expect(normalizeName('Yā-Sīn')).toBe('yasin');
    expect(normalizeName('  A. 1 b ')).toBe('ab');
  });
});

describe('nameMatchRank', () => {
  it('ranks exact < prefix < substring', () => {
    const baq = ALL[1];
    expect(nameMatchRank(baq, 'baqarah')).toBe(0);
    expect(nameMatchRank(baq, 'albaqarah')).toBe(0);
    expect(nameMatchRank(baq, 'baq')).toBe(1);
    expect(nameMatchRank(baq, 'aqar')).toBe(2);
    expect(nameMatchRank(baq, 'zzz')).toBeNull();
  });
  it('matches English name and Arabic', () => {
    expect(nameMatchRank(ALL[35], 'ya-sin')).toBe(0);
    expect(nameMatchRank(ALL[35], 'يس')).toBe(1);
    expect(nameMatchRank(ALL[35], 'بقرة')).toBeNull();
  });
});

describe('parseSearch', () => {
  it('returns [] for blank or when content not loaded', () => {
    expect(parseSearch('   ', ctx)).toEqual([]);
    expect(parseSearch('yasin', { ...ctx, surahs: [] })).toEqual([]);
  });

  it('parses 2:255 with exact page and highlight', () => {
    const [r] = parseSearch('2:255', ctx);
    expect(r.page).toBe(42);
    expect(r.highlight).toEqual({ surah: 2, ayah: 255 });
    expect(r.title).toBe('Al-Baqarah · Ayat 255');
    expect(r.sub).toBe('Surah 2 · Hal. 42 · Juz 3');
  });

  it.each(['2.255', '2 : 255', ' 2:255 ', '02:255'])('accepts the ayah form %j', (q) => {
    expect(parseSearch(q, ctx)[0]?.highlight).toEqual({ surah: 2, ayah: 255 });
  });

  it('rejects out-of-range ayah/surah refs', () => {
    expect(parseSearch('2:287', ctx)).toEqual([]);
    expect(parseSearch('2:0', ctx)).toEqual([]);
    expect(parseSearch('115:1', ctx)).toEqual([]);
    expect(parseSearch('0:1', ctx)).toEqual([]);
  });

  it('returns [] when pageOf yields null', () => {
    expect(parseSearch('2:1', { ...ctx, pageOf: () => null })).toEqual([]);
  });

  it.each(['hal 50', 'hal50', 'halaman 50', 'Halaman 50', 'h. 50', 'HAL. 50'])('parses page query %j', (q) => {
    const [r] = parseSearch(q, ctx);
    expect(r.page).toBe(50);
    expect(r.title).toBe('Halaman 50');
    expect(r.highlight).toBeUndefined();
  });

  it('rejects pages out of range', () => {
    expect(parseSearch('hal 0', ctx)).toEqual([]);
    expect(parseSearch('hal 605', ctx)).toEqual([]);
  });

  it('parses juz queries', () => {
    const [r] = parseSearch('juz 30', ctx);
    expect(r.title).toBe('Juz 30');
    expect(r.page).toBe(JUZ_PAGES[29]);
    expect(parseSearch('Juz30', ctx)[0]?.page).toBe(JUZ_PAGES[29]);
    expect(parseSearch('juz 31', ctx)).toEqual([]);
    expect(parseSearch('juz 0', ctx)).toEqual([]);
  });

  it('bare number gives surah and page', () => {
    const out = parseSearch('36', ctx);
    expect(out.map((r) => r.title)).toEqual(['36. Yasin', 'Halaman 36']);
    expect(out[0].page).toBe(440);
    expect(out[0].sub).toBe('83 ayat · Hal. 440 · Juz 22');
  });

  it('bare number above 114 gives page only; above 604 nothing', () => {
    expect(parseSearch('300', ctx).map((r) => r.title)).toEqual(['Halaman 300']);
    expect(parseSearch('700', ctx)).toEqual([]);
  });

  it('matches surah names ignoring case, hyphens, spaces and the Al-/An- prefix', () => {
    expect(parseSearch('yasin', ctx)[0].page).toBe(440);
    expect(parseSearch('YASIN', ctx)[0].page).toBe(440);
    expect(parseSearch('Al-Baqarah', ctx)[0].title).toBe('2. Al-Baqarah');
    expect(parseSearch('al baqarah', ctx)[0].title).toBe('2. Al-Baqarah');
    expect(parseSearch('baqarah', ctx)[0].title).toBe('2. Al-Baqarah');
    expect(parseSearch('nas', ctx)[0].title).toBe('114. An-Nas');
    expect(parseSearch('an-nas', ctx)[0].title).toBe('114. An-Nas');
  });

  it('matches English names and Arabic names', () => {
    expect(parseSearch('Ya-Sin', ctx)[0].title).toBe('36. Yasin');
    expect(parseSearch('البقرة', ctx)[0].title).toBe('2. Al-Baqarah');
  });

  it('ranks exact matches before substring matches and caps at 10', () => {
    const out = parseSearch('ikhlas', ctx);
    expect(out[0].title).toBe('112. Al-Ikhlas');
    expect(parseSearch('surah', ctx).length).toBe(10);
  });

  it('returns [] for unknown text', () => {
    expect(parseSearch('qwertyuiop', ctx)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { SurahMeta } from '../../core/models';
import { filterJuz, filterSurahs, formatDate, parsePageInput, latinCopyText, shareText, translationCopyText, verseReference, verseUrl } from './nav-helpers';

const mk = (
  number: number,
  nameLatin: string,
  nameEnglish: string,
  nameArabic: string,
): SurahMeta => ({
  number,
  nameLatin,
  nameEnglish,
  nameArabic,
  ayahCount: 5,
  startPage: number,
  endPage: number,
  juz: 1,
});
const SURAHS = [
  mk(1, 'Al-Fatihah', 'Al-Fatiha', 'الفاتحة'),
  mk(2, 'Al-Baqarah', 'Al-Baqara', 'البقرة'),
  mk(12, 'Yusuf', 'Yusuf', 'يوسف'),
  mk(36, 'Yasin', 'Ya-Sin', 'يس'),
];

describe('formatDate', () => {
  it('formats as "12 Okt 2026"', () => {
    expect(formatDate(new Date(2026, 9, 12, 10).getTime())).toBe('12 Okt 2026');
    expect(formatDate(new Date(2026, 4, 1, 10).getTime())).toBe('1 Mei 2026');
    expect(formatDate(new Date(2025, 7, 31, 10).getTime())).toBe('31 Agu 2025');
  });
});

describe('filterSurahs', () => {
  it('returns all for blank query', () => {
    expect(filterSurahs(SURAHS, '  ')).toHaveLength(4);
  });
  it('filters by number exactly', () => {
    expect(filterSurahs(SURAHS, '2').map((s) => s.number)).toEqual([2]);
    expect(filterSurahs(SURAHS, '12').map((s) => s.number)).toEqual([12]);
  });
  it('filters by Latin, English and Arabic names', () => {
    expect(filterSurahs(SURAHS, 'ya').map((s) => s.number)).toEqual([36]);
    expect(filterSurahs(SURAHS, 'yu').map((s) => s.number)).toEqual([12]);
    expect(filterSurahs(SURAHS, 'baqarah').map((s) => s.number)).toEqual([2]);
    expect(filterSurahs(SURAHS, 'يوسف').map((s) => s.number)).toEqual([12]);
    expect(filterSurahs(SURAHS, 'xyz')).toEqual([]);
  });
});

describe('filterJuz', () => {
  const juz = Array.from({ length: 30 }, (_, i) => ({ number: i + 1 }));
  it('all / specific / none', () => {
    expect(filterJuz(juz, '')).toHaveLength(30);
    expect(filterJuz(juz, '30').map((j) => j.number)).toEqual([30]);
    expect(filterJuz(juz, 'juz 5').map((j) => j.number)).toEqual([5]);
    expect(filterJuz(juz, 'abc')).toEqual([]);
  });
});

describe('parsePageInput', () => {
  it.each([
    ['1', 1],
    ['604', 604],
    [' 42 ', 42],
    ['007', 7],
  ])('accepts %j', (raw, n) => {
    expect(parsePageInput(raw)).toBe(n);
  });
  it.each(['', '0', '605', '-1', '4.5', 'abc', '12a', '99999'])('rejects %j', (raw) => {
    expect(parsePageInput(raw)).toBeNull();
  });
});

describe('verseReference', () => {
  it('builds the copy/share text', () => {
    expect(verseReference({ nameLatin: 'Al-Baqarah', number: 2 }, 255, 42)).toBe(
      'QS. Al-Baqarah 2:255 (hal. 42)',
    );
  });
});

describe('latinCopyText', () => {
  it('prefixes the reference with an em dash', () => {
    expect(latinCopyText({ nameLatin: 'At-Tur', number: 52 }, 47, '  wa inna  ')).toBe('QS. At-Tur 52:47 — wa inna');
  });
});

describe('translationCopyText / shareText', () => {
  const surah = { nameLatin: 'At-Tur', number: 52 };
  it('copies translation with attribution', () => {
    expect(translationCopyText(surah, 47, ' terjemah ')).toBe('QS. At-Tur 52:47 — terjemah (Terjemahan Kemenag RI)');
  });
  it('shares reference only when nothing else is loaded', () => {
    expect(shareText({ reference: 'R', latin: null, translation: undefined })).toBe('R');
    expect(shareText({ reference: 'R', arabic: ' ', latin: '  ', translation: '' })).toBe('R');
  });
  it('uses Arabic, then translation, then the link', () => {
    expect(
      shareText({
        reference: 'R',
        arabic: 'ar',
        latin: 'wa inna',
        translation: 'dan sungguh',
        url: 'https://quran.hanjar.net/59/3',
      }),
    ).toBe('R\nar\n\n"dan sungguh" (Terjemahan Kemenag RI)\n\nhttps://quran.hanjar.net/59/3');
  });
  it('falls back to Latin when Arabic is not available', () => {
    expect(
      shareText({ reference: 'R', arabic: null, latin: 'wa inna', translation: 'x', url: 'U' }),
    ).toBe('R\nwa inna\n\n"x" (Terjemahan Kemenag RI)\n\nU');
  });
  it('omits a missing translation but keeps the link', () => {
    expect(shareText({ reference: 'R', arabic: 'ar', url: 'U' })).toBe('R\nar\n\nU');
    expect(shareText({ reference: 'R', url: 'U' })).toBe('R\n\nU');
  });
  it('builds the deep link from the runtime origin', () => {
    expect(verseUrl('https://quran.hanjar.net', 59, 3)).toBe('https://quran.hanjar.net/59/3');
    expect(verseUrl('http://localhost:4200/', 1, 1)).toBe('http://localhost:4200/1/1');
  });
});

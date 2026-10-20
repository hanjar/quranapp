import { describe, expect, it } from 'vitest';
import { PageMeta } from '../../core/models';
import { pageAyahs } from './translation-logic';

const meta = (first: [number, number], last: [number, number], surahs: number[]): PageMeta => ({
  page: 1,
  first: { surah: first[0], ayah: first[1] },
  last: { surah: last[0], ayah: last[1] },
  surahs,
  juz: 1,
  juzStarts: [],
});
const counts: Record<number, number> = { 1: 7, 2: 286, 9: 129, 10: 109 };

describe('pageAyahs', () => {
  it('lists a range inside one surah', () => {
    const r = pageAyahs(meta([2, 6], [2, 8], [2]), (s) => counts[s]);
    expect(r.map((a) => a.ayah)).toEqual([6, 7, 8]);
    expect(r.some((a) => a.startsSurah)).toBe(false);
  });

  it('crosses surah boundaries and flags headings/bismillah', () => {
    const r = pageAyahs(meta([9, 128], [10, 2], [9, 10]), (s) => counts[s]);
    expect(r.map((a) => `${a.surah}:${a.ayah}`)).toEqual(['9:128', '9:129', '10:1', '10:2']);
    expect(r[2].startsSurah).toBe(true);
    expect(r[2].bismillah).toBe(true);
  });

  it('no separate bismillah for surah 1 and 9', () => {
    const a = pageAyahs(meta([1, 1], [1, 7], [1]), (s) => counts[s]);
    expect(a[0]).toMatchObject({ startsSurah: true, bismillah: false });
    const b = pageAyahs(meta([9, 1], [9, 2], [9]), (s) => counts[s]);
    expect(b[0]).toMatchObject({ startsSurah: true, bismillah: false });
  });
});

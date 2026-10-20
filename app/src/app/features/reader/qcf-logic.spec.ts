import {
  CENTER_BELOW,
  QcfLayout,
  computeMetrics,
  gridRows,
  isCenteredLine,
  isQcfCover,
  isQcfLayout,
  layoutVerses,
  paletteCss,
  qcfFamily,
  qcfFontUrl,
} from './qcf-logic';

const layout = (page: number, lines: QcfLayout['lines']): QcfLayout => ({ format: 'mushaf-qcf', version: 1, page, lines });

describe('qcf-logic', () => {
  it('builds the CDN font url and a per-page family', () => {
    expect(qcfFontUrl(562)).toBe('https://verses.quran.foundation/fonts/quran/hafs/v4/colrv1/woff2/p562.woff2');
    expect(qcfFamily(7)).toBe('mf-qcf-p7');
  });

  it('validates layout files', () => {
    const ok = layout(3, [{ n: 1, type: 'text', words: [{ code: 'a', verse: '2:3' }] }]);
    expect(isQcfLayout(ok, 3)).toBe(true);
    expect(isQcfLayout(ok, 4)).toBe(false);
    expect(isQcfLayout({ ...ok, format: 'x' }, 3)).toBe(false);
    expect(isQcfLayout(layout(3, [{ n: 16, type: 'text' }]), 3)).toBe(false);
    expect(isQcfLayout(null, 3)).toBe(false);
  });

  it('lists unique verses in reading order', () => {
    const l = layout(2, [
      { n: 1, type: 'surah', surah: 2 },
      { n: 3, type: 'text', words: [{ code: 'a', verse: '2:1' }, { code: 'b', verse: '2:1', type: 'end' }, { code: 'c', verse: '2:2' }] },
      { n: 4, type: 'text', words: [{ code: 'd', verse: '2:2' }] },
    ]);
    expect(layoutVerses(l)).toEqual([{ surah: 2, ayah: 1 }, { surah: 2, ayah: 2 }]);
  });

  it('uses 8 rows on cover pages and 15 elsewhere', () => {
    expect(isQcfCover(1)).toBe(true);
    expect(isQcfCover(3)).toBe(false);
    expect(gridRows(layout(1, [{ n: 1, type: 'surah', surah: 1 }]))).toBe(8);
    expect(gridRows(layout(9, [{ n: 1, type: 'surah', surah: 1 }]))).toBe(15);
  });

  it('centres short lines, justifies full ones, and always centres cover lines', () => {
    const m = computeMetrics({ 1: 10, 2: 10 * CENTER_BELOW - 0.1, 3: 9.5 });
    expect(m.maxEm).toBe(10);
    const line = (n: number) => ({ n, type: 'text' as const, words: [] });
    expect(isCenteredLine(line(1), m, false)).toBe(false);
    expect(isCenteredLine(line(2), m, false)).toBe(true);
    expect(isCenteredLine(line(3), m, false)).toBe(false);
    expect(isCenteredLine(line(1), m, true)).toBe(true);
    expect(isCenteredLine({ n: 1, type: 'surah', surah: 2 }, m, true)).toBe(false);
    expect(isCenteredLine(line(1), null, false)).toBe(false);
  });

  it('metrics fall back to a default width when nothing was measured', () => {
    expect(computeMetrics({}).maxEm).toBeGreaterThan(0);
  });

  it('palette css overrides the base ink per theme for one font family', () => {
    const css = paletteCss('mf-qcf-p5');
    expect(css).toContain('@font-palette-values --mf-qcf-night');
    expect(css).toContain('font-family: "mf-qcf-p5"');
    expect(css).toContain('base-palette: 1');
    expect(css.match(/@font-palette-values/g)?.length).toBe(4);
  });
});

import { NAMED_COLORS, findColors, parseColorWords } from './color-names';
import { contrastChecks, contrastRatio, isHexColor } from './custom-theme';
import { suggestThemes } from './theme-wizard';

describe('color names', () => {
  it('finds everyday Indonesian and English names, with typos', () => {
    expect(findColors('beige')[0]!.hex).toBe('#f5f5dc');
    expect(findColors('Maroon')[0]!.hex).toBe('#800000');
    expect(findColors('marun')[0]!.hex).toBe('#800000');
    expect(findColors('warna dongker')[0]!.names[0]).toBe('Biru dongker');
    expect(findColors('abu-abu')[0]!.names[0]).toBe('Abu-abu');
    expect(findColors('toska')[0]!.names[0]).toBe('Tosca');
    expect(findColors('terakota')[0]!.names[0]).toBe('Terracotta');
    expect(findColors('lavendr')[0]!.names[0]).toBe('Lavender');
    expect(findColors('qwertyzz')).toEqual([]);
  });

  it('splits "beige dan maroon" into two colours and reports unknown words', () => {
    const r = parseColorWords('beige dan maroon, xyzzy');
    expect(r.found.map((c) => c.hex)).toEqual(['#f5f5dc', '#800000']);
    expect(r.unknown).toEqual(['xyzzy']);
  });

  it('every entry is a valid colour with a unique label', () => {
    for (const c of NAMED_COLORS) expect(isHexColor(c.hex)).toBe(true);
    const labels = NAMED_COLORS.map((c) => c.names[0]!.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('suggestThemes', () => {
  it('two colours: the light one is the paper, the deep one the frame', () => {
    const [, mid] = suggestThemes(['#800000', '#f5f5dc']);
    expect(mid!.colors.paper).toMatch(/^#f/);
    expect(contrastRatio(mid!.colors.frameInk, '#800000')).toBeLessThan(1.3);
  });

  it('every named colour gives three readable themes', () => {
    for (const c of NAMED_COLORS) {
      const s = suggestThemes([c.hex]);
      expect(s.map((x) => x.id)).toEqual(['lembut', 'seimbang', 'tegas']);
      for (const t of s) {
        expect(contrastChecks(t.colors).every((k) => k.ok), `${c.names[0]} ${t.id}`).toBe(true);
        expect(contrastRatio(t.colors.textInk, t.colors.paper)).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

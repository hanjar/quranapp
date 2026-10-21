import { describe, expect, it } from 'vitest';
import { decorateLineRules, findGapY, ruleYs } from './line-rules';

describe('ruleYs', () => {
  it('gives 14 evenly spaced separators', () => {
    const ys = ruleYs();
    expect(ys.length).toBe(14);
    expect(ys[0]).toBeCloseTo(36.67, 1);
    expect(ys[13]).toBeCloseTo(513.33, 1);
  });
  it('skips rules touching a header band', () => {
    const ys = ruleYs([{ surah: 2, x: 0, y: 40, width: 345, height: 36 }]);
    expect(ys.length).toBeLessThan(14);
    expect(ys).not.toContain(73.33);
  });
});

describe('findGapY', () => {
  const inkWith = (gaps: [number, number][], base = 100) => {
    const a = new Array<number>(550).fill(base);
    for (const [s, e] of gaps) for (let y = s; y <= e; y++) a[y] = 0;
    return a;
  };
  it('centres on the lowest-ink run', () => {
    expect(findGapY(inkWith([[40, 45]]), 36.67)).toBe(43);
  });
  it('prefers the run closest to the grid on ties', () => {
    // runs centred at 30 (|d|=6.67) and 43 (|d|=6.33)
    expect(findGapY(inkWith([[29, 30], [42, 43]]), 36.67)).toBe(43);
  });
  it('ignores gaps outside the search window', () => {
    expect(findGapY(inkWith([[100, 110]]), 36.67)).toBeLessThanOrEqual(36.67 + 1);
  });
  it('uses the least-ink rows when no row is empty', () => {
    const a = new Array<number>(550).fill(50);
    a[38] = 5;
    expect(findGapY(a, 36.67)).toBe(38.5);
  });
  it('returns the grid position when ink does not cover the window', () => {
    expect(findGapY([], 36.67)).toBe(36.67);
  });
  it('is used by ruleYs when an ink profile is given', () => {
    const ys = ruleYs([], inkWith([[40, 45]]));
    expect(ys[0]).toBe(43);
    expect(ys.length).toBe(14);
  });
});

describe('decorateLineRules', () => {
  it('is idempotent, hidden from AT and placed before the text', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    svg.innerHTML =
      '<g id="content"><path d="M0 0"/></g><path class="ayahPolygon" surah="2" ayah="1" d="M5 0 L340 0 L340 30 L5 30 Z"/>';
    decorateLineRules(svg);
    decorateLineRules(svg);
    const layers = svg.querySelectorAll('.mf-line-rules');
    expect(layers.length).toBe(1);
    expect(layers[0].getAttribute('aria-hidden')).toBe('true');
    expect(layers[0].querySelectorAll('line').length).toBe(14);
    expect(svg.firstElementChild).toBe(layers[0]);
  });
});

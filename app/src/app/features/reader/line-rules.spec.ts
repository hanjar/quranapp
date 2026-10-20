import { describe, expect, it } from 'vitest';
import { decorateLineRules, ruleYs } from './line-rules';

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

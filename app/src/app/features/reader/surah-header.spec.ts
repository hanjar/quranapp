import { describe, expect, it } from 'vitest';
import { computeHeaderBands, decorateSurahHeaders, pathBox, collectPolyBoxes, PolyBox } from './surah-header';

const box = (surah: number, ayah: number, minY: number, maxY: number): PolyBox => ({
  surah,
  ayah,
  minX: 0,
  maxX: 340,
  minY,
  maxY,
});

describe('pathBox', () => {
  it('handles multi-subpath', () => {
    expect(pathBox('M 1 2 L 5 2 L 5 9 L 1 9 Z M 0.5 10 L 4 10 L 4 20 Z')).toEqual({
      minX: 0.5,
      maxX: 5,
      minY: 2,
      maxY: 20,
    });
    expect(pathBox('')).toBeNull();
  });
});

describe('computeHeaderBands', () => {
  it('several surahs on one page (604-like)', () => {
    const bands = computeHeaderBands([
      box(112, 1, 74.25, 112.75),
      box(112, 4, 112.75, 148.25),
      box(113, 1, 218.5, 257.25),
      box(113, 5, 295.75, 329.5),
      box(114, 1, 398.5, 437.25),
    ]);
    expect(bands.map((b) => b.surah)).toEqual([112, 113, 114]);
    expect(bands[0].y).toBe(0);
    expect(bands[0].height).toBeCloseTo(37.1, 0);
    expect(bands[1].y).toBe(148.25);
    expect(bands[1].height).toBeCloseTo(35.1, 0);
  });
  it('At-Taubah has no basmalah: one line only', () => {
    const [b] = computeHeaderBands([box(9, 1, 39.5, 82.25), box(9, 2, 82.25, 153.75)]);
    expect(b.y).toBe(0);
    expect(b.height).toBeCloseTo(39.5);
  });
  it('skips surah 1, mid-surah pages and cramped gaps', () => {
    expect(computeHeaderBands([box(1, 1, 74, 112)])).toEqual([]);
    expect(computeHeaderBands([box(2, 6, 0, 80), box(2, 7, 41, 113)])).toEqual([]);
    expect(computeHeaderBands([box(5, 1, 10, 50)])).toEqual([]);
    expect(computeHeaderBands([])).toEqual([]);
  });
});

describe('decorateSurahHeaders', () => {
  const poly = (surah: number, ayah: number, y0: number, y1: number) =>
    `<path class="ayahPolygon" surah="${surah}" ayah="${ayah}" d="M 0 ${y0} L 340 ${y0} L 340 ${y1} L 0 ${y1} Z"/>`;
  const make = () => {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 345 550"><g transform="scale(1)"><g id="ayah_markers"/><g id="content"/></g>` +
        poly(112, 1, 74.25, 112.75) +
        poly(113, 1, 218.5, 257.25) +
        '</svg>',
      'image/svg+xml',
    );
    return doc.documentElement as unknown as SVGSVGElement;
  };
  it('inserts a layer before the text, aria-hidden, idempotently', () => {
    const svg = make();
    decorateSurahHeaders(svg);
    decorateSurahHeaders(svg);
    expect(svg.querySelectorAll('.mf-surah-header').length).toBe(2);
    expect(svg.querySelectorAll('.mf-surah-header[aria-hidden="true"]').length).toBe(2);
    const kids = Array.from(svg.children);
    expect(kids.indexOf(svg.querySelector('.mf-surah-headers')!)).toBeLessThan(
      kids.findIndex((k) => k.querySelector('#content')),
    );
  });
});

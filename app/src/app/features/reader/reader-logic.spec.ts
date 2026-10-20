import { describe, expect, it } from 'vitest';
import {
  decideFitWidth,
  clampPan,
  decideSpread,
  formatZoom,
  isCoverPage,
  nextTarget,
  paddedViewBox,
  parsePageParam,
  prefetchPages,
  prevTarget,
  spreadStart,
  visiblePagesFor,
  zoomAt,
  verseStateFlags,
  PAGE_ASPECT,
} from './reader-logic';

describe('parsePageParam', () => {
  it('accepts 1..604', () => {
    expect(parsePageParam('1')).toBe(1);
    expect(parsePageParam('604')).toBe(604);
    expect(parsePageParam('042')).toBe(42);
  });
  it('rejects junk', () => {
    for (const v of ['0', '605', '-1', 'abc', '1.5', '', ' ', null, undefined, '9999'])
      expect(parsePageParam(v)).toBeNull();
  });
});

describe('decideSpread', () => {
  it('auto: landscape and >= 900', () => {
    expect(decideSpread('auto', 1200, 800)).toBe(true);
    expect(decideSpread('auto', 900, 800)).toBe(true);
    expect(decideSpread('auto', 899, 500)).toBe(false);
    expect(decideSpread('auto', 900, 1200)).toBe(false); // portrait
    expect(decideSpread('auto', 400, 800)).toBe(false);
  });
  it('spread: forced when >= 700', () => {
    expect(decideSpread('spread', 700, 1000)).toBe(true);
    expect(decideSpread('spread', 699, 300)).toBe(false);
  });
  it('single: never', () => {
    expect(decideSpread('single', 2000, 900)).toBe(false);
  });
});

describe('spread pairing', () => {
  it('pairs [odd, odd+1]', () => {
    expect(visiblePagesFor(1, true)).toEqual([1, 2]);
    expect(visiblePagesFor(2, true)).toEqual([1, 2]);
    expect(visiblePagesFor(3, true)).toEqual([3, 4]);
    expect(visiblePagesFor(4, true)).toEqual([3, 4]);
    expect(visiblePagesFor(603, true)).toEqual([603, 604]);
    expect(visiblePagesFor(604, true)).toEqual([603, 604]);
  });
  it('single returns the page', () => {
    expect(visiblePagesFor(604, false)).toEqual([604]);
  });
  it('spreadStart', () => {
    expect(spreadStart(10)).toBe(9);
    expect(spreadStart(9)).toBe(9);
  });
});

describe('next / prev targets', () => {
  it('single mode', () => {
    expect(nextTarget([5], false)).toBe(6);
    expect(prevTarget([5], false)).toBe(4);
    expect(nextTarget([604], false)).toBeNull();
    expect(prevTarget([1], false)).toBeNull();
  });
  it('spread mode moves by two', () => {
    expect(nextTarget([1, 2], true)).toBe(3);
    expect(nextTarget([3, 4], true)).toBe(5);
    expect(prevTarget([3, 4], true)).toBe(1);
    expect(prevTarget([5, 6], true)).toBe(3);
    expect(nextTarget([603, 604], true)).toBeNull();
    expect(prevTarget([1, 2], true)).toBeNull();
    expect(nextTarget([601, 602], true)).toBe(603);
  });
});

describe('prefetchPages', () => {
  it('surrounds visible pages and clips at edges', () => {
    expect(prefetchPages([10], 2).sort((a, b) => a - b)).toEqual([8, 9, 11, 12]);
    expect(prefetchPages([1, 2], 2).sort((a, b) => a - b)).toEqual([3, 4]);
    expect(prefetchPages([603, 604], 2).sort((a, b) => a - b)).toEqual([601, 602]);
  });
});

describe('zoom / pan maths', () => {
  const size = { width: 400, height: 800 };
  it('clampPan keeps content covering the stage', () => {
    expect(clampPan({ x: 50, y: 50 }, 2, size)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -999, y: -999 }, 2, size)).toEqual({ x: -400, y: -800 });
    expect(clampPan({ x: -10, y: -20 }, 1, size)).toEqual({ x: 0, y: 0 });
  });
  it('zoomAt keeps the focal point fixed', () => {
    const r = zoomAt({ zoom: 1, pan: { x: 0, y: 0 } }, 2, { x: 300, y: 200 }, size);
    expect(r.zoom).toBe(2);
    // local point under (300,200) before = (300,200); after = (300+... ) => t + 2*local = p
    expect(r.pan.x + 2 * 300).toBeCloseTo(300);
    expect(r.pan.y + 2 * 200).toBeCloseTo(200);
  });
  it('zoomAt clamps zoom to 1..3 and resets pan at 1', () => {
    expect(zoomAt({ zoom: 1, pan: { x: 0, y: 0 } }, 9, { x: 0, y: 0 }, size).zoom).toBe(3);
    expect(zoomAt({ zoom: 2, pan: { x: -100, y: -100 } }, 0.2, { x: 0, y: 0 }, size)).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  });
  it('formatZoom', () => {
    expect(formatZoom(2)).toBe('2×');
    expect(formatZoom(1.5)).toBe('1,5×');
  });
});

describe('paddedViewBox', () => {
  it('keeps the page aspect ratio and centres the content', () => {
    const vb = paddedViewBox({ x: 100, y: 200, width: 100, height: 200 });
    expect(vb.width / vb.height).toBeCloseTo(PAGE_ASPECT);
    expect(vb.x + vb.width / 2).toBeCloseTo(150);
    expect(vb.y + vb.height / 2).toBeCloseTo(300);
    expect(vb.width).toBeGreaterThanOrEqual(100);
    expect(vb.height).toBeGreaterThanOrEqual(200);
  });
  it('isCoverPage', () => {
    expect(isCoverPage(1)).toBe(true);
    expect(isCoverPage(2)).toBe(true);
    expect(isCoverPage(3)).toBe(false);
  });
});

describe('decideFitWidth', () => {
  it('fits width on a phone in landscape with a single page', () => {
    expect(decideFitWidth(false, 844, 390)).toBe(true);
    expect(decideFitWidth(false, 800, 360)).toBe(true);
  });
  it('keeps fit-to-height in portrait, on tablets and in spreads', () => {
    expect(decideFitWidth(false, 390, 844)).toBe(false);
    expect(decideFitWidth(false, 1024, 768)).toBe(false);
    expect(decideFitWidth(true, 900, 500)).toBe(false);
  });
});

describe('verseStateFlags', () => {
  const base = { selectedKey: null, bookmarked: new Set<string>(), focusKey: null, playingKey: null };
  it('all off by default', () => {
    expect(Object.values(verseStateFlags('2:6', base)).some(Boolean)).toBe(false);
  });
  it('playing combines with selected and bookmarked', () => {
    const f = verseStateFlags('2:6', {
      ...base,
      selectedKey: '2:6',
      bookmarked: new Set(['2:6']),
      playingKey: '2:6',
    });
    expect(f).toEqual({ 'is-selected': true, 'is-bookmarked': true, 'is-focus': false, 'is-playing': true });
  });
  it('only the matching verse is playing', () => {
    expect(verseStateFlags('2:7', { ...base, playingKey: '2:6' })['is-playing']).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { lastLine, parseRects, ribbonSide } from './verse-ribbon';

// Real paths from page 4 (Al-Baqarah 17-19); the text block is 0..341.75 wide.
const A18 = 'M 0.0 38.5 L 38.12 38.5 L 38.12 79.5 L 0.0 79.5 Z M 170.0 79.5 L 341.75 79.5 L 341.75 114.5 L 170.0 114.5 Z';
const A19 =
  'M 0.0 79.5 L 170.0 79.5 L 170.0 114.5 L 0.0 114.5 Z M 0.0 114.5 L 341.75 114.5 L 341.75 146.75 L 0.0 146.75 Z M 68.38 146.75 L 341.75 146.75 L 341.75 184.0 L 68.38 184.0 Z';

describe('verse ribbon geometry', () => {
  it('parses one rectangle per line', () => {
    expect(parseRects(A18)).toEqual([
      { x1: 0, y1: 38.5, x2: 38.12, y2: 79.5 },
      { x1: 170, y1: 79.5, x2: 341.75, y2: 114.5 },
    ]);
  });

  it('the ayah ends on its lowest line', () => {
    expect(lastLine(parseRects(A19))).toEqual({ x1: 68.38, y1: 146.75, x2: 341.75, y2: 184 });
  });

  it('picks the margin the ending is closer to', () => {
    // 2:18 ends mid-line at x=170 of 341.75, just left of the centre (170.875)
    expect(ribbonSide(lastLine(parseRects(A18))!, 0, 341.75)).toBe('left');
    // 2:19 ends at x=68 on the left part of its line
    expect(ribbonSide(lastLine(parseRects(A19))!, 0, 341.75)).toBe('left');
    expect(ribbonSide({ x1: 300, y1: 0, x2: 341.75, y2: 30 }, 0, 341.75)).toBe('right');
  });

  it('falls back to the right when the text block is unknown', () => {
    expect(ribbonSide({ x1: 10, y1: 0, x2: 20, y2: 30 }, 0, 0)).toBe('right');
  });
});

/**
 * Side ribbons for verse bookmarks: a small translucent tab in the page margin, level with
 * the line where the bookmarked ayah ends, on the side that ending is closer to.
 *
 * Ayah polygons in the page SVG are unions of per-line rectangles
 * ("M x1 y1 L x2 y1 L x2 y2 L x1 y2 Z ..."). Text runs right to left, so the ayah ends at
 * the left edge of its lowest rectangle.
 */
export interface LineRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type RibbonSide = 'left' | 'right';

/** Rectangles of an ayah polygon path, in SVG user units. */
export function parseRects(d: string): LineRect[] {
  const out: LineRect[] = [];
  for (const part of d.split(/Z/i)) {
    const nums = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 8) continue;
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    out.push({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
  }
  return out;
}

/** The line where the ayah ends: its lowest rectangle. */
export function lastLine(rects: readonly LineRect[]): LineRect | null {
  let last: LineRect | null = null;
  for (const r of rects) if (!last || r.y1 > last.y1 + 0.5) last = r;
  return last;
}

/**
 * Margin to put the ribbon in: the ayah ends at `line.x1`; whichever edge of the text
 * block [minX, maxX] it is closer to wins, and a tie or unknown block goes right.
 */
export function ribbonSide(line: LineRect, minX: number, maxX: number): RibbonSide {
  if (!(maxX > minX)) return 'right';
  return line.x1 - minX < maxX - line.x1 ? 'left' : 'right';
}

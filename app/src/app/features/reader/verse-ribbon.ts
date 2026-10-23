/**
 * Side ribbon for verse bookmarks: a tab on the right page edge, level with the line where
 * the last bookmarked ayah on the page ends.
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

/** Rectangles of an ayah polygon path, in SVG user units. */
export function parseRects(d: string): LineRect[] {
  const out: LineRect[] = [];
  for (const part of d.split(/Z/i)) {
    const nums = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 8) continue;
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    out.push({
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
    });
  }
  return out;
}

/** The line where the ayah ends: its lowest rectangle. */
export function lastLine(rects: readonly LineRect[]): LineRect | null {
  let last: LineRect | null = null;
  for (const r of rects) if (!last || r.y1 > last.y1 + 0.5) last = r;
  return last;
}

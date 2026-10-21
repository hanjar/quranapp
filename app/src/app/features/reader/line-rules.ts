import { HeaderBand, collectPolyBoxes, inkProfile } from './surah-header';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_H = 550;
const LINES = 15;
/** Distance (viewBox units) within which a rule counts as touching a surah-header frame. */
const HEADER_CLEARANCE = 6;

/** Search radius (viewBox units) around the grid position for the real inter-line gap. */
const GAP_SEARCH = 10;
/** Rows within this many ink pixels of the window minimum count as equally empty. */
const INK_SLACK = 2;
/** Horizontal inset of each rule from the text block edges. */
const STROKE_INSET = 2.5;

/**
 * Centre of the emptiest run of rows within `radius` of `center`. `ink[y]` = ink pixels on row y.
 * Rows within INK_SLACK of the window minimum form runs; among runs the one whose centre is
 * closest to `center` wins. Returns `center` when `ink` doesn't cover the window.
 */
export function findGapY(ink: ArrayLike<number>, center: number, radius = GAP_SEARCH): number {
  const lo = Math.max(0, Math.round(center - radius));
  const hi = Math.min(ink.length - 1, Math.round(center + radius));
  if (hi < lo) return center;
  let min = Infinity;
  for (let y = lo; y <= hi; y++) min = Math.min(min, ink[y]);
  let best = center;
  let bestDist = Infinity;
  let runStart = -1;
  for (let y = lo; y <= hi + 1; y++) {
    const quiet = y <= hi && ink[y] <= min + INK_SLACK;
    if (quiet && runStart < 0) runStart = y;
    if (!quiet && runStart >= 0) {
      const mid = (runStart + y) / 2; // row y covers [y, y+1)
      const d = Math.abs(mid - center);
      if (d < bestDist) {
        bestDist = d;
        best = mid;
      }
      runStart = -1;
    }
  }
  return best;
}

/**
 * Y positions of the separators between the 15 text lines: grid positions, moved into the
 * actual gap when an ink profile is available. Rules near surah-header frames are skipped.
 */
export function ruleYs(bands: readonly HeaderBand[] = [], ink: ArrayLike<number> | null = null): number[] {
  const out: number[] = [];
  for (let k = 1; k < LINES; k++) {
    const grid = (k * VIEW_H) / LINES;
    const touches = bands.some(
      (b) => grid >= b.y - HEADER_CLEARANCE && grid <= b.y + b.height + HEADER_CLEARANCE,
    );
    if (touches) continue;
    const y = ink ? findGapY(ink, grid) : grid;
    out.push(Math.round(y * 100) / 100);
  }
  return out;
}

/**
 * Inserts a `g.mf-line-rules` layer with thin separators behind the text (before the first text
 * group). Always built; CSS shows it only for `html[data-line-rules='on']`. Idempotent.
 */
export function decorateLineRules(svg: SVGSVGElement, bands: readonly HeaderBand[] = []): void {
  svg.querySelectorAll('.mf-line-rules').forEach((n) => n.remove());
  const polys = collectPolyBoxes(svg);
  if (polys.length === 0) return;
  const x1 = Math.min(...polys.map((p) => p.minX)) + STROKE_INSET;
  const x2 = Math.max(...polys.map((p) => p.maxX)) - STROKE_INSET;
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'mf-line-rules');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('pointer-events', 'none');
  for (const y of ruleYs(bands, inkProfile(svg))) {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', String(Math.round(x1 * 100) / 100));
    l.setAttribute('x2', String(Math.round(x2 * 100) / 100));
    l.setAttribute('y1', String(y));
    l.setAttribute('y2', String(y));
    layer.appendChild(l);
  }
  let anchor: Node | null = svg.querySelector('#content');
  while (anchor && anchor.parentNode !== svg) anchor = anchor.parentNode;
  svg.insertBefore(layer, anchor ?? svg.firstChild);
}

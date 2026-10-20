import { HeaderBand, collectPolyBoxes } from './surah-header';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_H = 550;
const LINES = 15;
/** Distance (viewBox units) within which a rule counts as touching a surah-header frame. */
const HEADER_CLEARANCE = 6;

/** Y positions of the separators between the 15 evenly spaced text lines. */
export function ruleYs(bands: readonly HeaderBand[] = []): number[] {
  const out: number[] = [];
  for (let k = 1; k < LINES; k++) {
    const y = (k * VIEW_H) / LINES;
    const touches = bands.some((b) => y >= b.y - HEADER_CLEARANCE && y <= b.y + b.height + HEADER_CLEARANCE);
    if (!touches) out.push(Math.round(y * 100) / 100);
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
  const x1 = Math.min(...polys.map((p) => p.minX));
  const x2 = Math.max(...polys.map((p) => p.maxX));
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'mf-line-rules');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('pointer-events', 'none');
  for (const y of ruleYs(bands)) {
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

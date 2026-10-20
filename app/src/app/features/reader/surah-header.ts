/**
 * Decorative surah-header frame (cartouche). Pure geometry plus a small DOM
 * inserter. The artwork is our own; no Quran glyphs are drawn or altered.
 *
 * Detection: in the page SVG, text lines are not separate elements but every
 * verse has a polygon in root coordinates. The first ayah of a surah starts a
 * line; the uncovered band between the previous polygon's bottom (or the page
 * top) and that polygon is the header line, plus the basmalah line for every
 * surah except 9 (At-Taubah). Surah 1 is skipped (page 1 has its own layout).
 */

export interface PolyBox {
  surah: number;
  ayah: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface HeaderBand {
  surah: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Smallest sensible line height (units of the 345x550 viewBox). */
const MIN_LINE = 24;
const NO_BASMALAH_SURAH = 9;

/** Bounding box of an absolute `M/L/Z` path (the format used by ayahPolygon). */
export function pathBox(d: string): Omit<PolyBox, 'surah' | 'ayah'> | null {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 4) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/** Header bands (one per surah that starts on the page), top to bottom. */
export function computeHeaderBands(polys: readonly PolyBox[]): HeaderBand[] {
  if (polys.length === 0) return [];
  const textLeft = Math.min(...polys.map((p) => p.minX));
  const textRight = Math.max(...polys.map((p) => p.maxX));
  const out: HeaderBand[] = [];
  for (const start of polys.filter((p) => p.ayah === 1 && p.surah !== 1)) {
    const y0 = start.minY;
    const top = polys.reduce((m, p) => (p.maxY <= y0 + 1 ? Math.max(m, p.maxY) : m), 0);
    const lines = start.surah === NO_BASMALAH_SURAH ? 1 : 2;
    const gap = y0 - top;
    if (gap < MIN_LINE * lines * 0.8) continue;
    out.push({
      surah: start.surah,
      x: textLeft,
      y: top,
      width: textRight - textLeft,
      height: gap / lines,
    });
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Reads polygon boxes from a page SVG. */
export function collectPolyBoxes(svg: SVGSVGElement): PolyBox[] {
  const out: PolyBox[] = [];
  svg.querySelectorAll('.ayahPolygon').forEach((el) => {
    const surah = Number(el.getAttribute('surah'));
    const ayah = Number(el.getAttribute('ayah'));
    const box = pathBox(el.getAttribute('d') ?? '');
    if (box && Number.isInteger(surah) && Number.isInteger(ayah)) out.push({ surah, ayah, ...box });
  });
  return out;
}

const f = (n: number) => Math.round(n * 100) / 100;

/** Outline of a cartouche with ogee-pointed ends inside [x,x+w] x [y,y+h]. */
export function cartouchePath(x: number, y: number, w: number, h: number, inset = 0): string {
  const l = x + inset;
  const r = x + w - inset;
  const t = y + inset;
  const b = y + h - inset;
  const m = y + h / 2;
  const e = Math.min(h * 0.62, w / 4) - inset * 0.6; // end cap depth
  return [
    `M${f(l + e)} ${f(t)}`,
    `H${f(r - e)}`,
    `C${f(r - e * 0.35)} ${f(t)} ${f(r - e * 0.25)} ${f(m - h * 0.12)} ${f(r)} ${f(m)}`,
    `C${f(r - e * 0.25)} ${f(m + h * 0.12)} ${f(r - e * 0.35)} ${f(b)} ${f(r - e)} ${f(b)}`,
    `H${f(l + e)}`,
    `C${f(l + e * 0.35)} ${f(b)} ${f(l + e * 0.25)} ${f(m + h * 0.12)} ${f(l)} ${f(m)}`,
    `C${f(l + e * 0.25)} ${f(m - h * 0.12)} ${f(l + e * 0.35)} ${f(t)} ${f(l + e)} ${f(t)}`,
    'Z',
  ].join('');
}

function el(name: string, attrs: Record<string, string | number>, cls?: string): SVGElement {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (cls) n.setAttribute('class', cls);
  return n;
}

function rosette(cx: number, cy: number, r: number): SVGElement {
  const g = el('g', {}, 'mf-surah-rosette');
  g.appendChild(el('circle', { cx: f(cx), cy: f(cy), r: f(r) }, 'mf-sh-line'));
  const petals = 8;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * 360;
    g.appendChild(
      el(
        'ellipse',
        { cx: f(cx), cy: f(cy - r * 0.52), rx: f(r * 0.2), ry: f(r * 0.34), transform: `rotate(${a} ${f(cx)} ${f(cy)})` },
        'mf-sh-line',
      ),
    );
  }
  g.appendChild(el('circle', { cx: f(cx), cy: f(cy), r: f(r * 0.17) }, 'mf-sh-dot'));
  return g;
}

/** Builds the decorative group for one header band. */
export function buildCartouche(band: HeaderBand): SVGGElement {
  const pad = Math.max(2, band.height * 0.08);
  const x = band.x + 1;
  const y = band.y + pad;
  const w = band.width - 2;
  const h = band.height - pad * 2;
  const g = el('g', { 'data-surah': band.surah }, 'mf-surah-header') as SVGGElement;
  g.setAttribute('aria-hidden', 'true');
  g.setAttribute('pointer-events', 'none');
  g.appendChild(el('path', { d: cartouchePath(x, y, w, h) }, 'mf-sh-fill'));
  g.appendChild(el('path', { d: cartouchePath(x, y, w, h) }, 'mf-sh-outer'));
  g.appendChild(el('path', { d: cartouchePath(x, y, w, h, h * 0.1) }, 'mf-sh-inner'));
  const r = h * 0.3;
  const cy = y + h / 2;
  const cxOff = Math.min(h * 0.62, w / 4) * 0.62 + h * 0.08;
  g.appendChild(rosette(x + cxOff, cy, r));
  g.appendChild(rosette(x + w - cxOff, cy, r));
  return g;
}

/**
 * Inserts cartouches behind the text (before `g#content`). Idempotent.
 * Returns the bands that were drawn.
 */
export function decorateSurahHeaders(svg: SVGSVGElement): HeaderBand[] {
  svg.querySelectorAll('.mf-surah-header').forEach((n) => n.remove());
  const bands = computeHeaderBands(collectPolyBoxes(svg));
  if (bands.length === 0) return bands;
  const content = svg.querySelector('#content');
  // Text lives in transformed groups; polygons are in root coords, so the
  // cartouches go in a root-level group placed before the first text group.
  let anchor: Node | null = content;
  while (anchor && anchor.parentNode !== svg) anchor = anchor.parentNode;
  const layer = el('g', {}, 'mf-surah-headers');
  for (const b of bands) layer.appendChild(buildCartouche(b));
  svg.insertBefore(layer, anchor ?? svg.firstChild);
  return bands;
}

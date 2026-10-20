import { LayoutMode, PAGE_COUNT, isValidPage } from '../../core/models';

/** Pure helpers for the reader shell (no Angular, unit-tested). */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const DOUBLE_TAP_ZOOM = 2;
export const ZOOM_STEP = 0.5;
/** Width / height of the page artwork box (viewBox 345 x 550). */
export const PAGE_ASPECT = 345 / 550;

/** Parses the `:page` route param. Returns null when it is not a page 1-604. */
export function parsePageParam(raw: unknown): number | null {
  if (typeof raw === 'number') return isValidPage(raw) ? raw : null;
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return isValidPage(n) ? n : null;
}

/** Decides whether to show two pages, per the brief's layout rule. */
export function decideSpread(mode: LayoutMode, width: number, height: number): boolean {
  if (mode === 'single') return false;
  if (mode === 'spread') return width >= 700;
  return width > height && width >= 900;
}

/** First page of the [odd, odd+1] pair that contains `page`. */
export function spreadStart(page: number): number {
  return page % 2 === 0 ? page - 1 : page;
}

/** Pages visible for a current page. Spread pairs are [odd, odd+1] (1-2 ... 603-604). */
export function visiblePagesFor(page: number, spread: boolean): number[] {
  if (!spread) return [page];
  const start = spreadStart(page);
  return [start, start + 1];
}

/** Page to navigate to for "next" (higher number); null at the end. */
export function nextTarget(visible: readonly number[], spread: boolean): number | null {
  const last = visible[visible.length - 1];
  const t = last + 1;
  if (t > PAGE_COUNT) return null;
  return spread ? spreadStart(t) : t;
}

/** Page to navigate to for "prev"; null at the beginning. */
export function prevTarget(visible: readonly number[], spread: boolean): number | null {
  const t = visible[0] - 1;
  if (t < 1) return null;
  return spread ? spreadStart(t) : t;
}

/** Pages to prefetch around the visible pages, excluding visible ones. */
export function prefetchPages(visible: readonly number[], radius: number): number[] {
  const first = visible[0];
  const last = visible[visible.length - 1];
  const out: number[] = [];
  for (let i = 1; i <= radius; i++) {
    if (last + i <= PAGE_COUNT) out.push(last + i);
    if (first - i >= 1) out.push(first - i);
  }
  return out;
}

export function verseKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

// ---------------------------------------------------------------------------
// Zoom / pan maths. Transform = translate(tx,ty) scale(z), origin top-left of
// the stage, so a screen point s maps to local (s - t) / z.
// ---------------------------------------------------------------------------
export interface Size {
  width: number;
  height: number;
}
export interface Pan {
  x: number;
  y: number;
}

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function clampPan(pan: Pan, zoom: number, size: Size): Pan {
  if (zoom <= 1) return { x: 0, y: 0 };
  const minX = size.width * (1 - zoom);
  const minY = size.height * (1 - zoom);
  return {
    x: Math.max(minX, Math.min(0, pan.x)),
    y: Math.max(minY, Math.min(0, pan.y)),
  };
}

/** New zoom/pan so that stage point `p` stays fixed while zooming to `target`. */
export function zoomAt(
  state: { zoom: number; pan: Pan },
  target: number,
  p: Pan,
  size: Size,
): { zoom: number; pan: Pan } {
  const zoom = clampZoom(target);
  if (zoom <= 1) return { zoom: 1, pan: { x: 0, y: 0 } };
  const ratio = zoom / state.zoom;
  const pan = clampPan(
    { x: p.x - ratio * (p.x - state.pan.x), y: p.y - ratio * (p.y - state.pan.y) },
    zoom,
    size,
  );
  return { zoom, pan };
}

export function formatZoom(z: number): string {
  return `${Number.isInteger(z) ? z : z.toFixed(1).replace('.', ',')}×`;
}

// ---------------------------------------------------------------------------
// Page SVG fit
// ---------------------------------------------------------------------------
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ViewBox that frames `bbox` with `padRatio` padding while keeping the page aspect
 * ratio (so pages 1-2 fill the frame instead of ~1/3 of the box).
 */
export function paddedViewBox(bbox: BBox, padRatio = 0.04, aspect = PAGE_ASPECT): BBox {
  let w = bbox.width * (1 + padRatio * 2);
  let h = bbox.height * (1 + padRatio * 2);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return {
    x: bbox.x + bbox.width / 2 - w / 2,
    y: bbox.y + bbox.height / 2 - h / 2,
    width: w,
    height: h,
  };
}

export function isCoverPage(page: number): boolean {
  return page === 1 || page === 2;
}

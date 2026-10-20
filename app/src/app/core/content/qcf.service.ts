import { Injectable } from '@angular/core';
import {
  QcfLayout,
  QcfMetrics,
  computeMetrics,
  isQcfLayout,
  paletteCss,
  qcfFamily,
  qcfFontUrl,
} from '../../features/reader/qcf-logic';
import { editionBase } from './page-cache';

export interface QcfPageData {
  layout: QcfLayout;
  family: string;
  metrics: QcfMetrics;
}

const MAX_KEPT = 24;
/** Reference size for canvas measurements. */
const REF_PX = 200;

/**
 * Loads the QCF V4 layout JSON (our own content) and the per-page COLR font (Quran Foundation CDN,
 * NOT bundled). Fonts are registered through FontFace once per page and kept for the session; the
 * service worker caches the font files on use (ngsw data group "qcf-fonts").
 */
@Injectable({ providedIn: 'root' })
export class QcfService {
  private readonly pages = new Map<number, Promise<QcfPageData>>();
  private readonly sheet: CSSStyleSheet | null = makeSheet();
  private readonly fonts = new Set<string>();

  /** Layout + font for a page; rejects when either is unavailable. */
  load(page: number): Promise<QcfPageData> {
    let p = this.pages.get(page);
    if (!p) {
      p = this.fetchPage(page);
      this.pages.set(page, p);
      p.catch(() => this.pages.delete(page)); // retry next time
      this.trim(page);
    }
    return p;
  }

  /** Warm the cache for neighbours; failures are ignored. */
  prefetch(pages: readonly number[]): void {
    for (const pg of pages) if (pg >= 1 && pg <= 604) this.load(pg).catch(() => undefined);
  }

  private trim(keep: number): void {
    if (this.pages.size <= MAX_KEPT) return;
    for (const k of this.pages.keys()) {
      if (this.pages.size <= MAX_KEPT) break;
      if (Math.abs(k - keep) > 3) this.pages.delete(k);
    }
  }

  private async fetchPage(page: number): Promise<QcfPageData> {
    const [layout, family] = await Promise.all([this.fetchLayout(page), this.loadFont(page)]);
    return { layout, family, metrics: measure(layout, family) };
  }

  private async fetchLayout(page: number): Promise<QcfLayout> {
    const res = await fetch(`${editionBase()}/qcf/${page}.json`);
    if (!res.ok) throw new Error(`qcf layout ${res.status}`);
    const json: unknown = await res.json();
    if (!isQcfLayout(json, page)) throw new Error('qcf layout malformed');
    return json;
  }

  private async loadFont(page: number): Promise<string> {
    const family = qcfFamily(page);
    if (typeof FontFace === 'undefined' || typeof document === 'undefined')
      throw new Error('FontFace unsupported');
    if (this.fonts.has(family)) return family;
    const face = new FontFace(family, `url(${qcfFontUrl(page)}) format("woff2")`, {
      display: 'block',
    });
    await face.load();
    document.fonts.add(face);
    this.fonts.add(family);
    this.addPalettes(family);
    return family;
  }

  private addPalettes(family: string): void {
    const sheet = this.sheet;
    if (!sheet) return;
    try {
      for (const rule of paletteCss(family).split('\n'))
        sheet.insertRule(rule, sheet.cssRules.length);
    } catch {
      /* @font-palette-values unsupported: default palette is fine */
    }
  }
}

function makeSheet(): CSSStyleSheet | null {
  try {
    if (typeof document === 'undefined' || typeof CSSStyleSheet === 'undefined') return null;
    const s = new CSSStyleSheet();
    if (!('adoptedStyleSheets' in document)) return null;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
    return s;
  } catch {
    return null;
  }
}

/** Natural width (em) of every text line, measured with the loaded font. */
function measure(layout: QcfLayout, family: string): QcfMetrics {
  const lineEm: Record<number, number> = {};
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx) {
    ctx.font = `${REF_PX}px "${family}"`;
    for (const l of layout.lines) {
      if (l.type !== 'text') continue;
      const text = (l.words ?? []).map((w) => w.code).join('');
      const w = ctx.measureText(text).width / REF_PX;
      if (w > 0) lineEm[l.n] = w;
    }
  }
  return computeMetrics(lineEm);
}

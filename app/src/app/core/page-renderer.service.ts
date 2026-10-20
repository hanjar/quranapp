import { Injectable, computed, inject, signal } from '@angular/core';
import { ReaderUiService } from './reader-ui.service';

/** Identifier of a mushaf page style. Add new styles here + in MUSHAF_STYLES (and render them in PageView). */
export type PageRendererId = 'classic' | 'qcf-tajweed';

export interface MushafStyle {
  id: PageRendererId;
  label: string;
  /** Short name used in toasts. */
  shortLabel: string;
  description: string;
  experimental: boolean;
  /** Fonts/layout come from a third-party CDN at runtime. */
  needsNetwork: boolean;
  /** Key of the small preview drawing in the settings card. */
  thumb: 'classic' | 'tajweed';
}

export const MUSHAF_STYLES: readonly MushafStyle[] = [
  {
    id: 'classic',
    label: 'Klasik',
    shortLabel: 'Klasik',
    description: 'Halaman Mushaf Madinah bergambar (SVG), tersimpan penuh untuk offline.',
    experimental: false,
    needsNetwork: false,
    thumb: 'classic',
  },
  {
    id: 'qcf-tajweed',
    label: 'Tajwid berwarna',
    shortLabel: 'Tajwid berwarna',
    description:
      'Huruf Mushaf Madinah (QCF V4) dengan warna hukum tajwid. Font dimuat dari internet saat dibaca.',
    experimental: true,
    needsNetwork: true,
    thumb: 'tajweed',
  },
];

export const RENDERER_KEY = 'mf-page-renderer';

export function isRendererId(v: unknown): v is PageRendererId {
  return MUSHAF_STYLES.some((s) => s.id === v);
}

/**
 * Which renderer draws mushaf pages. Per device (localStorage), never synced.
 * If the chosen style cannot be loaded, `failed` makes the pages fall back to the classic SVG
 * (one toast per session) until the user picks a style again.
 */
@Injectable({ providedIn: 'root' })
export class PageRendererService {
  private readonly ui = inject(ReaderUiService);
  readonly style = signal<PageRendererId>(read());
  readonly failed = signal(false);
  private warned = false;

  /** What pages actually use right now (honours the fallback). */
  readonly effective = computed<PageRendererId>(() => (this.failed() ? 'classic' : this.style()));

  readonly current = computed(
    () => MUSHAF_STYLES.find((s) => s.id === this.style()) ?? MUSHAF_STYLES[0],
  );

  set(id: PageRendererId): void {
    this.style.set(id);
    this.failed.set(false);
    this.warned = false;
    try {
      if (id === 'classic') localStorage.removeItem(RENDERER_KEY);
      else localStorage.setItem(RENDERER_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }

  /** A style could not be loaded: fall back to classic and tell the reader once. */
  reportFailure(): void {
    this.failed.set(true);
    if (this.warned) return;
    this.warned = true;
    this.ui.showToast({
      message: 'Tampilan tajwid berwarna tidak dapat dimuat. Memakai tampilan klasik.',
      duration: 6000,
    });
  }
}

function read(): PageRendererId {
  try {
    const v = localStorage.getItem(RENDERER_KEY);
    return isRendererId(v) ? v : 'classic';
  } catch {
    return 'classic';
  }
}

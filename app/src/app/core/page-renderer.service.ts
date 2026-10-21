import { Injectable, computed, inject, signal } from '@angular/core';
import { UserDataApi } from './contracts';
import { PAGE_RENDERER_IDS, PageRendererId } from './models';
import { ReaderUiService } from './reader-ui.service';

export type { PageRendererId };

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

export function isRendererId(v: unknown): v is PageRendererId {
  return PAGE_RENDERER_IDS.includes(v as PageRendererId);
}

/**
 * Which renderer draws mushaf pages. A synced preference (`prefs.pageRenderer`).
 * If the chosen style cannot be loaded, `failed` makes the pages fall back to the classic SVG
 * (one toast per session) until the user picks a style again.
 */
@Injectable({ providedIn: 'root' })
export class PageRendererService {
  private readonly ui = inject(ReaderUiService);
  private readonly data = inject(UserDataApi);
  readonly style = computed<PageRendererId>(() => this.data.prefs().pageRenderer);
  readonly failed = signal(false);
  private warned = false;

  /** What pages actually use right now (honours the fallback). */
  readonly effective = computed<PageRendererId>(() => (this.failed() ? 'classic' : this.style()));

  readonly current = computed(
    () => MUSHAF_STYLES.find((s) => s.id === this.style()) ?? MUSHAF_STYLES[0],
  );

  set(id: PageRendererId): void {
    this.failed.set(false);
    this.warned = false;
    void this.data.setPrefs({ pageRenderer: id });
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

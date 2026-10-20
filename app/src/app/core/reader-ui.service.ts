import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AyahRef, PAGE_COUNT } from './models';

export type SheetName =
  'verse' | 'browse' | 'bookmarks' | 'search' | 'settings' | 'offline' | 'account' | 'about' | 'feedback';

export type BrowseTab = 'surah' | 'juz' | 'page';

export interface SelectedVerse extends AyahRef {
  page: number;
}

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
  /** ms, default 5000 */
  duration?: number;
}

/**
 * Cross-feature UI state for the reader. The URL (/hal/:page) is the source of
 * truth for the current page; everything else lives here as signals.
 * Owned by the orchestrator — features read/write through this API only.
 */
@Injectable({ providedIn: 'root' })
export class ReaderUiService {
  private readonly router = inject(Router);
  private toastSeq = 0;

  /** Set by the reader shell from the route param. */
  readonly currentPage = signal(1);
  /** Pages currently visible (1 or 2), set by the reader shell. */
  readonly visiblePages = signal<number[]>([1]);
  readonly chromeVisible = signal(false);
  readonly selectedVerse = signal<SelectedVerse | null>(null);
  readonly sheet = signal<SheetName | null>(null);
  readonly browseTab = signal<BrowseTab>('surah');
  readonly tourOpen = signal(false);
  /** data-search-id of a row the opened sheet should scroll to, focus and highlight (universal search). */
  readonly focusTarget = signal<string | null>(null);
  readonly zoom = signal(1);
  readonly toast = signal<Toast | null>(null);

  readonly sheetOpen = computed(() => this.sheet() !== null);
  /** Gestures on the page must be ignored while a modal surface is open. */
  readonly gesturesBlocked = computed(
    () => this.tourOpen() || (this.sheet() !== null && this.sheet() !== 'verse'),
  );

  goToPage(page: number, opts: { highlight?: AyahRef | null; replaceUrl?: boolean } = {}): void {
    const p = Math.max(1, Math.min(PAGE_COUNT, Math.trunc(page)));
    this.selectedVerse.set(opts.highlight ? { ...opts.highlight, page: p } : null);
    this.zoom.set(1);
    void this.router.navigate(['/hal', p], { replaceUrl: opts.replaceUrl ?? false });
  }

  openSheet(name: SheetName, opts: { browseTab?: BrowseTab } = {}): void {
    if (opts.browseTab) this.browseTab.set(opts.browseTab);
    this.sheet.set(name);
  }

  closeSheet(): void {
    this.sheet.set(null);
    this.selectedVerse.set(null);
  }

  selectVerse(v: SelectedVerse): void {
    this.selectedVerse.set(v);
    this.sheet.set('verse');
  }

  showToast(t: Omit<Toast, 'id'>): void {
    const id = ++this.toastSeq;
    this.toast.set({ ...t, id });
    setTimeout(() => {
      if (this.toast()?.id === id) this.toast.set(null);
    }, t.duration ?? 5000);
  }

  dismissToast(): void {
    this.toast.set(null);
  }
}

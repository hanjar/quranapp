import { Injectable, inject, signal } from '@angular/core';
import { UserDataApi } from './contracts';
import { AyahRef, DEFAULT_EDITION, bookmarkKey } from './models';
import { ReaderUiService } from './reader-ui.service';
import { recordStorageError } from './storage/storage-diagnostics';
import { StorageUnavailableError } from './storage/user-data.service';

/** The write is still running after this long: say so (it is not a failure). */
export const SLOW_SAVE_NOTICE_MS = 2000;
/** Beyond this the tap guard is released and the UI follows the stored state again. */
export const SAVE_GIVE_UP_MS = 30_000;
export const OUTDATED_TOAST = 'Versi baru terbuka di tab lain · Muat ulang';

interface Labels {
  added: string;
  removed: string;
}

/**
 * Bookmark toggles with honest feedback. The icon flips at once (optimistic overlay),
 * the write continues in the background, and a slow write is never reported as a failure:
 * only a real error reverts the icon and shows a specific message.
 */
@Injectable({ providedIn: 'root' })
export class BookmarkToggleService {
  private readonly userData = inject(UserDataApi);
  private readonly ui = inject(ReaderUiService);
  /** key -> desired state while a toggle is in flight. */
  private readonly overlay = signal<ReadonlyMap<string, boolean>>(new Map());

  isVerseBookmarked(ref: AyahRef): boolean {
    return this.view(bookmarkKey(DEFAULT_EDITION, 'verse', ref), () => this.userData.isVerseBookmarked(ref));
  }

  isPageBookmarked(page: number): boolean {
    return this.view(bookmarkKey(DEFAULT_EDITION, 'page', { page }), () => this.userData.isPageBookmarked(page));
  }

  isFavorite(ref: AyahRef): boolean {
    return this.view(bookmarkKey(DEFAULT_EDITION, 'favorite', ref), () => this.userData.isFavorite(ref));
  }

  toggleFavorite(ref: AyahRef, page: number): Promise<void> {
    const key = bookmarkKey(DEFAULT_EDITION, 'favorite', ref);
    return this.run(
      key,
      () => this.userData.isFavorite(ref),
      () => this.userData.toggleFavorite(ref, page),
      { added: 'Ditambahkan ke favorit', removed: 'Dihapus dari favorit' },
      () => this.toggleFavorite(ref, page),
    );
  }

  toggleVerse(ref: AyahRef, page: number): Promise<void> {
    const key = bookmarkKey(DEFAULT_EDITION, 'verse', ref);
    return this.run(
      key,
      () => this.userData.isVerseBookmarked(ref),
      () => this.userData.toggleVerseBookmark(ref, page),
      { added: 'Ayat ditandai', removed: 'Penanda dihapus' },
      () => this.toggleVerse(ref, page),
    );
  }

  togglePage(page: number): Promise<void> {
    const key = bookmarkKey(DEFAULT_EDITION, 'page', { page });
    return this.run(
      key,
      () => this.userData.isPageBookmarked(page),
      () => this.userData.togglePageBookmark(page),
      { added: `Halaman ${page} ditandai`, removed: 'Penanda halaman dihapus' },
      () => this.togglePage(page),
    );
  }

  private view(key: string, stored: () => boolean): boolean {
    const o = this.overlay().get(key);
    return o ?? stored();
  }

  private setOverlay(key: string, v: boolean | null): void {
    const next = new Map(this.overlay());
    if (v === null) next.delete(key);
    else next.set(key, v);
    this.overlay.set(next);
  }

  private async run(
    key: string,
    stored: () => boolean,
    write: () => Promise<'added' | 'removed'>,
    labels: Labels,
    again: () => Promise<void>,
  ): Promise<void> {
    if (this.overlay().has(key)) return; // double tap while in flight
    this.setOverlay(key, !stored());
    let slow: ReturnType<typeof setTimeout> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = write();
      slow = setTimeout(() => {
        this.ui.showToast({ message: 'Menyimpan…', duration: SAVE_GIVE_UP_MS });
      }, SLOW_SAVE_NOTICE_MS);
      giveUp = setTimeout(() => this.setOverlay(key, null), SAVE_GIVE_UP_MS);
      const result = await pending;
      this.ui.showToast({
        message: result === 'added' ? labels.added : labels.removed,
        actionLabel: 'Urungkan',
        action: () => void again(),
      });
    } catch (e) {
      console.error('[bookmark] toggle failed', e);
      recordStorageError('bookmark-toggle-ui', e);
      this.ui.showToast(this.errorToast(e, again));
    } finally {
      clearTimeout(slow);
      clearTimeout(giveUp);
      this.setOverlay(key, null);
    }
  }

  private errorToast(e: unknown, again: () => Promise<void>) {
    if (e instanceof StorageUnavailableError) {
      return e.kind === 'outdated'
        ? {
            message: OUTDATED_TOAST,
            actionLabel: 'Muat ulang',
            action: () => location.reload(),
            duration: 15000,
          }
        : { message: e.message, actionLabel: 'Muat ulang', action: () => location.reload(), duration: 15000 };
    }
    const name = e instanceof Error && e.name ? e.name : 'Error';
    return {
      message: `Penanda gagal disimpan (${name}). Coba lagi.`,
      actionLabel: 'Coba lagi',
      action: () => void again(),
      duration: 8000,
    };
  }
}

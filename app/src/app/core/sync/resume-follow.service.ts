import { Injectable, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SyncApi } from '../contracts';
import { ReaderUiService } from '../reader-ui.service';

/** How long after signing in a received position is offered (the first sync can be slow). */
const LOGIN_WINDOW_MS = 3 * 60_000;

/**
 * "Open where I last read, on any device." Sync brings a newer reading position from another
 * device (on launch, on returning to the app, or every 45 s while open). If the reader has not
 * turned a page here since the app was opened or brought back, it follows that position and offers
 * a way back; while someone is reading here it only offers to jump.
 * A launch-time difference used to become a "conflict" hidden in the Account sheet; it is resolved
 * here the same way.
 */
@Injectable({ providedIn: 'root' })
export class ResumeFollowService {
  private readonly sync = inject(SyncApi);
  private readonly ui = inject(ReaderUiService);
  private readonly router = inject(Router);
  /** Page shown when the app was opened or last came back to the foreground. */
  private baseline: number | null = null;
  /** signedInAt value whose offer was already shown. */
  private offeredFor: number | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.baseline = this.ui.currentPage();
      });
    }
    effect(() => {
      const c = this.sync.conflict();
      if (c) untracked(() => this.offer(c.cloud.page, true));
    });
    effect(() => {
      const p = this.sync.remotePosition();
      if (p) untracked(() => this.offer(p.page, false));
    });
  }

  /** Call once the reader shows its first page. */
  markOpened(): void {
    this.baseline ??= this.ui.currentPage();
  }

  private offer(page: number, conflict: boolean): void {
    const inReader = this.router.url.startsWith('/hal/');
    const here = this.ui.currentPage();
    // Just signed in on this device: offer the account's last page instead of jumping.
    const signedIn = this.sync.signedInAt();
    if (signedIn !== null && signedIn !== this.offeredFor && Date.now() - signedIn < LOGIN_WINDOW_MS) {
      this.offeredFor = signedIn;
      if (conflict) void this.sync.resolveConflict('device');
      if (!this.ui.visiblePages().includes(page)) {
        this.ui.showToast({
          message: `Terakhir dibaca di akun ini: hal. ${page}`,
          actionLabel: 'Buka',
          action: () => this.ui.goToPage(page),
          duration: 12000,
        });
      }
      return;
    }
    if (!inReader || this.ui.visiblePages().includes(page)) {
      // Already there, or not reading right now: take the newer position without moving.
      if (conflict) void this.sync.resolveConflict(inReader ? 'device' : 'cloud');
      return;
    }
    const fresh = this.baseline === null || this.baseline === here;
    if (fresh) {
      this.baseline = page;
      if (conflict) void this.sync.resolveConflict('cloud');
      else this.ui.goToPage(page, { replaceUrl: true });
      this.ui.showToast({
        message: `Lanjut dari perangkat lain · hal. ${page}`,
        actionLabel: `Kembali ke hal. ${here}`,
        action: () => this.ui.goToPage(here),
        duration: 8000,
      });
      return;
    }
    // Reading here right now: keep this page (and its position), just offer the other one.
    if (conflict) void this.sync.resolveConflict('device');
    this.ui.showToast({
      message: `Perangkat lain terakhir di hal. ${page}`,
      actionLabel: 'Buka',
      action: () => this.ui.goToPage(page),
      duration: 8000,
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AyahRef } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';

/**
 * Ties the sheet to browser history so Back / Android back closes the sheet
 * first. Opening pushes a same-URL entry; Back pops it (popstate closes the
 * sheet); closing from the UI pops it with history.back().
 */
@Injectable({ providedIn: 'root' })
export class SheetHistory {
  private readonly ui = inject(ReaderUiService);
  private readonly router = inject(Router);
  private pushed = false;
  private pending: Array<() => void> = [];
  private fallback: ReturnType<typeof setTimeout> | null = null;
  /** A full-screen overlay (style preview) stacked above the sheet has its own history entry. */
  private overlayPushed = false;
  private overlayBack: (() => void) | null = null;
  private ignorePops = 0;

  constructor() {
    window.addEventListener('popstate', () => {
      if (this.ignorePops > 0) {
        // We popped the overlay entry ourselves (closed from its UI): the sheet below stays open.
        this.ignorePops--;
        return;
      }
      if (this.overlayPushed) {
        // Back button popped the overlay entry: close the overlay only, not the sheet beneath it.
        this.overlayPushed = false;
        const cb = this.overlayBack;
        this.overlayBack = null;
        cb?.();
        return;
      }
      if (this.pushed) {
        // Back button popped our entry.
        this.pushed = false;
        if (this.ui.sheet() !== null) this.ui.closeSheet();
      }
      this.flush();
    });
  }

  /** An overlay opened above the sheet; `onBack` runs when the browser Back button closes it. */
  overlayOpened(onBack: () => void): void {
    if (this.overlayPushed) return;
    history.pushState({ ...(history.state ?? {}), mfOverlay: true }, '');
    this.overlayPushed = true;
    this.overlayBack = onBack;
  }

  /** The overlay closed through its own UI: drop its history entry (the sheet stays open). */
  overlayClosed(): void {
    this.overlayBack = null;
    if (!this.overlayPushed) return;
    this.overlayPushed = false;
    this.ignorePops++;
    history.back();
  }

  /** Host: the sheet went from closed to open. */
  opened(): void {
    if (this.pushed) return;
    history.pushState({ ...(history.state ?? {}), mfSheet: true }, '');
    this.pushed = true;
  }

  /** Host: the sheet closed through some path other than close()/popstate. */
  closedExternally(): void {
    if (!this.pushed) return;
    this.pushed = false;
    history.back();
  }

  /** User-initiated close (X, scrim, Escape). */
  close(): void {
    this.closeThen();
  }

  /**
   * Closes the sheet and opens a page. The sheet's own history entry is REPLACED
   * by the target URL instead of popped: popping would make the router handle the
   * popstate and navigate back to the old page, overriding this navigation.
   * Back still returns to the page the reader was on before opening the sheet.
   */
  navigateTo(page: number, opts: { highlight?: AyahRef | null } = {}): void {
    const replaceUrl = this.pushed;
    this.pushed = false;
    this.ui.closeSheet();
    this.ui.goToPage(page, { ...opts, replaceUrl });
  }

  /** Like navigateTo, but for an arbitrary app URL (e.g. '/penanda'). */
  navigateUrl(url: string): void {
    const replaceUrl = this.pushed;
    this.pushed = false;
    this.ui.closeSheet();
    void this.router.navigateByUrl(url, { replaceUrl });
  }

  /**
   * Closes the sheet, waits for its history entry to be popped, then runs `then`.
   * Navigating first would race router.pushState against history.back().
   */
  closeThen(then?: () => void): void {
    if (then) this.pending.push(then);
    this.ui.closeSheet();
    if (this.pushed) {
      this.pushed = false;
      history.back();
      if (this.fallback) clearTimeout(this.fallback);
      this.fallback = setTimeout(() => this.flush(), 400);
    } else {
      this.flush();
    }
  }

  private flush(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
    const fns = this.pending;
    this.pending = [];
    fns.forEach((f) => f());
  }
}

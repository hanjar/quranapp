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

  constructor() {
    window.addEventListener('popstate', () => {
      if (this.pushed) {
        // Back button popped our entry.
        this.pushed = false;
        if (this.ui.sheet() !== null) this.ui.closeSheet();
      }
      this.flush();
    });
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

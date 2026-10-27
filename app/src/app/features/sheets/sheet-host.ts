import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ReaderUiService, SheetName } from '../../core/reader-ui.service';
import { AboutSheet } from './about-sheet';
import { AccountSheet } from './account-sheet';
import { BookmarksSheet } from './bookmarks-sheet';
import { BrowseSheet } from './browse-sheet';
import { FeedbackSheet } from './feedback-sheet';
import { MenuSheet } from './menu-sheet';
import { OfflineSheet } from './offline-sheet';
import { ProgressSheet } from './progress-sheet';
import { SearchSheet } from './search-sheet';
import { SettingsSheet } from './settings-sheet';
import { SheetHistory } from './sheet-history';
import { VerseSheet } from './verse-sheet';

const TITLES: Record<SheetName, string> = {
  verse: 'Ayat',
  browse: 'Daftar isi',
  bookmarks: 'Penanda',
  search: 'Cari',
  settings: 'Pengaturan',
  offline: 'Offline & unduhan',
  account: 'Akun & sinkronisasi',
  about: 'Tentang & lisensi',
  feedback: 'Kirim masukan',
  progress: 'Progres membaca',
  menu: 'Menu',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Renders the scrim + dialog container for ReaderUiService.sheet() and the
 * matching content component. Place `<app-sheet-host />` once in the root template.
 */
@Component({
  selector: 'app-sheet-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VerseSheet,
    BrowseSheet,
    BookmarksSheet,
    SearchSheet,
    SettingsSheet,
    OfflineSheet,
    AccountSheet,
    AboutSheet,
    FeedbackSheet,
    ProgressSheet,
    MenuSheet,
  ],
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  template: `
    @if (rendered()) {
      <div
        class="scrim"
        [class.on]="entered() && !isVerse()"
        aria-hidden="true"
        (click)="history.close()"
      ></div>
      <div
        #dialog
        class="sheet"
        [class.open]="entered()"
        [class.verse]="isVerse()"
        [class.full]="expanded()"
        [class.dragging]="dragY() !== null"
        [style.--mf-drag-y.px]="dragY() ?? 0"
        role="dialog"
        [attr.aria-modal]="isVerse() ? 'false' : 'true'"
        aria-labelledby="mf-sheet-title"
        [attr.inert]="entered() ? null : ''"
        (keydown)="onKeydown($event)"
      >
        <button
          type="button"
          class="grab"
          [attr.aria-label]="
            expanded() ? 'Kembalikan ukuran panel' : 'Perbesar panel ke layar penuh'
          "
          [attr.aria-expanded]="expanded()"
          (pointerdown)="dragStart($event)"
          (pointermove)="dragMove($event)"
          (pointerup)="dragEnd($event)"
          (pointercancel)="dragCancel()"
          (click)="onGrabClick($event)"
        >
          <span></span>
        </button>
        <div
          class="head"
          (pointerdown)="dragStart($event)"
          (pointermove)="dragMove($event)"
          (pointerup)="dragEnd($event)"
          (pointercancel)="dragCancel()"
        >
          <h2 #heading id="mf-sheet-title" tabindex="-1" class="mf-display">{{ title() }}</h2>
          <button type="button" class="mf-icon-btn" aria-label="Tutup" (click)="history.close()">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div
          class="body"
          (scroll)="onBodyScroll($event)"
          (touchstart)="bodyTouchStart($event)"
          (touchmove)="bodyTouchMove($event)"
        >
          @switch (shown()) {
            @case ('verse') {
              <app-verse-sheet />
            }
            @case ('browse') {
              <app-browse-sheet />
            }
            @case ('bookmarks') {
              <app-bookmarks-sheet />
            }
            @case ('search') {
              <app-search-sheet />
            }
            @case ('settings') {
              <app-settings-sheet />
            }
            @case ('offline') {
              <app-offline-sheet />
            }
            @case ('account') {
              <app-account-sheet />
            }
            @case ('about') {
              <app-about-sheet />
            }
            @case ('feedback') {
              <app-feedback-sheet />
            }
            @case ('menu') {
              <app-menu-sheet />
            }
            @case ('progress') {
              <app-progress-sheet />
            }
          }
        </div>
      </div>
    }
  `,
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: var(--mf-z-scrim);
      background: color-mix(in srgb, var(--ui-ink) 28%, transparent);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--mf-dur-base) var(--mf-ease);
    }
    .scrim.on {
      opacity: 1;
      pointer-events: auto;
    }

    .sheet {
      position: fixed;
      z-index: var(--mf-z-sheet);
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      max-height: 88%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--ui-surface);
      color: var(--ui-ink);
      border-radius: var(--mf-radius-sheet) var(--mf-radius-sheet) 0 0;
      box-shadow: 0 -8px 32px color-mix(in srgb, var(--ui-ink) 12%, transparent);
      padding-bottom: var(--mf-safe-bottom);
      padding-left: var(--mf-safe-left);
      padding-right: var(--mf-safe-right);
      transform: translateY(105%);
      transition: transform var(--mf-dur-base) var(--mf-ease);
    }
    .sheet.verse {
      max-height: 52%;
    }
    .sheet.open {
      transform: translateY(var(--mf-drag-y, 0px));
    }
    /* Pulled up to full screen (phones); the handle or a drag down restores it. */
    .sheet.full,
    .sheet.verse.full {
      max-height: 100%;
      height: 100%;
      border-radius: 0;
      padding-top: var(--mf-safe-top);
      transition:
        transform var(--mf-dur-base) var(--mf-ease),
        max-height var(--mf-dur-base) var(--mf-ease);
    }
    .sheet.dragging {
      transition: none;
    }

    .grab {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      min-height: 28px;
      padding: 10px 0 6px;
      border: none;
      background: transparent;
      flex: none;
      cursor: grab;
      touch-action: none;
    }
    .grab:focus-visible span {
      outline: 2px solid var(--ui-primary);
      outline-offset: 4px;
    }
    .head {
      touch-action: none;
    }
    .grab span {
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--ui-line);
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 8px 4px 20px;
      flex: none;
    }
    h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 500;
      outline: none;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    @media (min-width: 768px) {
      .sheet {
        left: auto;
        right: 0;
        top: 0;
        bottom: 0;
        width: 400px;
        max-height: 100%;
        border-radius: 0;
        border-left: 1px solid var(--ui-line);
        padding-top: var(--mf-safe-top);
        box-shadow: -8px 0 32px color-mix(in srgb, var(--ui-ink) 10%, transparent);
        transform: translateX(105%);
      }
      .sheet.verse {
        max-height: 100%;
      }
      .sheet.open {
        transform: translateX(0);
      }
      .grab {
        display: none;
      }
      .head {
        padding-top: 12px;
      }
    }
  `,
})
export class SheetHost implements OnDestroy {
  protected readonly ui = inject(ReaderUiService);
  protected readonly history = inject(SheetHistory);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** Last non-null sheet; keeps content mounted during the close transition. */
  protected readonly shown = signal<SheetName | null>(null);
  protected readonly rendered = signal(false);
  protected readonly entered = signal(false);
  protected readonly isVerse = computed(() => this.shown() === 'verse');
  protected readonly title = computed(() => (this.shown() ? TITLES[this.shown()!] : ''));

  /** Phone sheets can be pulled up to full screen and back. */
  protected readonly expanded = signal(false);
  /** Live downward drag offset while the handle is held (px), else null. */
  protected readonly dragY = signal<number | null>(null);
  private drag: { id: number; y0: number; moved: boolean } | null = null;
  private suppressClick = false;

  protected dragStart(e: PointerEvent): void {
    if ((e.target as Element).closest('.head button') || e.button > 0) return;
    if (window.matchMedia('(min-width: 768px)').matches) return; // side panel
    this.drag = { id: e.pointerId, y0: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  protected dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) this.dragY.set(Math.max(0, dy)); // follow the finger downwards only
  }

  protected dragEnd(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    this.dragY.set(null);
    if (!d.moved) return; // a tap: handled by click on the handle
    this.suppressClick = true;
    const dy = e.clientY - d.y0;
    if (dy < -40) this.expanded.set(true);
    else if (dy > 60) {
      if (this.expanded()) this.expanded.set(false);
      else this.history.close();
    }
  }

  protected dragCancel(): void {
    this.drag = null;
    this.dragY.set(null);
  }

  /**
   * Phone sheets: scrolling the content up (or swiping up on content that does not scroll) pulls
   * the sheet to full screen, like a map app. Swiping down while the content is at the top steps
   * it back: full screen to normal, then normal to closed (one step per gesture).
   */
  private bodyTouchY: number | null = null;
  private bodyTouchTop = false;

  private canExpand(): boolean {
    return !this.expanded() && !window.matchMedia('(min-width: 768px)').matches;
  }

  protected onBodyScroll(e: Event): void {
    if ((e.target as HTMLElement).scrollTop > 12 && this.canExpand()) this.expanded.set(true);
  }

  protected bodyTouchStart(e: TouchEvent): void {
    this.bodyTouchY = e.touches.length === 1 ? e.touches[0]!.clientY : null;
    this.bodyTouchTop = (e.currentTarget as HTMLElement).scrollTop <= 0;
  }

  protected bodyTouchMove(e: TouchEvent): void {
    if (this.bodyTouchY === null || e.touches.length !== 1) return;
    if (window.matchMedia('(min-width: 768px)').matches) return;
    const dy = e.touches[0]!.clientY - this.bodyTouchY; // > 0: finger moved down
    if (-dy > 30 && this.canExpand()) {
      this.bodyTouchY = null;
      this.expanded.set(true);
    } else if (dy > 60 && this.bodyTouchTop && (e.currentTarget as HTMLElement).scrollTop <= 0) {
      this.bodyTouchY = null;
      if (this.expanded()) this.expanded.set(false);
      else this.history.close();
    }
  }

  protected onGrabClick(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      e.preventDefault();
      return;
    }
    this.expanded.update((v) => !v);
  }

  private wasOpen = false;
  private previousFocus: HTMLElement | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const name = this.ui.sheet();
      untracked(() => this.sync(name));
    });
  }

  ngOnDestroy(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
  }

  private sync(name: SheetName | null): void {
    if (name) {
      if (this.closeTimer) clearTimeout(this.closeTimer);
      this.closeTimer = null;
      if (!this.wasOpen) {
        this.wasOpen = true;
        const active = document.activeElement;
        this.previousFocus =
          active instanceof HTMLElement && active !== document.body ? active : null;
        this.history.opened();
      }
      this.shown.set(name);
      this.rendered.set(true);
      // Two frames: first lets the closed state paint so the transition runs.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (this.ui.sheet() !== name) return;
          this.entered.set(true);
          setTimeout(() => this.heading()?.nativeElement.focus({ preventScroll: true }), 0);
        }),
      );
    } else if (this.wasOpen) {
      this.wasOpen = false;
      this.history.closedExternally();
      this.entered.set(false);
      this.expanded.set(false);
      this.dragCancel();
      const target = this.previousFocus;
      this.previousFocus = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
      this.closeTimer = setTimeout(() => {
        this.rendered.set(false);
        this.shown.set(null);
      }, this.durationMs() + 40);
    }
  }

  private durationMs(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--mf-dur-base').trim();
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return 260;
    return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n;
  }

  protected onEscape(event: Event): void {
    if (this.ui.sheet() === null) return;
    event.preventDefault();
    this.history.close();
  }

  /** Keeps Tab / Shift+Tab inside the dialog (modal sheets only). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || this.isVerse()) return;
    const root = this.dialog()?.nativeElement;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    const heading = this.heading()?.nativeElement;
    if (heading) items.unshift(heading);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}

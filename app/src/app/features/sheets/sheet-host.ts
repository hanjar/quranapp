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
import { OfflineSheet } from './offline-sheet';
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
        role="dialog"
        [attr.aria-modal]="isVerse() ? 'false' : 'true'"
        aria-labelledby="mf-sheet-title"
        [attr.inert]="entered() ? null : ''"
        (keydown)="onKeydown($event)"
      >
        <div class="grab" aria-hidden="true"><span></span></div>
        <div class="head">
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
        <div class="body">
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
      transform: translateY(0);
    }

    .grab {
      display: flex;
      justify-content: center;
      padding-top: 8px;
      flex: none;
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

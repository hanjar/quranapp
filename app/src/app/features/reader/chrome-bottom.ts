import { BookmarkToggleService } from '../../core/bookmark-toggle.service';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { AudioService } from '../../core/audio/audio.service';
import { ContentApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';

/** Press-and-hold on the bookmark button opens the bookmarks list after this long. */
export const BOOKMARK_LONG_PRESS_MS = 500;

/**
 * Bottom bar (visual order, left to right; paging keeps the RTL book semantics):
 * next | play from this page | page pill | translation/mushaf | bookmark this page | prev.
 * The contents list moved to the title in the top bar; zoom is pinch / double-tap
 * (+/- and reset appear while zoomed).
 */
@Component({
  selector: 'mf-chrome-bottom',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-hidden]': '!shown()', role: 'navigation', 'aria-label': 'Navigasi halaman' },
  template: `
    <button
      type="button"
      class="mf-icon-btn"
      aria-label="Halaman berikutnya"
      [disabled]="!canNext()"
      (click)="next.emit()"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </button>


    <button
      type="button"
      class="mf-icon-btn"
      data-testid="play-btn"
      [class.is-on]="audio.active()"
      [disabled]="!playReady()"
      [attr.aria-label]="playLabel()"
      (click)="playOrToggle()"
    >
      @if (showPause()) {
        <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="7" y="5" width="3.6" height="14" rx="1" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1" />
        </svg>
      } @else {
        <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"
          />
        </svg>
      }
    </button>

    <button
      type="button"
      class="pill"
      aria-label="Pilih halaman"
      (click)="ui.openSheet('browse', { browseTab: 'page' })"
    >
      {{ pillText() }}
    </button>

    <button
      type="button"
      class="mode-btn"
      [class.is-on]="textMode()"
      [attr.aria-pressed]="textMode()"
      aria-label="Mode terjemahan"
      (click)="toggleMode.emit()"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        @if (textMode()) {
          <path d="M4 5h16v14H4z" />
          <path d="M7 9h10M7 12.5h10M7 16h6" />
        } @else {
          <path d="M12 6c-2-1.4-4.5-2-8-2v14c3.5 0 6 .6 8 2 2-1.4 4.5-2 8-2V4c-3.5 0-6 .6-8 2z" />
          <path d="M12 6v14" />
        }
      </svg>
      <span class="mode-btn__label" aria-hidden="true">{{
        textMode() ? 'Mushaf' : 'Terjemahan'
      }}</span>
    </button>

    <!-- Tap: mark/unmark the page. Long-press or right-click: open the bookmarks list (Menu › Penanda for keyboard). -->
    <button
      type="button"
      class="mf-icon-btn"
      data-testid="bookmark-btn"
      [class.is-on]="pageBookmarked()"
      [attr.aria-label]="
        pageBookmarked() ? 'Hapus penanda halaman ' + page() : 'Tandai halaman ' + page()
      "
      [attr.aria-pressed]="pageBookmarked()"
      title="Ketuk untuk menandai, tekan lama untuk daftar penanda"
      (pointerdown)="pressStart($event)"
      (pointerup)="pressEnd()"
      (pointerleave)="pressEnd()"
      (pointercancel)="pressEnd()"
      (contextmenu)="onContextMenu($event)"
      (click)="onBookmarkClick()"
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M5.5 3h9l4 4v14h-13z"
          [attr.fill]="pageBookmarked() ? 'currentColor' : 'none'"
          [attr.fill-opacity]="pageBookmarked() ? 0.18 : 1"
        />
        <path d="M14.5 3v4h4" fill="none" />
        <path d="M8.5 21v-7h4v7l-2-1.6z" fill="currentColor" />
      </svg>
    </button>

    <button
      type="button"
      class="mf-icon-btn"
      aria-label="Halaman sebelumnya"
      [disabled]="!canPrev()"
      (click)="prev.emit()"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: var(--mf-z-chrome);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2px;
      padding: 8px calc(var(--mf-safe-right) + 4px) calc(var(--mf-safe-bottom) + 8px)
        calc(var(--mf-safe-left) + 4px);
      background: color-mix(in srgb, var(--ui-surface) 94%, transparent);
      backdrop-filter: blur(8px);
      border-top: 1px solid var(--ui-hair);
      transition:
        transform var(--mf-dur-base) var(--mf-ease),
        visibility 0s linear 0s;
    }
    :host(.is-hidden) {
      transform: translateY(100%);
      visibility: hidden;
      transition:
        transform var(--mf-dur-base) var(--mf-ease),
        visibility 0s linear var(--mf-dur-base);
    }
    .mf-icon-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .mf-icon-btn {
      flex: none;
      -webkit-touch-callout: none;
      user-select: none;
    }
    .mf-icon-btn.is-on {
      color: var(--ui-accent-icon);
    }
    .mode-btn {
      flex: none;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      min-width: var(--mf-tap);
      min-height: var(--mf-tap);
      padding: 2px 4px;
      border: 0;
      border-radius: var(--mf-radius-pill);
      background: transparent;
      color: var(--ui-ink);
    }
    .mode-btn.is-on {
      color: var(--ui-accent-icon);
    }
    .mode-btn__label {
      font-size: 10px;
      line-height: 1.1;
      white-space: nowrap;
    }
    @media (max-width: 359px) {
      .mode-btn__label {
        display: none;
      }
    }
    .pill {
      flex: none;
      min-width: 64px;
      min-height: var(--mf-tap);
      padding: 0 10px;
      border-radius: var(--mf-radius-pill);
      border: 1px solid var(--ui-hair);
      background: var(--ui-surface);
      color: var(--ui-ink);
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
    }
  `,
})
export class ChromeBottom implements OnDestroy {
  protected readonly ui = inject(ReaderUiService);
  private readonly bookmarkToggle = inject(BookmarkToggleService);
  private readonly content = inject(ContentApi);
  protected readonly audio = inject(AudioService);

  readonly shown = input(true);
  readonly canNext = input(true);
  readonly canPrev = input(true);
  /** Translation reading mode is active. */
  readonly textMode = input(false);
  readonly toggleMode = output<void>();
  readonly next = output<void>();
  readonly prev = output<void>();

  protected readonly page = this.ui.currentPage;

  protected readonly pageBookmarked = computed(() => {
    return this.bookmarkToggle.isPageBookmarked(this.ui.currentPage());
  });

  protected readonly pillText = computed(() => {
    return `${this.ui.currentPage()} / 604`;
  });

  // --- audio -----------------------------------------------------------------
  protected readonly playReady = computed(() => this.audio.active() || !!this.content.index());
  protected readonly showPause = computed(() => {
    const s = this.audio.state();
    return s === 'playing' || s === 'loading';
  });
  protected readonly playLabel = computed(() => {
    switch (this.audio.state()) {
      case 'playing':
      case 'loading':
        return 'Jeda bacaan';
      case 'paused':
        return 'Lanjutkan bacaan';
      case 'error':
        return 'Coba putar lagi';
      default:
        return `Putar bacaan dari halaman ${this.ui.currentPage()}`;
    }
  });

  /** Idle: start from the first ayah of this page. Active: pause/resume (error retries). */
  protected playOrToggle(): void {
    if (this.audio.active()) {
      this.audio.toggle();
      return;
    }
    const page = this.ui.currentPage();
    this.audio.play(this.content.pageMeta(page).first, page);
  }

  // --- bookmark: tap = toggle, long-press / right-click = list --------------------
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressed = false;

  protected pressStart(e: PointerEvent): void {
    if (e.button > 0) return;
    this.pressEnd();
    this.longPressed = false;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.longPressed = true;
      this.ui.openSheet('bookmarks');
    }, BOOKMARK_LONG_PRESS_MS);
  }

  protected pressEnd(): void {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }

  protected onContextMenu(e: Event): void {
    e.preventDefault(); // also fired by a touch long-press on some browsers
    this.pressEnd();
    if (!this.longPressed) this.ui.openSheet('bookmarks');
    this.longPressed = true; // swallow the click that may follow
    setTimeout(() => (this.longPressed = false), 600);
  }

  protected onBookmarkClick(): void {
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    void this.toggleBookmark();
  }

  ngOnDestroy(): void {
    this.pressEnd();
  }

  protected toggleBookmark(): Promise<void> {
    return this.bookmarkToggle.togglePage(this.ui.currentPage());
  }
}

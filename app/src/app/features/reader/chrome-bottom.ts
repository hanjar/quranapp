import { LOCAL_WRITE_TIMEOUT_MS, withTimeout } from '../../core/async';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';

/** Bottom bar: next | page bookmark | page pill | contents | prev (no audio this phase). */
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
      [class.is-on]="pageBookmarked()"
      [attr.aria-label]="
        pageBookmarked() ? 'Hapus penanda halaman ' + page() : 'Tandai halaman ' + page()
      "
      [attr.aria-pressed]="pageBookmarked()"
      (click)="toggleBookmark()"
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        [attr.fill]="pageBookmarked() ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
      </svg>
    </button>

    <!-- Touch screens: zoom lives here (no free margin for floating +/-); mouse users get +/- at the edge. -->
    @if (!textMode()) {
    <button
      type="button"
      class="mf-icon-btn zoom-toggle"
      [class.is-on]="zoomed()"
      [disabled]="!zoomAvailable()"
      [attr.aria-label]="zoomed() ? 'Kembali ke ukuran normal' : 'Perbesar halaman'"
      [attr.aria-pressed]="zoomed()"
      (click)="toggleZoom.emit()"
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M20 20l-5-5M8 10.5h5" />
        @if (!zoomed()) {
          <path d="M10.5 8v5" />
        }
      </svg>
    </button>
    }

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
      class="mf-icon-btn"
      aria-label="Daftar isi"
      (click)="ui.openSheet('browse', { browseTab: 'surah' })"
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M5 7h14M5 12h14M5 17h9" />
      </svg>
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
      <span class="mode-btn__label" aria-hidden="true">{{ textMode() ? 'Mushaf' : 'Terjemahan' }}</span>
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
    @media (pointer: fine) {
      .zoom-toggle {
        display: none;
      }
    }
    .mf-icon-btn.is-on {
      color: var(--ui-accent-icon);
    }
    .mode-btn {
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
      min-width: 64px;
      min-height: var(--mf-tap);
      padding: 0 12px;
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
export class ChromeBottom {
  protected readonly ui = inject(ReaderUiService);
  private readonly userData = inject(UserDataApi);

  readonly shown = input(true);
  readonly canNext = input(true);
  readonly canPrev = input(true);
  readonly zoomed = input(false);
  /** False in phone-landscape fit-width mode, where the page is already enlarged. */
  readonly zoomAvailable = input(true);
  /** Translation reading mode is active. */
  readonly textMode = input(false);
  readonly toggleMode = output<void>();
  readonly toggleZoom = output<void>();
  readonly next = output<void>();
  readonly prev = output<void>();

  protected readonly page = this.ui.currentPage;

  protected readonly pageBookmarked = computed(() => {
    const p = this.ui.currentPage();
    return this.userData.bookmarks().some((b) => b.kind === 'page' && b.page === p);
  });

  protected readonly pillText = computed(() => {
    return `${this.ui.currentPage()} / 604`;
  });

  protected async toggleBookmark(): Promise<void> {
    const page = this.ui.currentPage();
    let result: 'added' | 'removed';
    try {
      result = await withTimeout(this.userData.togglePageBookmark(page), LOCAL_WRITE_TIMEOUT_MS);
    } catch (e) {
      console.error('[bookmark] page toggle failed', e);
      this.ui.showToast({
        message: 'Penanda gagal disimpan. Tutup tab lain aplikasi ini lalu muat ulang.',
        duration: 8000,
      });
      return;
    }
    if (result === 'added') {
      this.ui.showToast({
        message: `Halaman ${page} ditandai`,
        actionLabel: 'Urungkan',
        action: () => void this.userData.togglePageBookmark(page),
      });
    } else {
      this.ui.showToast({
        message: 'Penanda halaman dihapus',
        actionLabel: 'Urungkan',
        action: () => void this.userData.togglePageBookmark(page),
      });
    }
  }
}

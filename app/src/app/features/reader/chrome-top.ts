import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ContentApi, SyncApi } from '../../core/contracts';
import { SyncStatus } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';

const SYNC_LABEL: Record<SyncStatus, string> = {
  off: 'belum masuk',
  idle: 'siap',
  pending: 'menunggu sinkronisasi',
  syncing: 'menyinkronkan',
  synced: 'tersinkron',
  offline: 'offline',
  error: 'gagal sinkron',
  conflict: 'perlu pilihan',
  unauthorized: 'perlu masuk ulang',
};

/** Top bar: title (opens browse), search, bookmarks, settings, account. */
@Component({
  selector: 'mf-chrome-top',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-hidden]': '!shown()' },
  template: `
    <button
      type="button"
      class="title"
      [attr.aria-label]="'Buka daftar isi. ' + titleText() + ', ' + subText()"
      (click)="ui.openSheet('browse', { browseTab: 'surah' })"
    >
      <span class="title__name mf-display">{{ titleText() }}</span>
      <span class="title__sub">{{ subText() }}</span>
    </button>

    <!-- Enter full-screen reading; tapping the page margin brings the menu back. -->
    <button
      type="button"
      class="mf-icon-btn"
      aria-label="Sembunyikan menu (layar penuh)"
      title="Sembunyikan menu"
      (click)="ui.chromeVisible.set(false)"
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      </svg>
    </button>
    <button type="button" class="mf-icon-btn" aria-label="Cari" (click)="ui.openSheet('search')">
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
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.2-4.2" />
      </svg>
    </button>
    <button
      type="button"
      class="mf-icon-btn"
      aria-label="Penanda"
      (click)="ui.openSheet('bookmarks')"
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
        <path d="M9.5 8.5h5" />
      </svg>
    </button>
    <button
      type="button"
      class="mf-icon-btn"
      aria-label="Progres membaca"
      (click)="ui.openSheet('progress')"
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
        <path d="M12 4a8 8 0 1 1-8 8" />
        <path d="M12 8v4l3 2" />
      </svg>
    </button>
    <button
      type="button"
      class="mf-icon-btn"
      aria-label="Pengaturan"
      (click)="ui.openSheet('settings')"
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
        <path d="M4 8h10M18 8h2M4 16h3M11 16h9" />
        <circle cx="16" cy="8" r="2" />
        <circle cx="9" cy="16" r="2" />
      </svg>
    </button>
    @if (sync.available) {
      <button
        type="button"
        class="mf-icon-btn account"
        [attr.aria-label]="'Akun dan sinkronisasi, ' + syncLabel()"
        (click)="ui.openSheet('account')"
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
          <circle cx="12" cy="9" r="3.5" />
          <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
        </svg>
        <span class="dot" [attr.data-status]="sync.status()" aria-hidden="true"></span>
      </button>
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      z-index: var(--mf-z-chrome);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: calc(var(--mf-safe-top) + 4px) calc(var(--mf-safe-right) + 8px) 6px
        calc(var(--mf-safe-left) + 16px);
      background: color-mix(in srgb, var(--ui-surface) 94%, transparent);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--ui-hair);
      transition:
        transform var(--mf-dur-base) var(--mf-ease),
        visibility 0s linear 0s;
    }
    :host(.is-hidden) {
      transform: translateY(-100%);
      visibility: hidden;
      transition:
        transform var(--mf-dur-base) var(--mf-ease),
        visibility 0s linear var(--mf-dur-base);
    }
    .title {
      flex: 1;
      min-width: 0;
      min-height: var(--mf-tap);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      border: none;
      background: transparent;
      color: var(--ui-ink);
      text-align: left;
      padding: 0;
    }
    .title__name {
      font-size: 19px;
      font-weight: 500;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .title__sub {
      font-size: 12.5px;
      color: var(--ui-muted);
    }
    .account {
      position: relative;
    }
    .dot {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1.5px solid var(--ui-surface);
      background: var(--ui-muted);
    }
    .dot[data-status='synced'],
    .dot[data-status='idle'] {
      background: var(--ui-primary);
    }
    .dot[data-status='syncing'],
    .dot[data-status='pending'],
    .dot[data-status='conflict'] {
      background: var(--ui-accent-icon);
    }
    .dot[data-status='error'],
    .dot[data-status='unauthorized'] {
      background: var(--mf-danger);
    }
  `,
})
export class ChromeTop {
  protected readonly ui = inject(ReaderUiService);
  protected readonly sync = inject(SyncApi);
  private readonly content = inject(ContentApi);

  readonly shown = input(true);

  protected readonly titleText = computed(() => {
    if (!this.content.index()) return 'Mushaf Digital';
    const names: string[] = [];
    for (const n of this.content.pageMeta(this.ui.currentPage()).surahs) {
      const name = this.content.surah(n).nameLatin;
      if (!names.includes(name)) names.push(name);
    }
    return names.join(' · ') || 'Mushaf Digital';
  });

  protected readonly subText = computed(() => {
    const page = this.ui.currentPage();
    if (!this.content.index()) return `Hal. ${page}`;
    return `Hal. ${page} · Juz ${this.content.pageMeta(page).juz}`;
  });

  protected readonly syncLabel = computed(() => SYNC_LABEL[this.sync.status()]);
}

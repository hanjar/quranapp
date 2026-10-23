import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ContentApi, OfflineApi, SyncApi, UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { ThemeService } from '../../core/theme.service';
import { UpdateService } from '../../core/update.service';
import { menuNeedsAttention, offlineNeedsAttention, syncNeedsAttention } from './attention';

/**
 * Top bar (fits a 320px portrait phone): [surah title ▾ / "Hal. · Juz" → browse sheet] …
 * [search] [night] [menu]. The title opens the surah tab, the page line the page tab.
 * Everything else (bookmarks, progress, offline, settings, account, fullscreen, install,
 * feedback, about) lives in the Menu sheet. The menu button shows a dot when sync failed
 * or conflicts, an app update is ready, or the offline download is paused/failed.
 */
@Component({
  selector: 'mf-chrome-top',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-hidden]': '!shown()' },
  template: `
    <div class="title-wrap">
      <button
        type="button"
        class="title"
        [attr.aria-label]="'Daftar surah, juz, halaman. ' + titleText()"
        (click)="ui.openSheet('browse', { browseTab: 'surah' })"
      >
        <span class="title__name mf-display">{{ titleText() }}</span>
        <svg
          class="title__chev"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <!-- The page jump (was the bottom-bar pill, rarely used) -->
      <button
        type="button"
        class="page-btn"
        data-testid="page-btn"
        [attr.aria-label]="'Pilih halaman. ' + subText()"
        (click)="ui.openSheet('browse', { browseTab: 'page' })"
      >
        {{ subText() }}
      </button>
    </div>

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
      class="mf-icon-btn night-toggle"
      [attr.aria-label]="night.nightActive() ? 'Matikan mode malam' : 'Nyalakan mode malam'"
      [attr.aria-pressed]="night.nightActive()"
      (click)="toggleNight()"
    >
      @if (night.nightActive()) {
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
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"
          />
        </svg>
      } @else {
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
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      }
    </button>
    <button
      type="button"
      class="mf-icon-btn menu-btn"
      [attr.aria-label]="attention() ? 'Menu, ada yang perlu diperiksa' : 'Menu'"
      (click)="ui.openSheet('menu')"
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
        <path d="M5 7h14M5 12h14M5 17h14" />
      </svg>
      @if (attention()) {
        <span class="dot" data-testid="menu-dot" aria-hidden="true"></span>
      }
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      /* a pinch on the bars must not zoom the browser (it cannot be undone over the page) */
      touch-action: none;
      left: 0;
      right: 0;
      top: 0;
      z-index: var(--mf-z-chrome);
      display: flex;
      align-items: center;
      gap: 2px;
      padding: calc(var(--mf-safe-top) + 4px) calc(var(--mf-safe-right) + 6px) 6px
        calc(var(--mf-safe-left) + 12px);
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
    .title-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    .title,
    .page-btn {
      max-width: 100%;
      border: none;
      background: transparent;
      text-align: left;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      padding: 4px 0 1px;
      color: var(--ui-ink);
    }
    .title__name {
      font-size: 19px;
      font-weight: 500;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .title__chev {
      flex: none;
      color: var(--ui-muted);
    }
    .page-btn {
      padding: 1px 12px 5px 0;
      font-size: 12.5px;
      color: var(--ui-muted);
      white-space: nowrap;
    }
    .title:focus-visible,
    .page-btn:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
      border-radius: var(--mf-radius-sm, 6px);
    }
    .menu-btn {
      position: relative;
    }
    .dot {
      position: absolute;
      top: 9px;
      right: 9px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1.5px solid var(--ui-surface);
      background: var(--mf-danger);
    }
  `,
})
export class ChromeTop {
  protected readonly ui = inject(ReaderUiService);
  private readonly sync = inject(SyncApi);
  private readonly content = inject(ContentApi);
  private readonly data = inject(UserDataApi);
  private readonly updates = inject(UpdateService);
  private readonly offline = inject(OfflineApi);
  protected readonly night = inject(ThemeService);

  readonly shown = input(true);

  /** Manual flip. From Otomatis the toast offers a way back. */
  protected toggleNight(): void {
    const wasAuto = this.data.prefs().nightMode === 'auto';
    const next = this.night.nightActive() ? 'off' : 'on';
    void this.data.setPrefs({ nightMode: next });
    if (wasAuto) {
      this.ui.showToast({
        message: `Mode malam: ${next === 'on' ? 'Nyala' : 'Mati'} (manual)`,
        actionLabel: 'Kembali ke otomatis',
        action: () => void this.data.setPrefs({ nightMode: 'auto' }),
        duration: 6000,
      });
    }
  }

  /** Dot on the menu button (see attention.ts). */
  protected readonly attention = computed(() =>
    menuNeedsAttention({
      sync:
        this.sync.available && syncNeedsAttention(this.sync.status(), this.sync.lastSuccessAt()),
      update: this.updates.available(),
      offline: offlineNeedsAttention(this.offline.status()),
    }),
  );

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
}

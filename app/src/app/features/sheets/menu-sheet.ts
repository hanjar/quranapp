import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { InstallService } from '../../core/install.service';
import { OfflineApi, SyncApi } from '../../core/contracts';
import { ReaderUiService, SheetName } from '../../core/reader-ui.service';
import { UpdateService } from '../../core/update.service';
import { offlineNeedsAttention, syncNeedsAttention } from '../reader/attention';

/** Body of the "Menu" sheet: a 3-column grid of large tiles, one per app area. */
@Component({
  selector: 'app-menu-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      padding: 8px 16px 20px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tile {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 84px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 4px;
      border: 1px solid var(--ui-hair);
      border-radius: var(--mf-radius-md);
      background: var(--ui-surface);
      color: var(--ui-ink);
      font-size: 13px;
      line-height: 1.2;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .tile:hover {
      background: color-mix(in srgb, var(--ui-ink) 5%, var(--ui-surface));
    }
    .tile svg {
      flex: none;
      color: var(--ui-primary);
    }
    .avatar {
      width: 26px;
      height: 26px;
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--ui-primary);
      color: var(--ui-surface);
      font-size: 13px;
      font-weight: 600;
    }
    .label {
      max-width: 100%;
    }
    .tile:disabled {
      opacity: 0.7;
    }
    .spin {
      animation: mf-spin 0.9s linear infinite;
    }
    @keyframes mf-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spin {
        animation: none;
      }
    }
    .dot {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1.5px solid var(--ui-surface);
      background: var(--mf-danger);
    }
    .badge {
      position: absolute;
      top: 6px;
      right: 6px;
      padding: 1px 6px;
      border-radius: var(--mf-radius-pill);
      background: var(--ui-accent-icon);
      color: var(--ui-surface);
      font-size: 10px;
      font-weight: 600;
      line-height: 1.5;
    }
  `,
  template: `
    <ul class="grid" aria-label="Menu aplikasi">
      <li>
        <button type="button" class="tile" data-tile="bookmarks" (click)="open('bookmarks')">
          <svg
            width="26"
            height="26"
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
          <span class="label">Penanda</span>
        </button>
      </li>
      <li>
        <button type="button" class="tile" data-tile="progress" (click)="open('progress')">
          <svg
            width="26"
            height="26"
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
          <span class="label">Progres</span>
        </button>
      </li>
      <li>
        <button
          type="button"
          class="tile"
          data-tile="offline"
          [attr.aria-label]="offlineAttention() ? 'Offline, unduhan perlu diperiksa' : null"
          (click)="open('offline')"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v10M8 10.5l4 4 4-4M5 19h14" />
          </svg>
          <span class="label">Offline</span>
          @if (offlineAttention()) {
            <span class="dot" aria-hidden="true"></span>
          }
        </button>
      </li>
      <li>
        <button type="button" class="tile" data-tile="settings" (click)="open('settings')">
          <svg
            width="26"
            height="26"
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
          <span class="label">Pengaturan</span>
        </button>
      </li>
      @if (sync.available) {
        <li>
          <button
            type="button"
            class="tile"
            data-tile="account"
            [attr.aria-label]="accountLabel()"
            (click)="open('account')"
          >
            @if (sync.account(); as a) {
              <span class="avatar" aria-hidden="true">{{ initial() }}</span>
              <span class="label">{{ a.name ?? a.email ?? 'Akun' }}</span>
            } @else {
              <svg
                width="26"
                height="26"
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
              <span class="label">Masuk</span>
            }
            @if (syncAttention()) {
              <span class="dot" aria-hidden="true"></span>
            }
          </button>
        </li>
      }
      @if (sync.account()) {
        <li>
          <button
            type="button"
            class="tile"
            data-tile="sync-now"
            data-search-id="menu-sync"
            [disabled]="syncing()"
            [attr.aria-busy]="syncing()"
            (click)="syncNow()"
          >
            <svg
              class="sync-icon"
              [class.spin]="syncing()"
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
              <path d="M18 3v4h-4M6 21v-4h4" />
            </svg>
            <span class="label">{{ syncing() ? 'Menyinkronkan…' : 'Sinkronkan' }}</span>
          </button>
        </li>
      }
      <li>
        <button type="button" class="tile" data-tile="fullscreen" (click)="fullscreen()">
          <svg
            width="26"
            height="26"
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
          <span class="label">Layar penuh</span>
        </button>
      </li>
      @if (install.state() !== 'installed') {
        <li>
          <button type="button" class="tile" data-tile="install" (click)="installApp()">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="7" y="3" width="10" height="18" rx="2" />
              <path d="M12 8v6M9.5 11.5L12 14l2.5-2.5" />
            </svg>
            <span class="label">Pasang</span>
          </button>
        </li>
      }
      <li>
        <button type="button" class="tile" data-tile="feedback" (click)="open('feedback')">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 5h14v10H10l-5 4z" />
            <path d="M9 9.5h6" />
          </svg>
          <span class="label">Masukan</span>
        </button>
      </li>
      <li>
        <button
          type="button"
          class="tile"
          data-tile="about"
          [attr.aria-label]="updates.available() ? 'Tentang, versi baru tersedia' : null"
          (click)="open('about')"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="8" />
            <path d="M12 11v5M12 8v.01" />
          </svg>
          <span class="label">Tentang</span>
          @if (updates.available()) {
            <span class="badge" aria-hidden="true">Versi baru</span>
          }
        </button>
      </li>
    </ul>
  `,
})
export class MenuSheet {
  private readonly ui = inject(ReaderUiService);
  protected readonly sync = inject(SyncApi);
  protected readonly install = inject(InstallService);
  protected readonly updates = inject(UpdateService);
  private readonly offline = inject(OfflineApi);

  protected readonly initial = computed(() => {
    const a = this.sync.account();
    return (a?.name ?? a?.email ?? '?').trim().charAt(0).toUpperCase() || '?';
  });

  protected readonly syncAttention = computed(() =>
    syncNeedsAttention(this.sync.status(), this.sync.lastSuccessAt()),
  );
  protected readonly offlineAttention = computed(() =>
    offlineNeedsAttention(this.offline.status()),
  );

  protected readonly accountLabel = computed(() => {
    const a = this.sync.account();
    const base = a ? `Akun ${a.name ?? a.email ?? ''}`.trim() : 'Masuk';
    return this.syncAttention() ? `${base}, sinkronisasi perlu diperiksa` : base;
  });

  protected readonly syncing = signal(false);

  protected async syncNow(): Promise<void> {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      await this.sync.syncNow();
      const st = this.sync.status();
      this.ui.showToast({
        message: st === 'error' || st === 'offline' || st === 'unauthorized' ? 'Sinkronisasi belum berhasil. Coba lagi nanti.' : 'Tersinkron',
      });
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : 'Sinkronisasi gagal.';
      this.ui.showToast({ message: msg });
    } finally {
      this.syncing.set(false);
    }
  }

  /** Swaps this sheet for another one (same mechanism as the search sheet). */
  protected open(sheet: SheetName): void {
    this.ui.openSheet(sheet);
  }

  /** Reading without bars: the page margin brings them back. */
  protected fullscreen(): void {
    this.ui.closeSheet();
    this.ui.chromeVisible.set(false);
  }

  protected installApp(): void {
    this.ui.closeSheet();
    this.install.openModal();
  }
}

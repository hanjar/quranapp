import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { OfflineApi, UserDataApi } from '../../core/contracts';
import { InstallService } from '../../core/install.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { formatMb } from './format';

/** Offer only after real reading: this many distinct pages opened in the session. */
export const PAGES_BEFORE_OFFER = 3;

const DOWNLOAD_DISMISS_KEY = 'mf-download-offer-dismissed';
const SESSION_KEY = 'mf-ready-offered';

/** True when the connection looks metered or slow (Network Information API, where supported). */
export function looksMetered(nav: Navigator = navigator): boolean {
  const c = (
    nav as Navigator & {
      connection?: { saveData?: boolean; type?: string; effectiveType?: string };
    }
  ).connection;
  if (!c) return false;
  return (
    !!c.saveData || c.type === 'cellular' || c.effectiveType === '2g' || c.effectiveType === '3g'
  );
}

/**
 * "Siapkan untuk dibaca kapan saja": offers whatever is still missing on this
 * device — installing the app and/or downloading all 604 pages for offline use.
 * Opened automatically once per session after PAGES_BEFORE_OFFER pages (never
 * during onboarding/tour/sheets; each offer respects its own "Jangan tampilkan
 * lagi"), or on demand from Settings › Pasang ke perangkat.
 */
@Component({
  selector: 'app-install-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  template: `
    @if (install.modalOpen()) {
      <div class="scrim" aria-hidden="true" (click)="later()"></div>
      <div
        class="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ip-title"
        aria-describedby="ip-desc"
      >
        <img class="icon" src="icons/icon-192.png" alt="" width="56" height="56" />
        <h2 id="ip-title" class="mf-display" #heading tabindex="-1">{{ title() }}</h2>
        <p id="ip-desc" class="lead">{{ lead() }}</p>

        @if (showInstall()) {
          <section class="offer" aria-labelledby="ip-install">
            <h3 id="ip-install">Pasang ke perangkat</h3>
            <p class="muted">
              Buka dengan satu ketukan dari layar utama, layar penuh tanpa bilah peramban.
            </p>
            @switch (install.state()) {
              @case ('available') {
                <button type="button" class="mf-btn mf-btn--primary" (click)="installNow()">
                  Pasang aplikasi
                </button>
              }
              @case ('ios') {
                <ol class="steps" aria-label="Cara memasang di iPhone atau iPad">
                  <li>
                    Ketuk tombol <strong>Bagikan</strong> (kotak dengan panah ke atas) di Safari.
                  </li>
                  <li>
                    Pilih <strong>Tambahkan ke Layar Utama</strong>, lalu <strong>Tambah</strong>.
                  </li>
                </ol>
              }
              @default {
                <ol class="steps" aria-label="Cara memasang lewat menu peramban">
                  <li>
                    Buka menu peramban (<strong>⋮</strong> di Chrome, <strong>…</strong> di Edge).
                  </li>
                  <li>
                    Pilih <strong>Instal aplikasi</strong> atau
                    <strong>Tambahkan ke layar utama</strong>.
                  </li>
                </ol>
              }
            }
          </section>
        }

        @if (showDownload(); as d) {
          <section class="offer" aria-labelledby="ip-download">
            <h3 id="ip-download">Unduh seluruh mushaf</h3>
            <p class="muted">
              604 halaman bisa dibaca tanpa internet. {{ d.cached }} halaman sudah tersimpan.
            </p>
            @if (d.downloading) {
              <div
                class="bar"
                role="progressbar"
                aria-label="Mengunduh halaman"
                aria-valuemin="0"
                [attr.aria-valuemax]="d.total"
                [attr.aria-valuenow]="d.cached"
              >
                <span [style.width.%]="d.percent"></span>
              </div>
              <p class="muted" aria-live="polite">
                Mengunduh di latar… {{ d.cached }}/{{ d.total }}. Anda boleh menutup jendela ini.
              </p>
            } @else {
              @if (metered) {
                <p class="note">
                  Sepertinya Anda memakai data seluler atau mode hemat data. Disarankan mengunduh
                  lewat Wi-Fi.
                </p>
              }
              <button type="button" class="mf-btn mf-btn--primary" (click)="downloadNow()">
                {{ d.label }}
              </button>
            }
          </section>
        }

        @if (auto()) {
          <label class="dont">
            <input
              type="checkbox"
              [checked]="dontShow()"
              (change)="dontShow.set($any($event.target).checked)"
            />
            Jangan tampilkan lagi
          </label>
        }

        <div class="actions">
          <button type="button" class="mf-btn mf-btn--outline" (click)="later()">
            {{ closeLabel() }}
          </button>
        </div>
        <p class="hint">
          Bisa diatur kapan saja di Pengaturan › Pasang ke perangkat dan Offline &amp; unduhan.
        </p>
      </div>
    }
  `,
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: var(--mf-z-tour);
      background: var(--mf-scrim);
    }
    .card {
      position: fixed;
      z-index: calc(var(--mf-z-tour) + 1);
      left: 50%;
      bottom: calc(var(--mf-safe-bottom) + 16px);
      transform: translateX(-50%);
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      padding: 22px 20px 16px;
      border-radius: var(--mf-radius-sheet);
      background: var(--ui-surface);
      color: var(--ui-ink);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    @media (min-width: 600px) {
      .card {
        top: 50%;
        bottom: auto;
        transform: translate(-50%, -50%);
      }
    }
    .icon {
      width: 52px;
      height: 52px;
      border-radius: 13px;
    }
    h2 {
      margin: 0;
      font-size: 23px;
      font-weight: 600;
      outline: none;
    }
    h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .lead,
    .muted {
      margin: 0;
      color: var(--ui-ink2);
      line-height: 1.5;
      font-size: 14.5px;
    }
    .offer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      border-radius: var(--mf-radius-lg);
      border: 1px solid color-mix(in srgb, var(--ui-primary) 25%, transparent);
      background: color-mix(in srgb, var(--ui-primary) 6%, transparent);
    }
    .offer .mf-btn {
      width: 100%;
    }
    .steps {
      margin: 0;
      padding-left: 20px;
      line-height: 1.6;
      color: var(--ui-ink2);
      font-size: 14px;
    }
    .note {
      margin: 0;
      padding: 8px 10px;
      border-radius: var(--mf-radius-sm);
      background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
      font-size: 13.5px;
      line-height: 1.45;
    }
    .bar {
      height: 8px;
      border-radius: 4px;
      background: var(--ui-hair);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      background: var(--ui-primary);
      transition: width var(--mf-dur-base);
    }
    .dont {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: var(--mf-tap);
      font-size: 14.5px;
      cursor: pointer;
    }
    .dont input {
      width: 20px;
      height: 20px;
      accent-color: var(--ui-primary);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
    }
    .actions .mf-btn {
      flex: 1;
    }
    .hint {
      margin: 0;
      font-size: 12.5px;
      color: var(--ui-muted);
    }
  `,
})
export class InstallPrompt {
  protected readonly install = inject(InstallService);
  private readonly offline = inject(OfflineApi);
  private readonly ui = inject(ReaderUiService);
  private readonly data = inject(UserDataApi);
  private readonly router = inject(Router);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly metered = looksMetered();
  protected readonly dontShow = signal(false);
  /** Opened by the automatic offer (vs. from the Settings menu). */
  protected readonly auto = signal(false);
  private readonly downloadDismissed = signal(readFlag(DOWNLOAD_DISMISS_KEY));
  private readonly onReader = signal(false);
  private readonly pagesSeen = signal(0);
  private returnFocus: HTMLElement | null = null;

  private readonly installPending = computed(() => this.install.state() !== 'installed');
  private readonly downloadPending = computed(() => {
    const s = this.offline.status();
    return s.totalPages > 0 && s.cachedPages < s.totalPages;
  });

  /** An automatic offer respects each "Jangan tampilkan lagi"; the menu shows everything pending. */
  protected readonly showInstall = computed(
    () => this.installPending() && (!this.auto() || !this.install.dismissedForever()),
  );
  protected readonly showDownload = computed(() => {
    if (!this.downloadPending() || (this.auto() && this.downloadDismissed())) return null;
    const s = this.offline.status();
    const remaining = Math.max(0, s.totalBytes - s.cachedBytes);
    return {
      cached: s.cachedPages,
      total: s.totalPages,
      percent: Math.round((s.cachedPages / s.totalPages) * 100),
      downloading: s.state === 'downloading',
      label:
        s.cachedPages > 0
          ? `Unduh semua halaman (sisa ≈ ${formatMb(remaining)})`
          : `Unduh semua halaman (≈ ${formatMb(s.totalBytes)})`,
    };
  });

  protected readonly title = computed(() =>
    this.showInstall() && this.showDownload()
      ? 'Siapkan untuk dibaca kapan saja'
      : this.showInstall()
        ? 'Pasang Mushaf Digital'
        : 'Baca tanpa internet',
  );
  protected readonly lead = computed(() =>
    this.showInstall() && this.showDownload()
      ? 'Pasang aplikasinya dan simpan seluruh mushaf supaya tetap bisa dibaca walau tanpa sinyal.'
      : this.showInstall()
        ? 'Baca lebih nyaman langsung dari layar utama perangkat Anda.'
        : 'Simpan seluruh mushaf di perangkat ini supaya tetap bisa dibaca walau tanpa sinyal.',
  );
  protected readonly closeLabel = computed(() =>
    this.showDownload()?.downloading ? 'Tutup' : 'Nanti saja',
  );

  /** Only interrupt calm reading: no sheet, tour or onboarding in progress. */
  private readonly calm = computed(
    () =>
      this.onReader() &&
      this.data.prefs().onboardingDone &&
      !this.ui.sheetOpen() &&
      !this.ui.tourOpen(),
  );
  private readonly anythingToOffer = computed(
    () =>
      (this.installPending() && !this.install.dismissedForever()) ||
      (this.downloadPending() && !this.downloadDismissed()),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.onReader.set(e.urlAfterRedirects.startsWith('/hal/')));
    destroyRef.onDestroy(() => sub.unsubscribe());

    // Count distinct pages actually opened in the reader (from the URL, so the
    // service's initial default page is never counted).
    const seen = new Set<number>();
    const pageSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const m = /^\/hal\/(\d+)/.exec(e.urlAfterRedirects);
        if (m && !seen.has(+m[1])) {
          seen.add(+m[1]);
          this.pagesSeen.set(seen.size);
        }
      });
    destroyRef.onDestroy(() => pageSub.unsubscribe());

    // Automatic offer: once per session, after a few pages of calm reading.
    effect(() => {
      if (!this.calm() || this.pagesSeen() < PAGES_BEFORE_OFFER || !this.anythingToOffer()) return;
      untracked(() => {
        if (this.install.modalOpen() || readFlag(SESSION_KEY, true)) return;
        writeFlag(SESSION_KEY, true, true);
        this.auto.set(true);
        this.install.modalOpen.set(true);
      });
    });

    // Focus management: move into the dialog, restore on close.
    afterRenderEffect(() => {
      const open = this.install.modalOpen();
      const h = this.heading()?.nativeElement;
      if (open && h && this.returnFocus === null) {
        const active = document.activeElement;
        this.returnFocus = active instanceof HTMLElement ? active : document.body;
        this.dontShow.set(false);
        h.focus({ preventScroll: true });
      } else if (!open && this.returnFocus) {
        const target = this.returnFocus;
        this.returnFocus = null;
        this.auto.set(false);
        if (target.isConnected) target.focus({ preventScroll: true });
      }
    });
  }

  protected later(): void {
    if (this.auto() && this.dontShow()) {
      // Silence exactly the offers that were shown.
      if (this.showInstall()) this.install.closeModal({ dontShowAgain: true });
      if (this.showDownload()) {
        this.downloadDismissed.set(true);
        writeFlag(DOWNLOAD_DISMISS_KEY, true);
      }
    }
    this.install.modalOpen.set(false);
  }

  protected async installNow(): Promise<void> {
    const ok = await this.install.promptInstall();
    this.ui.showToast({
      message: ok
        ? 'Mushaf Digital terpasang di perangkat ini'
        : 'Pemasangan dibatalkan. Anda bisa memasang lagi lewat Pengaturan.',
    });
    // Keep the dialog open if the download offer is still useful.
    if (!this.showDownload()) this.install.modalOpen.set(false);
  }

  protected downloadNow(): void {
    const s = this.offline.status();
    const run = s.state === 'paused' ? this.offline.resume() : this.offline.startFullDownload();
    void run.catch(() => undefined);
    this.ui.showToast({
      message: 'Mengunduh mushaf di latar. Progres ada di Pengaturan › Offline.',
    });
  }

  protected onEscape(e: Event): void {
    if (!this.install.modalOpen() || e.defaultPrevented) return;
    e.preventDefault();
    this.later();
  }
}

/** Storage can be unavailable (private mode, blocked site data): fail closed, never throw. */
function readFlag(key: string, session = false): boolean {
  try {
    return (session ? sessionStorage : localStorage).getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean, session = false): void {
  try {
    const s = session ? sessionStorage : localStorage;
    if (on) s.setItem(key, '1');
    else s.removeItem(key);
  } catch {
    // preference lasts for this page load only
  }
}

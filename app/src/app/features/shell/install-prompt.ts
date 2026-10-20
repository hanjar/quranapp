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
import { UserDataApi } from '../../core/contracts';
import { InstallService } from '../../core/install.service';
import { ReaderUiService } from '../../core/reader-ui.service';

/** Offer to install only after real reading: N page turns or T ms on a reader page. */
const PAGES_BEFORE_OFFER = 2;
const MS_BEFORE_OFFER = 30_000;

/**
 * "Pasang Mushaf Digital" modal. Opened automatically once per session after the
 * reader has engaged (never during onboarding/tour/sheets, never after
 * "Jangan tampilkan lagi"), or on demand from Settings › Pasang ke perangkat.
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
        <h2 id="ip-title" class="mf-display" #heading tabindex="-1">Pasang Mushaf Digital</h2>
        <p id="ip-desc" class="lead">Baca lebih nyaman langsung dari layar utama perangkat Anda.</p>
        <ul class="benefits">
          <li>Buka dengan satu ketukan, tanpa mengetik alamat</li>
          <li>Layar penuh, tanpa bilah peramban</li>
          <li>Halaman yang tersimpan tetap bisa dibaca offline</li>
        </ul>

        @switch (install.state()) {
          @case ('ios') {
            <ol class="steps" aria-label="Cara memasang di iPhone atau iPad">
              <li>Ketuk tombol <strong>Bagikan</strong> (kotak dengan panah ke atas) di Safari.</li>
              <li>Pilih <strong>Tambahkan ke Layar Utama</strong>.</li>
              <li>Ketuk <strong>Tambah</strong>.</li>
            </ol>
          }
          @case ('manual') {
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

        <label class="dont">
          <input
            type="checkbox"
            [checked]="dontShow()"
            (change)="dontShow.set($any($event.target).checked)"
          />
          Jangan tampilkan lagi
        </label>

        <div class="actions">
          <button type="button" class="mf-btn mf-btn--ghost" (click)="later()">Nanti saja</button>
          @if (install.state() === 'available') {
            <button type="button" class="mf-btn mf-btn--primary" (click)="installNow()">
              Pasang
            </button>
          } @else {
            <button type="button" class="mf-btn mf-btn--primary" (click)="later()">Mengerti</button>
          }
        </div>
        <p class="hint">Anda bisa memasang kapan saja lewat Pengaturan › Pasang ke perangkat.</p>
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
      width: min(420px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      padding: 22px 22px 18px;
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
      width: 56px;
      height: 56px;
      border-radius: 14px;
    }
    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      outline: none;
    }
    .lead {
      margin: 0;
      color: var(--ui-ink2);
      line-height: 1.5;
    }
    .benefits,
    .steps {
      margin: 0;
      padding-left: 20px;
      line-height: 1.6;
      color: var(--ui-ink2);
      font-size: 14.5px;
    }
    .steps {
      padding: 12px 12px 12px 30px;
      border-radius: var(--mf-radius-md);
      background: color-mix(in srgb, var(--ui-primary) 7%, transparent);
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
      gap: 10px;
      justify-content: flex-end;
    }
    .actions .mf-btn--primary {
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
  private readonly ui = inject(ReaderUiService);
  private readonly data = inject(UserDataApi);
  private readonly router = inject(Router);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly dontShow = signal(false);
  private readonly onReader = signal(false);
  private readonly pagesSeen = signal(0);
  private returnFocus: HTMLElement | null = null;

  /** Only interrupt calm reading: no sheet, tour or onboarding in progress. */
  private readonly calm = computed(
    () =>
      this.onReader() &&
      this.data.prefs().onboardingDone &&
      !this.ui.sheetOpen() &&
      !this.ui.tourOpen(),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.onReader.set(e.urlAfterRedirects.startsWith('/hal/')));
    destroyRef.onDestroy(() => sub.unsubscribe());

    // Count distinct pages the reader has opened in this session.
    let last = 0;
    effect(() => {
      const p = this.ui.currentPage();
      if (this.onReader() && p !== last) {
        last = p;
        untracked(() => this.pagesSeen.update((n) => n + 1));
      }
    });

    // Auto-offer after engagement (page turns or time spent reading).
    effect((onCleanup) => {
      if (!this.calm()) return;
      if (this.pagesSeen() > PAGES_BEFORE_OFFER) {
        untracked(() => this.install.offerOnce());
        return;
      }
      const t = setTimeout(() => {
        if (untracked(() => this.calm())) this.install.offerOnce();
      }, MS_BEFORE_OFFER);
      onCleanup(() => clearTimeout(t));
    });

    // Focus management: move into the dialog, restore on close.
    afterRenderEffect(() => {
      const open = this.install.modalOpen();
      const h = this.heading()?.nativeElement;
      if (open && h && this.returnFocus === null) {
        const active = document.activeElement;
        this.returnFocus = active instanceof HTMLElement ? active : document.body;
        this.dontShow.set(this.install.dismissedForever());
        h.focus({ preventScroll: true });
      } else if (!open && this.returnFocus) {
        const target = this.returnFocus;
        this.returnFocus = null;
        if (target.isConnected) target.focus({ preventScroll: true });
      }
    });
  }

  protected later(): void {
    this.install.closeModal({ dontShowAgain: this.dontShow() });
  }

  protected async installNow(): Promise<void> {
    const dont = this.dontShow();
    this.install.closeModal({ dontShowAgain: dont });
    const ok = await this.install.promptInstall();
    this.ui.showToast({
      message: ok
        ? 'Mushaf Digital terpasang di perangkat ini'
        : 'Pemasangan dibatalkan. Anda bisa memasang lagi lewat Pengaturan.',
    });
  }

  protected onEscape(e: Event): void {
    if (!this.install.modalOpen() || e.defaultPrevented) return;
    e.preventDefault();
    this.later();
  }
}

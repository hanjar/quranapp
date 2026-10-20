import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';

interface TourStep {
  title: string;
  body: string;
  alt: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Ketuk margin',
    body: 'Bilah atas dan bawah tampil saat membaca. Buka ☰ Menu lalu pilih Layar penuh untuk menyembunyikannya, dan ketuk tepi halaman untuk memunculkannya lagi. Judul surah di kiri atas membuka daftar surah, juz, dan halaman.',
    alt: 'Tanpa gestur: tombol "Tampilkan kontrol" lewat keyboard (Tab), atau atur di Pengaturan › Selalu tampilkan kontrol.',
  },
  {
    title: 'Ketuk atau tekan lama ayat',
    body: 'Ketuk atau tekan lama sebuah ayat untuk memilihnya, lalu pilih tindakan seperti tandai, salin rujukan, atau bagikan.',
    alt: 'Tanpa gestur: gunakan Tab untuk berpindah ayat, lalu tekan Enter.',
  },
  {
    title: 'Geser & ketuk dua kali',
    body: 'Geser dari kanan ke kiri untuk membalik halaman. Ketuk dua kali atau cubit untuk memperbesar, ketuk dua kali lagi untuk kembali.',
    alt: 'Tanpa gestur: gunakan tombol halaman di bawah atau tombol panah kiri dan kanan; tombol + dan − tampil saat halaman diperbesar.',
  },
];

/** Overlay for the 3-step gesture tour, shown while `ui.tourOpen()`. */
@Component({
  selector: 'app-gesture-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: var(--mf-z-tour);
      background: color-mix(in srgb, var(--ui-ink) 45%, transparent);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 20px 20px calc(20px + var(--mf-safe-bottom));
    }
    .dlg {
      width: 100%;
      max-width: 400px;
      background: var(--ui-surface);
      color: var(--ui-ink);
      border-radius: var(--mf-radius-sheet);
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-family: var(--ui-font);
    }
    .dlg:focus {
      outline: none;
    }
    .step {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: var(--ui-accent-ink);
    }
    h2 {
      margin: 0;
      font-family: var(--ui-display);
      font-size: 24px;
      font-weight: 500;
    }
    p {
      margin: 0;
    }
    .body {
      font-size: 15px;
      line-height: 1.5;
      color: var(--ui-ink2);
    }
    .alt {
      font-size: 13px;
      color: var(--ui-muted);
    }
    .foot {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
      padding-top: 4px;
    }
    .skip {
      min-height: var(--mf-tap);
      padding: 0 6px;
      border: none;
      background: transparent;
      color: var(--ui-primary);
      font-size: 14.5px;
    }
  `,
  template: `
    @if (ui.tourOpen()) {
      <div class="scrim">
        <div
          #dlg
          class="dlg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          tabindex="-1"
        >
          <div class="step">LANGKAH {{ i() + 1 }} DARI {{ total }}</div>
          <h2 id="tour-title">{{ step().title }}</h2>
          <p class="body">{{ step().body }}</p>
          <p class="alt">{{ step().alt }}</p>
          <div class="foot">
            <button type="button" class="skip" (click)="close()">Lewati</button>
            <button type="button" class="mf-btn mf-btn--primary" (click)="next()">
              {{ last() ? 'Mulai membaca' : 'Berikutnya' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class GestureTour {
  protected readonly ui = inject(ReaderUiService);
  private readonly data = inject(UserDataApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dlg = viewChild<ElementRef<HTMLElement>>('dlg');

  protected readonly total = TOUR_STEPS.length;
  protected readonly i = signal(0);
  protected readonly step = () => TOUR_STEPS[this.i()];
  protected readonly last = () => this.i() === TOUR_STEPS.length - 1;

  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.ui.tourOpen();
      const el = this.dlg()?.nativeElement;
      untracked(() => {
        if (open && el) {
          if (!this.opener) {
            this.opener =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            this.i.set(0);
          }
          el.focus();
        } else if (!open && this.opener) {
          const o = this.opener;
          this.opener = null;
          if (o.isConnected) o.focus();
        }
      });
    });
  }

  protected next(): void {
    if (this.last()) this.close();
    else this.i.update((n) => n + 1);
  }

  protected close(): void {
    this.ui.tourOpen.set(false);
    if (!this.data.prefs().onboardingDone) void this.data.setPrefs({ onboardingDone: true });
  }

  protected onKey(e: KeyboardEvent): void {
    if (!this.ui.tourOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      const root = this.dlg()?.nativeElement;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button'));
      if (!items.length) return;
      const first = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

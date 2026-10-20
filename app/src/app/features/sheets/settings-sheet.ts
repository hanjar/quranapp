import { buildLabel } from '../../core/build-info';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { OfflineApi, SyncApi, UserDataApi } from '../../core/contracts';
import { LayoutMode } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { PAPER_THEMES, UI_THEMES } from '../../core/theme.service';
import { exportFilename, formatMb, importSummary } from '../shell/format';
import { SHEET_STYLES } from './sheet-styles';

const LAYOUTS: { id: LayoutMode; label: string }[] = [
  { id: 'auto', label: 'Otomatis' },
  { id: 'single', label: '1 halaman' },
  { id: 'spread', label: '2 halaman' },
];

const SYNC_LABEL: Record<string, string> = {
  off: 'Siap',
  idle: 'Siap',
  pending: 'Menunggu sinkronisasi',
  syncing: 'Menyinkronkan…',
  synced: 'Tersinkron',
  offline: 'Offline',
  error: 'Gagal',
  conflict: 'Perlu pilihan',
  unauthorized: 'Sesi berakhir',
};

/** Body of the "Pengaturan" sheet. Rendered inside the sheet container (no own chrome). */
@Component({
  selector: 'app-settings-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: SHEET_STYLES,
  template: `
    @if (offlineCta(); as cta) {
      <section class="offline-cta" aria-labelledby="st-offline-cta">
        <h3 id="st-offline-cta">Baca tanpa internet</h3>
        <p class="muted">
          {{ cta.cached }} dari {{ cta.total }} halaman sudah tersimpan di perangkat ini.
        </p>
        <div
          class="bar"
          role="progressbar"
          aria-label="Halaman tersimpan"
          [attr.aria-valuenow]="cta.cached"
          aria-valuemin="0"
          [attr.aria-valuemax]="cta.total"
        >
          <span [style.width.%]="cta.percent"></span>
        </div>
        <button type="button" class="mf-btn mf-btn--primary" (click)="downloadAll()">
          {{ cta.downloading ? 'Lihat progres unduhan' : cta.label }}
        </button>
      </section>
    }

    <section aria-labelledby="st-paper">
      <h3 id="st-paper">Warna kertas</h3>
      <div class="grid3">
        @for (t of paperThemes; track t.id) {
          <button
            type="button"
            class="card"
            [attr.aria-pressed]="prefs().paperTheme === t.id"
            (click)="data.setPrefs({ paperTheme: t.id })"
          >
            <span class="swatch" [style.background]="t.hex"></span>
            <span class="name">{{ t.name }}</span>
            <span class="sub">{{ t.hex }}</span>
          </button>
        }
      </div>
    </section>

    <section aria-labelledby="st-ui">
      <h3 id="st-ui">Gaya antarmuka</h3>
      <div class="grid2">
        @for (u of uiThemes; track u.id) {
          <button
            type="button"
            class="card"
            [attr.aria-pressed]="prefs().uiTheme === u.id"
            (click)="data.setPrefs({ uiTheme: u.id })"
          >
            <span class="name">{{ u.name }}</span>
            <span class="sub">{{ u.fontName }}</span>
            <span class="dots" aria-hidden="true">
              <span class="dot" [style.background]="u.primary"></span>
              <span class="dot" [style.background]="u.accent"></span>
            </span>
          </button>
        }
      </div>
    </section>

    <section aria-labelledby="st-layout">
      <h3 id="st-layout">Tata letak halaman</h3>
      <div class="mf-segmented" role="group" aria-labelledby="st-layout">
        @for (l of layouts; track l.id) {
          <button
            type="button"
            [attr.aria-pressed]="prefs().layoutMode === l.id"
            (click)="data.setPrefs({ layoutMode: l.id })"
          >
            {{ l.label }}
          </button>
        }
      </div>
      <p class="muted">
        Otomatis menampilkan dua halaman berdampingan pada layar lebar mendatar; selain itu satu
        halaman. Di ponsel posisi mendatar, halaman memenuhi lebar layar dan dapat digulir. Susunan
        halaman mengikuti mushaf cetak dan tidak diubah.
      </p>
    </section>

    <section aria-label="Tampilan">
      <div class="switch-row">
        <span id="sw-controls">Selalu tampilkan kontrol</span>
        <span class="hit"
          ><button
            type="button"
            class="switch"
            role="switch"
            aria-labelledby="sw-controls"
            [attr.aria-checked]="prefs().controlsAlwaysVisible"
            (click)="data.setPrefs({ controlsAlwaysVisible: !prefs().controlsAlwaysVisible })"
          ></button
        ></span>
      </div>
      <div class="switch-row">
        <span id="sw-motion">Kurangi gerakan</span>
        <span class="hit"
          ><button
            type="button"
            class="switch"
            role="switch"
            aria-labelledby="sw-motion"
            [attr.aria-checked]="prefs().motion === 'reduce'"
            (click)="data.setPrefs({ motion: prefs().motion === 'reduce' ? 'system' : 'reduce' })"
          ></button
        ></span>
      </div>
      <div class="switch-row">
        <span id="sw-contrast">Kontras tinggi antarmuka</span>
        <span class="hit"
          ><button
            type="button"
            class="switch"
            role="switch"
            aria-labelledby="sw-contrast"
            [attr.aria-checked]="prefs().highContrast"
            (click)="data.setPrefs({ highContrast: !prefs().highContrast })"
          ></button
        ></span>
      </div>
    </section>

    <section aria-label="Lainnya">
      <button type="button" class="row" (click)="openTour()">
        <span>Panduan gestur</span><span class="end chev" aria-hidden="true">›</span>
      </button>
      <button type="button" class="row" (click)="ui.openSheet('offline')">
        <span>Offline &amp; unduhan</span
        ><span class="end"
          >{{ offlineSummary() }} <span class="chev" aria-hidden="true">›</span></span
        >
      </button>
      @if (sync.available) {
        <button type="button" class="row" (click)="ui.openSheet('account')">
          <span>Akun &amp; sinkronisasi</span
          ><span class="end"
            >{{ accountSummary() }} <span class="chev" aria-hidden="true">›</span></span
          >
        </button>
      }
      <button type="button" class="row" (click)="exportData()">
        <span>Ekspor data</span><span class="end">JSON</span>
      </button>
      <button type="button" class="row" (click)="fileInput.click()">
        <span>Impor data</span><span class="end">JSON</span>
      </button>
      <input
        #fileInput
        type="file"
        accept=".json,application/json"
        class="mf-visually-hidden"
        tabindex="-1"
        aria-label="Pilih berkas impor"
        (change)="importFile($event)"
      />
      <button type="button" class="row" (click)="ui.openSheet('about')">
        <span>Tentang &amp; lisensi</span
        ><span class="end">{{ buildLabel }} <span class="chev" aria-hidden="true">›</span></span>
      </button>
    </section>
  `,
})
export class SettingsSheet {
  protected readonly buildLabel = buildLabel();
  protected readonly data = inject(UserDataApi);
  protected readonly ui = inject(ReaderUiService);
  protected readonly sync = inject(SyncApi);
  private readonly offline = inject(OfflineApi);

  protected readonly paperThemes = PAPER_THEMES;
  protected readonly uiThemes = UI_THEMES;
  protected readonly layouts = LAYOUTS;
  protected readonly prefs = this.data.prefs;

  protected readonly offlineSummary = computed(() => {
    const s = this.offline.status();
    if (s.state === 'downloading') return 'Mengunduh…';
    return s.totalPages > 0 && s.cachedPages >= s.totalPages
      ? 'Lengkap'
      : `${s.cachedPages}/${s.totalPages} hal.`;
  });

  /** Prominent prompt to make every page available offline, until the package is complete. */
  protected readonly offlineCta = computed(() => {
    const s = this.offline.status();
    if (s.totalPages === 0 || s.cachedPages >= s.totalPages) return null;
    const remaining = Math.max(0, s.totalBytes - s.cachedBytes);
    return {
      cached: s.cachedPages,
      total: s.totalPages,
      percent: Math.round((s.cachedPages / s.totalPages) * 100),
      downloading: s.state === 'downloading',
      label:
        s.state === 'paused' || s.cachedPages > 0
          ? `Unduh semua halaman (sisa ≈ ${formatMb(remaining)})`
          : `Unduh semua halaman (≈ ${formatMb(s.totalBytes)})`,
    };
  });

  /** Starts (or resumes) the full download and shows its progress. */
  protected downloadAll(): void {
    const s = this.offline.status();
    if (s.state !== 'downloading') {
      const run = s.state === 'paused' ? this.offline.resume() : this.offline.startFullDownload();
      void run.catch(() => undefined);
    }
    this.ui.openSheet('offline');
  }

  protected readonly accountSummary = computed(() => {
    if (!this.sync.account()) return 'Belum masuk';
    return SYNC_LABEL[this.sync.status()] ?? '';
  });

  protected openTour(): void {
    this.ui.closeSheet();
    this.ui.tourOpen.set(true);
  }

  protected async exportData(): Promise<void> {
    try {
      const blob = await this.data.exportJson();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.ui.showToast({ message: 'Ekspor data gagal.' });
    }
  }

  protected async importFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const r = await this.data.importJson(file);
      this.ui.showToast({ message: importSummary(r) });
    } catch (e) {
      this.ui.showToast({ message: e instanceof Error ? e.message : 'Impor data gagal.' });
    }
  }
}

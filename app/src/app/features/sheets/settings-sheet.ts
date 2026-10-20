import { buildLabel } from '../../core/build-info';
import { AudioService } from '../../core/audio/audio.service';
import { AudioOfflineApi } from '../../core/audio/audio-offline.api';
import { AUDIO_MODES } from '../shell/audio-labels';
import {
  offlineAudioSummary,
  surahsFullyStored,
  totalStored,
} from '../shell/audio-offline-helpers';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentApi, OfflineApi, SyncApi, UserDataApi } from '../../core/contracts';
import { LayoutMode, NightAuto, NightMode, isHHMM } from '../../core/models';
import { ProgressService } from '../../core/progress/progress.service';
import { LineRulesService } from '../../core/line-rules.service';
import { InstallService } from '../../core/install.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { PAPER_THEMES, ThemeService, UI_THEMES } from '../../core/theme.service';
import { exportFilename, formatMb, importSummary } from '../shell/format';
import { useSearchFocusTarget } from './focus-target';
import { SHEET_STYLES } from './sheet-styles';
import { WAKE_OPTIONS, WakeLockService } from '../../core/wake-lock.service';

const LAYOUTS: { id: LayoutMode; label: string }[] = [
  { id: 'auto', label: 'Otomatis' },
  { id: 'single', label: '1 halaman' },
  { id: 'spread', label: '2 halaman' },
];

const NIGHT_OPTIONS: { id: NightMode; label: string }[] = [
  { id: 'off', label: 'Mati' },
  { id: 'on', label: 'Nyala' },
  { id: 'auto', label: 'Otomatis' },
];
const NIGHT_AUTO_OPTIONS: { id: NightAuto; label: string }[] = [
  { id: 'system', label: 'Ikuti perangkat' },
  { id: 'schedule', label: 'Jadwal' },
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
  styles: [
    SHEET_STYLES,
    `
      .time-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px; color: var(--ui-ink2); }
      .time { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .time-row .mf-input { min-width: 0; }
      .is-inactive { opacity: 0.45; }
    `,
  ],
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

    <section aria-labelledby="st-night" data-search-id="night">
      <h3 id="st-night">Mode malam</h3>
      <div class="mf-segmented" role="group" aria-labelledby="st-night">
        @for (n of nightOptions; track n.id) {
          <button
            type="button"
            [attr.aria-pressed]="prefs().nightMode === n.id"
            (click)="data.setPrefs({ nightMode: n.id })"
          >
            {{ n.label }}
          </button>
        }
      </div>
      @if (prefs().nightMode === 'auto') {
        <div class="mf-segmented" role="group" aria-label="Sumber mode malam otomatis">
          @for (a of nightAutoOptions; track a.id) {
            <button
              type="button"
              [attr.aria-pressed]="prefs().nightAuto === a.id"
              (click)="data.setPrefs({ nightAuto: a.id })"
            >
              {{ a.label }}
            </button>
          }
        </div>
        @if (prefs().nightAuto === 'schedule') {
          <div class="time-row">
            <div class="time">
            <label for="night-start">Mulai</label>
            <input
              id="night-start"
              class="mf-input"
              type="time"
              step="900"
              [value]="prefs().nightStart"
              (change)="setTime('nightStart', $event)"
            />
            </div>
            <div class="time">
            <label for="night-end">Selesai</label>
            <input
              id="night-end"
              class="mf-input"
              type="time"
              step="900"
              [value]="prefs().nightEnd"
              (change)="setTime('nightEnd', $event)"
            />
            </div>
          </div>
        }
      }
      <p class="muted" aria-live="polite">
        @if (theme.nightActive()) {
          Mode malam sedang menyala.
        } @else {
          Mode malam sedang mati.
        }
        @if (prefs().nightMode === 'auto') {
          @if (prefs().nightAuto === 'system') {
            Mengikuti pengaturan terang/gelap perangkat.
          } @else {
            Menyala otomatis pukul {{ prefs().nightStart }} sampai {{ prefs().nightEnd }}.
          }
        }
      </p>
    </section>

    <section aria-labelledby="st-paper" data-search-id="paper">
      <h3 id="st-paper">Warna kertas</h3>
      @if (theme.nightActive()) {
        <p class="muted">Warna kertas tidak berlaku saat mode malam.</p>
      }
      <div class="grid3" [class.is-inactive]="theme.nightActive()">
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

    <section aria-labelledby="st-ui" data-search-id="ui-theme">
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

    <section aria-labelledby="st-layout" data-search-id="layout">
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

    <section aria-labelledby="st-audio" data-search-id="audio">
      <h3 id="st-audio">Audio</h3>
      <div class="row" style="cursor: default">
        <span>Qari</span><span class="end">{{ audio.qari.name }}</span>
      </div>
      <div class="mf-segmented" role="group" aria-label="Mode putar">
        @for (m of audioModes; track m.id) {
          <button
            type="button"
            [attr.aria-pressed]="audio.mode() === m.id"
            (click)="audio.setMode(m.id)"
          >
            {{ m.label }}
          </button>
        }
      </div>
      <div class="switch-row" data-search-id="audio-follow">
        <span id="sw-follow">Ikuti bacaan (balik halaman otomatis)</span>
        <span class="hit"
          ><button
            type="button"
            class="switch"
            role="switch"
            aria-labelledby="sw-follow"
            [attr.aria-checked]="audio.follow()"
            (click)="audio.setFollow(!audio.follow())"
          ></button
        ></span>
      </div>
      @if (audioOffline.supported().length > 0 && audioOffline.manifest()) {
        <button type="button" class="row" (click)="ui.openSheet('offline')">
          <span>Audio offline</span
          ><span class="end"
            >{{ audioOfflineSummary() }} <span class="chev" aria-hidden="true">›</span></span
          >
        </button>
      }
      <p class="muted">
        Audio diputar online dan butuh koneksi internet, kecuali surah yang sudah disimpan untuk
        offline.
      </p>
    </section>

    <section aria-label="Tampilan">
      <div class="switch-row" data-search-id="controls">
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
      <div class="switch-row" data-search-id="line-rules">
        <span
          ><span id="sw-line-rules">Garis antarbaris</span
          ><small id="sw-line-rules-d" style="display: block; color: var(--ui-muted); font-size: 12.5px"
            >Garis tipis pemisah antarbaris di halaman mushaf.</small
          ></span
        >
        <span class="hit"
          ><button
            type="button"
            class="switch"
            role="switch"
            aria-labelledby="sw-line-rules"
            aria-describedby="sw-line-rules-d"
            [attr.aria-checked]="lineRules.enabled()"
            (click)="lineRules.set(!lineRules.enabled())"
          ></button
        ></span>
      </div>
      <div class="switch-row" data-search-id="motion">
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
      <div class="switch-row" data-search-id="contrast">
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
      <div class="row" style="cursor: default">
        <span id="wake-label">Layar tetap menyala</span>
      </div>
      <div class="mf-segmented" role="group" aria-labelledby="wake-label" data-search-id="wake">
        @for (w of wakeOptions; track w.id) {
          <button
            type="button"
            [attr.aria-pressed]="wake.mode() === w.id"
            [disabled]="!wake.supported"
            (click)="wake.setMode(w.id)"
          >
            {{ w.label }}
          </button>
        }
      </div>
      <p class="muted">
        @if (wake.supported) {
          Layar tidak padam selama membaca, sampai tidak ada interaksi sesuai waktu yang dipilih.
          Selama audio diputar layar tetap menyala.
        } @else {
          Browser ini belum mendukung; atur waktu layar mati di pengaturan perangkat.
        }
      </p>
    </section>

    <section aria-label="Progres membaca">
      <div class="switch-row" data-search-id="progress-track">
        <span id="sw-progress">Catat progres membaca</span>
        <span class="hit"
          ><button
            type="button"
            class="switch"
            role="switch"
            aria-labelledby="sw-progress"
            [attr.aria-checked]="progress.enabled()"
            (click)="progress.setEnabled(!progress.enabled())"
          ></button
        ></span>
      </div>
      @if (confirmClear()) {
        <div class="panel warn" role="alertdialog" aria-labelledby="clr-t" aria-describedby="clr-d">
          <strong id="clr-t">Hapus riwayat baca?</strong>
          <p id="clr-d">
            Semua halaman yang tercatat dibaca dan khatam dihapus dari perangkat ini{{
              sync.account() ? ' dan dari akunmu' : ''
            }}. Penanda tidak ikut terhapus.
          </p>
          <div class="actions">
            <button type="button" class="mf-btn mf-btn--outline" (click)="confirmClear.set(false)">
              Batal
            </button>
            <button type="button" class="mf-btn mf-btn--danger" (click)="clearHistory()">
              Hapus riwayat
            </button>
          </div>
        </div>
      } @else {
        <button
          type="button"
          class="row danger"
          data-search-id="progress-clear"
          (click)="confirmClear.set(true)"
        >
          <span>Hapus riwayat baca</span>
        </button>
      }
      <p class="muted">
        Halaman dihitung terbaca setelah beberapa detik tampil di layar. Progres tersimpan di
        perangkat ini{{ sync.account() ? ' dan ikut tersinkron ke akunmu' : '' }}.
      </p>
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
      <button type="button" class="row" data-search-id="export" (click)="exportData()">
        <span>Ekspor data</span><span class="end">JSON</span>
      </button>
      <button type="button" class="row" data-search-id="import" (click)="fileInput.click()">
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
      @if (install.state() !== 'installed') {
        <button type="button" class="row" (click)="ui.closeSheet(); install.openModal()">
          <span>Pasang ke perangkat</span><span class="end chev" aria-hidden="true">›</span>
        </button>
      }
      <button type="button" class="row" (click)="ui.openSheet('feedback')">
        <span>Kirim masukan</span><span class="end chev" aria-hidden="true">›</span>
      </button>
      <button type="button" class="row" (click)="ui.openSheet('about')">
        <span>Tentang &amp; lisensi</span
        ><span class="end">{{ buildLabel }} <span class="chev" aria-hidden="true">›</span></span>
      </button>
    </section>
  `,
})
export class SettingsSheet {
  constructor() {
    useSearchFocusTarget();
  }

  protected readonly buildLabel = buildLabel();
  protected readonly audio = inject(AudioService);
  protected readonly audioModes = AUDIO_MODES;
  protected readonly audioOffline = inject(AudioOfflineApi);
  private readonly content = inject(ContentApi);
  protected readonly audioOfflineSummary = computed(() => {
    const per = this.audioOffline.perSurah();
    const counts = this.content.index()?.surahs.map((s) => s.ayahCount) ?? [];
    return offlineAudioSummary(
      this.audioOffline.variant(),
      surahsFullyStored(per, counts),
      totalStored(per),
    );
  });
  protected readonly data = inject(UserDataApi);
  protected readonly ui = inject(ReaderUiService);
  protected readonly sync = inject(SyncApi);
  private readonly offline = inject(OfflineApi);
  protected readonly install = inject(InstallService);
  protected readonly wake = inject(WakeLockService);
  protected readonly lineRules = inject(LineRulesService);
  protected readonly wakeOptions = WAKE_OPTIONS;
  protected readonly progress = inject(ProgressService);
  protected readonly confirmClear = signal(false);

  protected readonly theme = inject(ThemeService);
  protected readonly nightOptions = NIGHT_OPTIONS;
  protected readonly nightAutoOptions = NIGHT_AUTO_OPTIONS;
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

  protected async clearHistory(): Promise<void> {
    this.confirmClear.set(false);
    try {
      const undo = await this.progress.clearHistory();
      this.ui.showToast({
        message: 'Riwayat baca dihapus',
        actionLabel: 'Urungkan',
        action: () =>
          void undo().then((ok) => {
            if (!ok) this.ui.showToast({ message: 'Riwayat tidak dapat dipulihkan lagi.' });
          }),
        duration: 8000,
      });
    } catch {
      this.ui.showToast({ message: 'Riwayat baca gagal dihapus.' });
    }
  }

  protected setTime(key: 'nightStart' | 'nightEnd', ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    if (isHHMM(v)) void this.data.setPrefs({ [key]: v });
    else (ev.target as HTMLInputElement).value = this.prefs()[key];
  }

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

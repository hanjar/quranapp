import { QCF_ATTRIBUTION } from '../reader/qcf-logic';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { UpdateService } from '../../core/update.service';
import { withTimeout } from '../../core/async';
import { AudioService } from '../../core/audio/audio.service';
import { BUILD_INFO } from '../../core/build-info';
import { ContentApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { formatDateTime } from '../shell/format';
import { useSearchFocusTarget } from './focus-target';
import { SHEET_STYLES } from './sheet-styles';

/** Body of the "Tentang dan lisensi" sheet. */
@Component({
  selector: 'app-about-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: SHEET_STYLES,
  template: `
    <section aria-label="Aplikasi">
      <h2 class="mf-display" style="margin: 0; font-size: 28px; font-weight: 500">
        Mushaf Digital
      </h2>
      <p class="muted">Bacaan yang tenang, setia pada halaman mushaf cetak.</p>
    </section>

    <section aria-label="Versi aplikasi">
      <h3>Versi aplikasi</h3>
      <dl>
        <dt>Versi</dt>
        <dd>{{ build.version }}</dd>
        <dt>Build</dt>
        <dd>
          @if (build.sha !== 'dev' && !build.sha.startsWith('unknown')) {
            <a
              class="link"
              [href]="'https://github.com/hanjar/quranapp/commit/' + commitOf(build.sha)"
              target="_blank"
              rel="noopener noreferrer"
              >{{ build.sha }}</a
            >
          } @else {
            {{ build.sha }}
          }
        </dd>
        <dt>Dibangun</dt>
        <dd>{{ builtAt }}</dd>
      </dl>
      <button
        type="button"
        class="mf-btn mf-btn--outline"
        data-search-id="about-update"
        [disabled]="checking()"
        (click)="checkForUpdate()"
      >
        {{
          checking()
            ? 'Memeriksa…'
            : updates.available()
              ? 'Versi baru siap · Muat ulang'
              : 'Periksa pembaruan'
        }}
      </button>
      <p class="muted">Aplikasi memeriksa pembaruan otomatis saat dibuka dan setiap 30 menit.</p>
      @if (updateNote(); as note) {
        <p class="muted" role="status">{{ note }}</p>
      }
    </section>

    <section aria-label="Edisi konten">
      <h3>Edisi konten</h3>
      @if (edition(); as e) {
        <dl>
          <dt>Riwayat</dt>
          <dd>Hafs, Mushaf Madinah (KFQC)</dd>
          <dt>Halaman</dt>
          <dd>{{ e.pageCount }}</dd>
          <dt>Versi konten</dt>
          <dd>{{ e.contentVersion }}</dd>
          <dt>Sumber</dt>
          <dd>
            <a
              class="link"
              [href]="repoUrl(e.source.repo)"
              target="_blank"
              rel="noopener noreferrer"
              >{{ e.source.repo }}</a
            >
            · {{ e.source.commit }}
          </dd>
          <dt>Lisensi karya</dt>
          <dd>{{ e.license.artwork }}</dd>
          <dt>Lisensi metadata</dt>
          <dd>{{ e.license.metadata }}</dd>
        </dl>
        <p class="muted">{{ e.attribution }}</p>
      } @else {
        <p class="muted">Informasi edisi belum tersedia.</p>
      }
    </section>

    <section aria-label="Atribusi tampilan tajwid">
      <h3>Tampilan tajwid berwarna (eksperimen)</h3>
      <p class="muted">{{ qcfCredit }}. Font tidak disertakan dalam aplikasi; dimuat dari Quran Foundation saat tampilan ini dipakai.</p>
    </section>

    <section aria-label="Atribusi audio">
      <h3>Audio</h3>
      <p class="muted">{{ audio.qari.attribution }}</p>
    </section>

    <section aria-label="Keutuhan teks">
      <h3>Keutuhan teks</h3>
      <p>
        Teks Al-Qur'an ditampilkan apa adanya dari gambar halaman mushaf: tidak pernah diubah,
        diketik ulang, atau disusun ulang. Tampilan hanya menambahkan lapisan interaksi di atasnya.
        Karya seni halaman © King Fahd Complex untuk Pencetakan Mushaf Madinah.
      </p>
    </section>

    <section aria-label="Kode sumber terbuka">
      <h3>Kode sumber terbuka</h3>
      <p>
        Kode aplikasi berlisensi MIT.
        <a
          class="link"
          href="https://github.com/hanjar/quranapp"
          target="_blank"
          rel="noopener noreferrer"
          >github.com/hanjar/quranapp</a
        >
      </p>
    </section>

    <section aria-label="Masukan">
      <h3>Masukan</h3>
      <p>Punya saran atau menemukan masalah? Kami senang mendengarnya.</p>
      <button type="button" class="mf-btn mf-btn--outline" (click)="ui.openSheet('feedback')">
        Kirim masukan
      </button>
    </section>

    <section aria-label="Privasi" data-search-id="about-privacy">
      <h3>Privasi</h3>
      <p>
        Posisi baca, penanda, dan preferensi disimpan di perangkat ini. Bila Anda mengaktifkan
        sinkronisasi, hanya ketiganya yang dikirim ke cloud. Tanpa iklan, tanpa pelacakan.
        <a class="link" href="/privasi" target="_blank" rel="noopener">Kebijakan privasi lengkap</a>
      </p>
    </section>
  `,
})
export class AboutSheet {
  constructor() {
    useSearchFocusTarget();
  }

  private readonly content = inject(ContentApi);
  protected readonly qcfCredit = QCF_ATTRIBUTION;
  protected readonly audio = inject(AudioService);
  private readonly sw = inject(SwUpdate);
  protected readonly updates = inject(UpdateService);
  protected readonly ui = inject(ReaderUiService);
  protected readonly build = BUILD_INFO;
  protected readonly builtAt = BUILD_INFO.builtAt
    ? formatDateTime(Date.parse(BUILD_INFO.builtAt))
    : 'mode pengembangan';
  protected readonly checking = signal(false);
  protected readonly updateNote = signal<string | null>(null);
  protected edition = () => this.content.index()?.edition ?? null;

  /** "9118c86-dirty" -> "9118c86" for the GitHub commit link. */
  protected commitOf(sha: string): string {
    return sha.replace(/-dirty$/, '');
  }

  /**
   * Asks the service worker for a newer version; when one is ready it is
   * activated and the page reloads, so a stale cached app never lingers.
   */
  protected async checkForUpdate(): Promise<void> {
    if (!this.sw.isEnabled) {
      this.updateNote.set('Pembaruan otomatis tidak aktif di mode pengembangan.');
      return;
    }
    // First visit after install: the worker is registered but not yet in control,
    // and checkForUpdate() can wait indefinitely. A reload hands control to it.
    if (!navigator.serviceWorker?.controller) {
      this.ui.showToast({ message: 'Memuat ulang ke versi terbaru…', duration: 3000 });
      document.location.reload();
      return;
    }
    this.checking.set(true);
    this.updateNote.set(null);
    try {
      // Already downloaded in the background: checkForUpdate() would say "none".
      if (this.updates.available()) {
        this.ui.showToast({ message: 'Memasang versi terbaru…', duration: 3000 });
        await this.updates.reload();
        return;
      }
      const found = await withTimeout(this.updates.check(true), 10_000);
      if (found) {
        this.ui.showToast({ message: 'Memasang versi terbaru…', duration: 3000 });
        await withTimeout(this.sw.activateUpdate(), 10_000);
        document.location.reload();
        return;
      }
      this.updateNote.set('Anda sudah memakai versi terbaru.');
    } catch {
      this.updateNote.set('Tidak dapat memeriksa pembaruan. Periksa koneksi lalu coba lagi.');
    } finally {
      this.checking.set(false);
    }
  }

  protected repoUrl(repo: string): string {
    return /^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`;
  }
}

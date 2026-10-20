import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ContentApi } from '../../core/contracts';
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
      <p class="muted">
        Versi {{ version }} · Bacaan yang tenang, setia pada halaman mushaf cetak.
      </p>
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

    <section aria-label="Privasi">
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
  private readonly content = inject(ContentApi);
  protected readonly version = '0.1.0';
  protected edition = () => this.content.index()?.edition ?? null;

  protected repoUrl(repo: string): string {
    return /^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`;
  }
}

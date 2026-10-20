import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { OfflineApi } from '../../core/contracts';
import { formatMb } from '../shell/format';
import { SHEET_STYLES } from './sheet-styles';

/** Body of the "Offline dan unduhan" sheet. Uses OfflineApi only. */
@Component({
  selector: 'app-offline-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: SHEET_STYLES,
  template: `
    <section aria-label="Status koneksi">
      <div class="who">
        <span class="status-dot" [class.off]="!s().online" aria-hidden="true"></span>
        <span role="status">{{
          s().online ? 'Tersambung' : 'Offline · halaman yang sudah diunduh tetap bisa dibaca'
        }}</span>
      </div>
    </section>

    <section aria-label="Kemajuan unduhan">
      <div class="panel">
        <strong
          >Siap dibaca offline: {{ s().cachedPages }} dari
          {{ s().totalPages || 604 }} halaman</strong
        >
        <div
          class="bar"
          role="progressbar"
          aria-label="Halaman siap offline"
          aria-valuemin="0"
          [attr.aria-valuemax]="s().totalPages || 604"
          [attr.aria-valuenow]="s().cachedPages"
        >
          <span [style.width.%]="percent()"></span>
        </div>
        <p class="muted">
          Ruang terpakai: {{ mb(s().cachedBytes) }} dari perkiraan
          {{ s().totalBytes ? mb(s().totalBytes) : 'ukuran paket belum diketahui' }} untuk seluruh
          mushaf.
        </p>
        @if (s().state === 'downloading') {
          <p role="status">Mengunduh halaman…</p>
        }
        @if (s().state === 'quota') {
          <div class="mf-note" role="alert">
            <strong>Ruang penyimpanan penuh.</strong> Unduhan dihentikan. Kosongkan ruang di
            perangkat atau hapus unduhan, lalu coba lagi.
          </div>
        }
        @if (s().state === 'error' || s().failedPages.length > 0) {
          <div class="mf-note" role="alert">
            {{ s().failedPages.length }} halaman gagal diunduh. Periksa koneksi lalu coba lagi.
          </div>
        }
      </div>
    </section>

    <section aria-label="Aksi unduhan">
      @if (confirmClear()) {
        <div class="panel warn" role="alertdialog" aria-label="Hapus unduhan">
          <strong>Hapus semua halaman yang diunduh?</strong>
          <p>
            Penanda dan posisi baca tetap tersimpan. Halaman akan diunduh lagi saat dibaca dengan
            koneksi.
          </p>
          <div class="actions">
            <button type="button" class="mf-btn mf-btn--outline" (click)="confirmClear.set(false)">
              Batal
            </button>
            <button type="button" class="mf-btn mf-btn--danger" (click)="clear()">
              Hapus unduhan
            </button>
          </div>
        </div>
      } @else {
        <div class="actions">
          @switch (s().state) {
            @case ('downloading') {
              <button type="button" class="mf-btn mf-btn--outline" (click)="offline.pause()">
                Jeda
              </button>
            }
            @case ('paused') {
              <button type="button" class="mf-btn mf-btn--primary" (click)="offline.resume()">
                Lanjutkan
              </button>
            }
            @default {
              @if (!complete()) {
                <button
                  type="button"
                  class="mf-btn mf-btn--primary"
                  [disabled]="!s().online"
                  (click)="offline.startFullDownload()"
                >
                  Unduh seluruh mushaf
                  @if (s().totalBytes) {
                    (≈ {{ mb(s().totalBytes) }})
                  }
                </button>
              }
            }
          }
          @if (s().failedPages.length > 0 && s().state !== 'downloading') {
            <button
              type="button"
              class="mf-btn mf-btn--outline"
              [disabled]="!s().online"
              (click)="offline.retryFailed()"
            >
              Coba lagi halaman gagal
            </button>
          }
          @if (s().cachedPages > 0 && s().state !== 'downloading') {
            <button type="button" class="mf-btn mf-btn--ghost" (click)="confirmClear.set(true)">
              Hapus unduhan
            </button>
          }
        </div>
        @if (!s().online && !complete()) {
          <p class="muted">Sambungkan ke internet untuk mengunduh.</p>
        }
      }
    </section>

    <section aria-label="Catatan penyimpanan">
      @if (s().persisted === true) {
        <p class="muted">
          Penyimpanan ini ditandai permanen oleh peramban, sehingga lebih kecil kemungkinan
          dibersihkan otomatis.
        </p>
      } @else if (s().persisted === false) {
        <p class="muted">
          Penyimpanan belum dijamin permanen. Peramban dapat membersihkan cache saat ruang perangkat
          menipis.
        </p>
      }
      <p class="muted">
        Peramban dapat menghapus cache kapan saja. Jika halaman tidak lagi tersedia offline, unduh
        ulang saat tersambung.
      </p>
    </section>
  `,
})
export class OfflineSheet {
  protected readonly offline = inject(OfflineApi);
  protected readonly s = this.offline.status;
  protected readonly confirmClear = signal(false);
  protected readonly mb = formatMb;

  protected readonly percent = computed(() => {
    const st = this.s();
    return st.totalPages > 0 ? Math.min(100, (st.cachedPages / st.totalPages) * 100) : 0;
  });
  protected readonly complete = computed(() => {
    const st = this.s();
    return st.totalPages > 0 && st.cachedPages >= st.totalPages;
  });

  constructor() {
    void this.offline.refresh();
  }

  protected async clear(): Promise<void> {
    await this.offline.clearPages();
    this.confirmClear.set(false);
  }
}

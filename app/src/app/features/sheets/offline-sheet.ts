import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AudioOfflineApi, AudioScope, AudioVariant } from '../../core/audio/audio-offline.api';
import { TafsirService, TafsirSizeInfo } from '../../core/content/tafsir.service';
import { ContentApi, OfflineApi } from '../../core/contracts';
import {
  VARIANT_INFO,
  bytesProgress,
  changeQualityWarning,
  rowState,
  surahMatches,
  totalStored,
} from '../shell/audio-offline-helpers';
import { formatMb } from '../shell/format';
import { looksMetered } from '../shell/install-prompt';
import { useSearchFocusTarget } from './focus-target';
import { SHEET_STYLES } from './sheet-styles';

/** Body of the "Offline dan unduhan" sheet. Uses OfflineApi only. */
@Component({
  selector: 'app-offline-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  styles: [
    SHEET_STYLES,
    `
      .radios {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .radio {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: var(--mf-tap);
        padding: 10px 14px;
        border-radius: var(--mf-radius-lg);
        border: 1px solid var(--ui-line);
        background: transparent;
        text-align: left;
        color: var(--ui-ink);
      }
      .radio[aria-checked='true'] {
        border: 2px solid var(--ui-primary);
        padding: 9px 13px;
      }
      .radio .n {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 14.5px;
        font-weight: 600;
      }
      .radio .n small {
        font-weight: 400;
        font-size: 12.5px;
        color: var(--ui-muted);
      }
      .radio .sz {
        font-size: 13px;
        color: var(--ui-ink2);
        text-align: right;
      }
      details.fold > summary {
        min-height: var(--mf-tap);
        display: flex;
        align-items: center;
        cursor: pointer;
        font-size: 15px;
      }
      .list {
        display: flex;
        flex-direction: column;
        max-height: 320px;
        overflow-y: auto;
      }
      .arow {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        border-bottom: 1px solid var(--ui-hair);
        font-size: 14px;
      }
      .arow .nm {
        flex: 1;
        min-width: 0;
      }
      .arow .sz {
        font-size: 12.5px;
        color: var(--ui-muted);
        white-space: nowrap;
      }
      .tag {
        font-size: 12.5px;
        color: var(--ui-primary);
        white-space: nowrap;
        min-width: 64px;
        text-align: right;
      }
      .mini {
        min-height: 36px;
        padding: 0 12px;
        border-radius: 18px;
        border: 1px solid var(--ui-primary);
        background: transparent;
        color: var(--ui-primary);
        font-size: 13px;
      }
      .mini:disabled {
        opacity: 0.5;
      }
    `,
  ],
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

    <section aria-label="Aksi unduhan" data-search-id="offline-pages">
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

    @if (audio.supported().length > 0 && audio.manifest()) {
      <section aria-labelledby="au-h" data-search-id="offline-audio">
        <h3 id="au-h">Audio offline (Mishary Rasyid Alafasy)</h3>
        <p class="muted">
          Dengarkan bacaan tanpa internet. Ukuran perkiraan; mengunduh butuh koneksi internet.
        </p>
        @if (metered()) {
          <div class="mf-note">
            Sepertinya Anda memakai data seluler atau mode hemat data. Pertimbangkan mengunduh lewat
            Wi-Fi.
          </div>
        }

        <div class="radios" role="radiogroup" aria-label="Kualitas audio offline">
          @for (v of audio.supported(); track v) {
            <button
              type="button"
              class="radio"
              role="radio"
              [attr.aria-checked]="audio.variant() === v"
              (click)="pickVariant(v)"
            >
              <span class="n"
                >{{ info[v].label }}<small>{{ info[v].format }}</small></span
              >
              <span class="sz"
                >≈ {{ mb(audio.sizeOf({ kind: 'all' }, v)) }}<br />seluruh mushaf</span
              >
            </button>
          }
        </div>

        @if (pendingVariant(); as pv) {
          <div class="panel warn" role="alertdialog" aria-label="Ganti kualitas audio">
            <strong>Ganti ke {{ info[pv].label }}?</strong>
            <p>{{ qualityWarning() }}</p>
            <div class="actions">
              <button
                type="button"
                class="mf-btn mf-btn--outline"
                (click)="pendingVariant.set(null)"
              >
                Batal
              </button>
              <button type="button" class="mf-btn mf-btn--primary" (click)="confirmVariant()">
                Ganti kualitas
              </button>
            </div>
          </div>
        }

        <div class="panel">
          <strong
            >Tersimpan: {{ storedAyahs() }} dari {{ totalAyahs }} ayat ·
            {{ mb(audio.usedBytes()) }}</strong
          >
          @if (a().state === 'downloading' || a().state === 'paused') {
            <div
              class="bar"
              role="progressbar"
              aria-label="Kemajuan unduhan audio"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="audioPercent()"
            >
              <span [style.width.%]="audioPercent()"></span>
            </div>
            <p class="muted" role="status">
              {{ a().state === 'paused' ? 'Dijeda · ' : 'Mengunduh · ' }}{{ audioBytes() }}
            </p>
          }
          @if (a().state === 'quota') {
            <div class="mf-note" role="alert">
              <strong>Ruang penyimpanan penuh.</strong> Unduhan audio dihentikan.
            </div>
          }
          @if (a().state === 'error' || a().failed > 0) {
            <div class="mf-note" role="alert">
              {{ a().failed }} berkas audio gagal diunduh. Periksa koneksi lalu coba lagi.
            </div>
          }
        </div>

        @if (confirmAudioClear()) {
          <div class="panel warn" role="alertdialog" aria-label="Hapus audio offline">
            <strong>Hapus semua audio offline?</strong>
            <p>
              Bacaan tetap bisa diputar lewat internet. Halaman mushaf dan penanda tidak
              terpengaruh.
            </p>
            <div class="actions">
              <button
                type="button"
                class="mf-btn mf-btn--outline"
                (click)="confirmAudioClear.set(false)"
              >
                Batal
              </button>
              <button type="button" class="mf-btn mf-btn--danger" (click)="clearAudio()">
                Hapus audio offline
              </button>
            </div>
          </div>
        } @else {
          <div class="actions">
            @switch (a().state) {
              @case ('downloading') {
                <button type="button" class="mf-btn mf-btn--outline" (click)="audio.pause()">
                  Jeda
                </button>
              }
              @case ('paused') {
                <button type="button" class="mf-btn mf-btn--primary" (click)="audio.resume()">
                  Lanjutkan
                </button>
              }
              @default {
                @if (storedAyahs() < totalAyahs) {
                  <button
                    type="button"
                    class="mf-btn mf-btn--primary"
                    [disabled]="!s().online"
                    (click)="audio.download({ kind: 'all' })"
                  >
                    Unduh semua (≈ {{ mb(audio.sizeOf({ kind: 'all' })) }})
                  </button>
                }
              }
            }
            @if (storedAyahs() > 0 && a().state !== 'downloading') {
              <button
                type="button"
                class="mf-btn mf-btn--ghost"
                (click)="confirmAudioClear.set(true)"
              >
                Hapus audio offline
              </button>
            }
          </div>
          @if (!s().online && storedAyahs() < totalAyahs) {
            <p class="muted">Sambungkan ke internet untuk mengunduh audio.</p>
          }
        }

        <details class="fold">
          <summary>Per juz</summary>
          <div class="list">
            @for (r of juzRows(); track r.id) {
              <ng-container *ngTemplateOutlet="row; context: { $implicit: r }" />
            }
          </div>
        </details>

        <details class="fold">
          <summary>Per surah</summary>
          <label class="mf-visually-hidden" for="au-q">Cari surah</label>
          <input
            id="au-q"
            class="mf-input"
            type="search"
            placeholder="Cari surah"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          <div class="list">
            @for (r of surahRows(); track r.id) {
              <ng-container *ngTemplateOutlet="row; context: { $implicit: r }" />
            } @empty {
              <p class="muted">Surah tidak ditemukan.</p>
            }
          </div>
        </details>

        <p class="muted">
          Peramban dapat membersihkan penyimpanan kapan saja; bila audio hilang, unduh ulang saat
          tersambung.
        </p>
      </section>

      <ng-template #row let-r>
        <div class="arow">
          <span class="nm">{{ r.label }}</span>
          <span class="sz">{{ mb(r.bytes) }}</span>
          @if (r.state.kind === 'done') {
            <span class="tag">Tersimpan ✓</span>
          } @else if (isActive(r.scope)) {
            <span class="tag" role="status">{{
              r.state.kind === 'partial' ? r.state.percent + '%' : 'Mengunduh…'
            }}</span>
          } @else {
            <button
              type="button"
              class="mini"
              [disabled]="!s().online || a().state === 'downloading'"
              [attr.aria-label]="
                'Unduh ' +
                r.label +
                (r.state.kind === 'partial' ? ' (' + r.state.percent + '% tersimpan)' : '')
              "
              (click)="audio.download(r.scope)"
            >
              {{ r.state.kind === 'partial' ? r.state.percent + '% · Lanjut' : 'Unduh' }}
            </button>
          }
        </div>
      </ng-template>
    }

    <section aria-labelledby="tf-h" data-search-id="offline-tafsir">
      <h3 id="tf-h">Tafsir offline (Kemenag RI)</h3>
      <p class="muted">
        Tafsir per ayat tidak ikut diunduh otomatis. Simpan semuanya agar bisa dibaca tanpa
        internet
        @if (tafsirInfo()?.totalBytes) {
          (≈ {{ mb(tafsirInfo()?.totalBytes ?? 0) }})
        }.
      </p>
      @if (tafsirBusy(); as p) {
        <div class="panel">
          <div
            class="bar"
            role="progressbar"
            aria-label="Unduhan tafsir"
            aria-valuemin="0"
            aria-valuemax="114"
            [attr.aria-valuenow]="p.done"
          >
            <span [style.width.%]="(p.done / 114) * 100"></span>
          </div>
          <p role="status">Mengunduh tafsir: {{ p.done }} dari 114 surah</p>
        </div>
      } @else if (tafsirDone()) {
        <p role="status"><strong>Tafsir tersimpan di perangkat ✓</strong> ({{ mb(tafsirInfo()?.cachedBytes ?? 0) }})</p>
      } @else if (tafsirInfo(); as ti) {
        @if (ti.cachedSurahs > 0) {
          <p class="muted">{{ ti.cachedSurahs }} dari {{ ti.totalSurahs }} surah tersimpan.</p>
        }
      }
      @if (tafsirError()) {
        <div class="mf-note" role="alert">{{ tafsirError() }}</div>
      }
      @if (confirmTafsirClear()) {
        <div class="panel warn" role="alertdialog" aria-label="Hapus tafsir offline">
          <strong>Hapus tafsir offline?</strong>
          <p>Tafsir tetap bisa dibaca saat tersambung internet. Penanda tidak terpengaruh.</p>
          <div class="actions">
            <button type="button" class="mf-btn mf-btn--outline" (click)="confirmTafsirClear.set(false)">
              Batal
            </button>
            <button type="button" class="mf-btn mf-btn--danger" (click)="clearTafsir()">
              Hapus tafsir offline
            </button>
          </div>
        </div>
      } @else {
        <div class="actions">
          @if (tafsirBusy()) {
            <button type="button" class="mf-btn mf-btn--outline" (click)="cancelTafsir()">
              Batalkan
            </button>
          } @else {
            @if (!tafsirDone()) {
              <button
                type="button"
                class="mf-btn mf-btn--primary"
                [disabled]="!s().online"
                (click)="downloadTafsir()"
              >
                {{ tafsirError() ? 'Coba lagi' : 'Unduh tafsir' }}
              </button>
            }
            @if ((tafsirInfo()?.cachedSurahs ?? 0) > 0) {
              <button type="button" class="mf-btn mf-btn--ghost" (click)="confirmTafsirClear.set(true)">
                Hapus tafsir offline
              </button>
            }
          }
        </div>
        @if (!s().online && !tafsirDone()) {
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

  // --- audio offline ---
  protected readonly audio = inject(AudioOfflineApi);
  private readonly content = inject(ContentApi);
  protected readonly info = VARIANT_INFO;
  protected readonly totalAyahs = 6236;
  protected readonly a = this.audio.status;
  protected readonly metered = signal(looksMetered());
  protected readonly pendingVariant = signal<AudioVariant | null>(null);
  protected readonly confirmAudioClear = signal(false);
  protected readonly query = signal('');

  protected readonly storedAyahs = computed(() => totalStored(this.audio.perSurah()));
  protected readonly qualityWarning = computed(() => changeQualityWarning(this.audio.usedBytes()));
  protected readonly audioPercent = computed(() => {
    const st = this.a();
    return st.bytesTotal > 0 ? Math.min(100, Math.round((st.bytesDone / st.bytesTotal) * 100)) : 0;
  });
  protected readonly audioBytes = computed(() =>
    bytesProgress(this.a().bytesDone, this.a().bytesTotal),
  );

  protected readonly juzRows = computed(() =>
    Array.from({ length: 30 }, (_, i) => this.makeRow({ kind: 'juz', id: i + 1 }, `Juz ${i + 1}`)),
  );
  protected readonly surahRows = computed(() => {
    const q = this.query();
    const list = this.content.index()?.surahs ?? [];
    return list
      .filter((s) => surahMatches(s, q))
      .map((s) => this.makeRow({ kind: 'surah', id: s.number }, `${s.number}. ${s.nameLatin}`));
  });

  private makeRow(scope: AudioScope, label: string) {
    this.audio.perSurah(); // re-evaluate as downloads progress
    this.audio.status();
    const p = this.audio.progressOf(scope);
    return {
      id: `${scope.kind}-${'id' in scope ? scope.id : 0}`,
      scope,
      label,
      bytes: this.audio.sizeOf(scope),
      state: rowState(p.done, p.total),
    };
  }

  protected isActive(scope: AudioScope): boolean {
    const st = this.a();
    const sc = st.scope;
    return (
      st.state === 'downloading' &&
      !!sc &&
      sc.kind === scope.kind &&
      ('id' in sc ? sc.id : 0) === ('id' in scope ? scope.id : 0)
    );
  }

  protected pickVariant(v: AudioVariant): void {
    if (v === this.audio.variant()) return;
    if (this.audio.usedBytes() > 0) this.pendingVariant.set(v);
    else void this.audio.setVariant(v);
  }

  protected async confirmVariant(): Promise<void> {
    const v = this.pendingVariant();
    this.pendingVariant.set(null);
    if (v) await this.audio.setVariant(v);
  }

  protected async clearAudio(): Promise<void> {
    await this.audio.remove({ kind: 'all' });
    this.confirmAudioClear.set(false);
  }

  protected readonly percent = computed(() => {
    const st = this.s();
    return st.totalPages > 0 ? Math.min(100, (st.cachedPages / st.totalPages) * 100) : 0;
  });
  protected readonly complete = computed(() => {
    const st = this.s();
    return st.totalPages > 0 && st.cachedPages >= st.totalPages;
  });

  private readonly tafsir = inject(TafsirService);
  protected readonly tafsirInfo = signal<TafsirSizeInfo | null>(null);
  protected readonly tafsirBusy = signal<{ done: number } | null>(null);
  protected readonly tafsirError = signal('');
  protected readonly confirmTafsirClear = signal(false);
  protected readonly tafsirDone = computed(() => {
    const i = this.tafsirInfo();
    return !!i && i.cachedSurahs === i.totalSurahs;
  });
  private tafsirAbort: AbortController | null = null;

  protected async refreshTafsir(): Promise<void> {
    this.tafsirInfo.set(await this.tafsir.sizeInfo());
  }

  protected async downloadTafsir(): Promise<void> {
    if (this.tafsirBusy()) return;
    const ctrl = new AbortController();
    this.tafsirAbort = ctrl;
    this.tafsirError.set('');
    this.tafsirBusy.set({ done: this.tafsirInfo()?.cachedSurahs ?? 0 });
    try {
      const r = await this.tafsir.downloadAll((done) => this.tafsirBusy.set({ done }), ctrl.signal);
      if (r.failed > 0 && !ctrl.signal.aborted) {
        this.tafsirError.set(`${r.failed} surah gagal diunduh. Periksa koneksi lalu coba lagi.`);
      }
    } catch {
      this.tafsirError.set('Tafsir gagal diunduh. Periksa koneksi atau ruang penyimpanan, lalu coba lagi.');
    } finally {
      this.tafsirAbort = null;
      this.tafsirBusy.set(null);
      await this.refreshTafsir();
    }
  }

  protected cancelTafsir(): void {
    this.tafsirAbort?.abort();
  }

  protected async clearTafsir(): Promise<void> {
    await this.tafsir.removeAll();
    this.confirmTafsirClear.set(false);
    await this.refreshTafsir();
  }

  constructor() {
    useSearchFocusTarget();
    void this.refreshTafsir();
    void this.offline.refresh();
    void this.audio.load();
    void this.content.load();
  }

  protected async clear(): Promise<void> {
    await this.offline.clearPages();
    this.confirmClear.set(false);
  }
}

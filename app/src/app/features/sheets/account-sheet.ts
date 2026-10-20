import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentApi, SyncApi, UserDataApi } from '../../core/contracts';
import { ReadingPosition, SyncStatus } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { exportFilename, formatRelativeTime } from '../shell/format';
import { SHEET_STYLES } from './sheet-styles';

type Confirm = 'signout' | 'delete' | null;

/** Body of the "Akun dan sinkronisasi" sheet. */
@Component({
  selector: 'app-account-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: SHEET_STYLES,
  template: `
    @if (!sync.available) {
      <div class="mf-note">
        Sinkronisasi cloud belum diatur pada versi ini. Semua data tersimpan di perangkat ini;
        gunakan Ekspor data di Pengaturan untuk mencadangkan.
      </div>
    } @else if (!sync.account()) {
      @if (step() === 'intro') {
        <section aria-label="Sinkronisasi">
          <p>
            Sinkronisasi bersifat opsional. Aktifkan bila ingin melanjutkan bacaan di perangkat
            lain.
          </p>
          <ul>
            <li>Lanjutkan membaca dari halaman terakhir di perangkat mana pun</li>
            <li>Penanda ikut tersimpan dan tidak hilang saat data peramban dibersihkan</li>
            <li>Pilihan tampilan terbawa ke perangkat lain</li>
          </ul>
          <div class="mf-note">
            Yang disimpan hanya posisi, penanda, dan preferensi. Tanpa iklan, tanpa pelacakan.
          </div>
          <div class="actions">
            <button type="button" class="mf-btn mf-btn--primary" (click)="step.set('login')">
              Aktifkan sinkronisasi
            </button>
            <button type="button" class="mf-btn mf-btn--ghost" (click)="ui.closeSheet()">
              Tetap sebagai tamu
            </button>
          </div>
        </section>
      } @else {
        <section aria-label="Masuk">
          <p>
            Masuk untuk mengaktifkan sinkronisasi. Bacaan lokal Anda tetap aman dan digabungkan
            dengan data cloud.
          </p>
          <button type="button" class="mf-btn mf-btn--primary" (click)="sync.signIn('google')">
            Lanjutkan dengan Google
          </button>
          @if (isLocalhost) {
            <div class="panel" aria-label="Masuk pengembangan">
              <span class="mf-eyebrow">Hanya pengembangan lokal</span>
              <label class="mf-visually-hidden" for="dev-email">Email</label>
              <input
                id="dev-email"
                class="mf-input"
                type="email"
                autocomplete="email"
                placeholder="dev@example.com"
                [value]="devEmail()"
                (input)="devEmail.set($any($event.target).value)"
              />
              <button
                type="button"
                class="mf-btn mf-btn--outline"
                [disabled]="!devEmail().trim() || busy()"
                (click)="devLogin()"
              >
                Masuk (dev)
              </button>
            </div>
          }
          @if (error()) {
            <div class="mf-note" role="alert">{{ error() }}</div>
          }
          <button type="button" class="mf-btn mf-btn--ghost" (click)="stayGuest()">
            Tetap sebagai tamu
          </button>
        </section>
      }
    } @else {
      <section aria-label="Akun">
        <div class="who">
          <span class="avatar" aria-hidden="true">{{ initial() }}</span>
          <div class="stack" style="gap: 2px; min-width: 0">
            <strong style="word-break: break-all">{{
              sync.account()?.email ?? sync.account()?.name
            }}</strong>
            <span class="muted" role="status">{{ statusLine() }}</span>
          </div>
        </div>
        <p class="muted">Sinkronisasi hanya mengirim perubahan, bukan setiap balikan halaman.</p>
      </section>

      @if (sync.conflict(); as c) {
        <section aria-label="Konflik posisi baca">
          <div class="panel warn">
            <strong>Perlu memilih posisi baca</strong>
            <p>
              Posisi di perangkat ini berbeda dengan yang tersimpan di cloud. Pilih yang ingin
              dipakai.
            </p>
            <button
              type="button"
              class="mf-btn mf-btn--outline"
              style="text-align: left; padding: 10px 16px"
              (click)="resolve('device')"
            >
              <strong>Gunakan posisi perangkat ini</strong><br /><span class="muted">{{
                describe(c.device)
              }}</span>
            </button>
            <button
              type="button"
              class="mf-btn mf-btn--outline"
              style="text-align: left; padding: 10px 16px"
              (click)="resolve('cloud')"
            >
              <strong>Gunakan posisi cloud</strong><br /><span class="muted">{{
                describe(c.cloud)
              }}</span>
            </button>
          </div>
        </section>
      }

      @if (sync.status() === 'unauthorized') {
        <section aria-label="Sesi berakhir">
          <div class="panel warn">
            <strong>Sesi berakhir</strong>
            <p>
              Hubungkan ulang akun agar perubahan terbaru bisa dikirim. Data di perangkat ini tidak
              hilang.
            </p>
            <button type="button" class="mf-btn mf-btn--primary" (click)="sync.signIn('google')">
              Hubungkan ulang
            </button>
          </div>
        </section>
      }

      <section aria-label="Tindakan akun">
        <button type="button" class="row" [disabled]="busy()" (click)="syncNow()">
          <span>Sinkronkan sekarang</span
          ><span class="end">{{ busy() ? 'Menyinkronkan…' : '' }}</span>
        </button>
        <button type="button" class="row" (click)="exportLocal()">
          <span>Ekspor data</span><span class="end">JSON</span>
        </button>

        @if (confirm() === 'signout') {
          <div class="panel" role="alertdialog" aria-label="Keluar">
            <strong>Keluar dari akun?</strong>
            <p>Pilih apa yang dilakukan dengan data di perangkat ini.</p>
            <div class="actions">
              <button type="button" class="mf-btn mf-btn--primary" (click)="signOut(false)">
                Keluar, simpan data lokal
              </button>
              <button type="button" class="mf-btn mf-btn--outline" (click)="signOut(true)">
                Keluar &amp; hapus data lokal
              </button>
              <button type="button" class="mf-btn mf-btn--ghost" (click)="confirm.set(null)">
                Batal
              </button>
            </div>
          </div>
        } @else {
          <button type="button" class="row" (click)="confirm.set('signout')">
            <span>Keluar</span>
          </button>
        }

        @if (confirm() === 'delete') {
          <div class="panel warn" role="alertdialog" aria-label="Hapus data cloud">
            <strong>Hapus data cloud?</strong>
            <p>
              Akun dan semua posisi, penanda, serta preferensi di cloud dihapus permanen. Data di
              perangkat ini tidak berubah.
            </p>
            <div class="actions">
              <button type="button" class="mf-btn mf-btn--outline" (click)="confirm.set(null)">
                Batal
              </button>
              <button
                type="button"
                class="mf-btn mf-btn--danger"
                [disabled]="busy()"
                (click)="deleteCloud()"
              >
                Hapus data cloud
              </button>
            </div>
          </div>
        } @else {
          <button type="button" class="row danger" (click)="confirm.set('delete')">
            <span>Hapus data cloud</span>
          </button>
        }
        @if (error()) {
          <div class="mf-note" role="alert">{{ error() }}</div>
        }
      </section>
    }
  `,
})
export class AccountSheet {
  protected readonly sync = inject(SyncApi);
  protected readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly data = inject(UserDataApi);

  protected readonly step = signal<'intro' | 'login'>('intro');
  protected readonly confirm = signal<Confirm>(null);
  protected readonly devEmail = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isLocalhost =
    typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

  protected readonly initial = computed(() => {
    const a = this.sync.account();
    return (a?.name ?? a?.email ?? '?').trim().charAt(0).toUpperCase() || '?';
  });

  protected readonly statusLine = computed(() =>
    statusText(this.sync.status(), this.sync.lastSuccessAt()),
  );

  protected describe(p: ReadingPosition): string {
    const idx = this.content.index();
    const name = idx ? this.content.surahAt(p.page).nameLatin : '';
    return `${name ? name + ', ' : ''}hal. ${p.page} · ${formatRelativeTime(p.updatedAt)}`;
  }

  protected stayGuest(): void {
    this.step.set('intro');
    this.ui.closeSheet();
  }

  protected async devLogin(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.sync.signInDev(this.devEmail().trim());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Masuk gagal.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async syncNow(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.sync.syncNow();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sinkronisasi gagal.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async resolve(choice: 'device' | 'cloud'): Promise<void> {
    await this.sync.resolveConflict(choice);
  }

  protected async exportLocal(): Promise<void> {
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
      this.error.set('Ekspor data gagal.');
    }
  }

  protected async signOut(clearLocal: boolean): Promise<void> {
    this.confirm.set(null);
    try {
      await this.sync.signOut({ clearLocal });
      this.step.set('intro');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Gagal keluar.');
    }
  }

  protected async deleteCloud(): Promise<void> {
    this.busy.set(true);
    try {
      await this.sync.deleteCloudData();
      this.confirm.set(null);
      this.ui.showToast({ message: 'Data cloud dihapus.' });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Gagal menghapus data cloud.');
    } finally {
      this.busy.set(false);
    }
  }
}

function statusText(s: SyncStatus, last: number | null): string {
  switch (s) {
    case 'off':
    case 'idle':
      return 'Siap';
    case 'pending':
      return 'Menunggu sinkronisasi';
    case 'syncing':
      return 'Menyinkronkan…';
    case 'synced':
      return last ? `Tersinkron · ${formatRelativeTime(last)}` : 'Tersinkron';
    case 'offline':
      return 'Offline · akan disinkronkan saat tersambung';
    case 'error':
      return 'Gagal · coba lagi';
    case 'conflict':
      return 'Perlu memilih posisi baca';
    case 'unauthorized':
      return 'Sesi berakhir';
  }
}

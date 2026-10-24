import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService, UsageStats } from '../../core/admin.service';
import { UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';

interface Bar {
  day: string;
  active: number;
  installed: number;
  h: number;
  hi: number;
  x: number;
}

const W = 600;
const H = 140;

/**
 * Owner-only usage dashboard: devices that opened the app per day (anonymous, see privasi.html),
 * weekly / monthly actives, installs, accounts and finished khatam rounds.
 */
@Component({
  selector: 'app-stats-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali ke mushaf" (click)="back()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1>Statistik pemakaian</h1>
      <button type="button" class="mf-btn mf-btn--ghost" (click)="load()">Muat ulang</button>
    </header>
    <main class="wrap">
      @if (error()) {
        <p class="muted">{{ error() }}</p>
      } @else if (!s()) {
        <p class="muted">Memuat…</p>
      } @else {
        <div class="tiles">
          <div class="tile"><span class="v">{{ todayActive() }}</span><span class="l">Hari ini</span></div>
          <div class="tile"><span class="v">{{ s()!.wau }}</span><span class="l">7 hari</span></div>
          <div class="tile"><span class="v">{{ s()!.mau }}</span><span class="l">30 hari</span></div>
          <div class="tile"><span class="v">{{ s()!.totalDevices }}</span><span class="l">Total perangkat</span></div>
          <div class="tile"><span class="v">{{ s()!.accounts }}</span><span class="l">Akun</span></div>
          <div class="tile"><span class="v">{{ s()!.khatamFinished }}</span><span class="l">Khatam tercatat</span></div>
        </div>

        <h2>Perangkat aktif per hari (90 hari)</h2>
        @if (bars().length) {
          <svg class="chart" [attr.viewBox]="'0 0 ' + w + ' ' + (h + 18)" role="img"
            [attr.aria-label]="'Perangkat aktif per hari, puncak ' + peak()">
            @for (b of bars(); track b.day) {
              <rect class="all" [attr.x]="b.x" [attr.y]="h - b.h" [attr.width]="barW()" [attr.height]="b.h"><title>{{ b.day }}: {{ b.active }} perangkat, {{ b.installed }} terpasang</title></rect>
              <rect class="inst" [attr.x]="b.x" [attr.y]="h - b.hi" [attr.width]="barW()" [attr.height]="b.hi" />
            }
            <text x="0" [attr.y]="h + 14">{{ bars()[0]!.day }}</text>
            <text [attr.x]="w" [attr.y]="h + 14" text-anchor="end">{{ bars()[bars().length - 1]!.day }}</text>
            <text x="0" y="10">puncak {{ peak() }}</text>
          </svg>
          <p class="legend"><span class="sw all"></span> semua perangkat <span class="sw inst"></span> aplikasi terpasang</p>
        } @else {
          <p class="muted">Belum ada data. Hitungan dimulai sejak versi ini dipasang.</p>
        }

        @if (s()!.versions.length) {
          <h2>Versi aplikasi (7 hari)</h2>
          <ul class="ver">
            @for (v of s()!.versions; track v.version) {
              <li><span>{{ v.version ?? '–' }}</span><span>{{ v.n }}</span></li>
            }
          </ul>
        }
        <p class="muted small">
          Satu hitungan = satu perangkat membuka aplikasi pada hari itu (WIB). Server hanya menyimpan
          hash acak perangkat, bukan akun, IP, atau halaman yang dibaca. Peramban dengan Do Not Track
          tidak dihitung.
        </p>
      }
    </main>
  `,
  styles: `
    :host { display: block; position: fixed; inset: 0; overflow-y: auto; background: var(--mf-surround); color: var(--ui-ink); font-family: var(--ui-font); }
    .top { position: sticky; top: 0; display: flex; align-items: center; gap: 6px; padding: calc(var(--mf-safe-top) + 6px) 8px 6px; background: var(--ui-surface); border-bottom: 1px solid var(--ui-hair); }
    h1 { flex: 1; margin: 0; font-size: 18px; font-weight: 500; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 16px 16px 48px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
    .tile { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 12px; background: var(--ui-surface); border: 1px solid var(--ui-hair); }
    .v { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .l { font-size: 13px; color: var(--ui-muted); }
    h2 { margin: 24px 0 8px; font-size: 15px; font-weight: 600; }
    .chart { width: 100%; height: auto; background: var(--ui-surface); border-radius: 12px; padding: 10px; box-sizing: border-box; }
    .chart text { font-size: 10px; fill: var(--ui-muted); }
    rect.all, .sw.all { fill: color-mix(in srgb, var(--ui-primary) 35%, transparent); background: color-mix(in srgb, var(--ui-primary) 35%, transparent); }
    rect.inst, .sw.inst { fill: var(--ui-primary); background: var(--ui-primary); }
    .legend { font-size: 12.5px; color: var(--ui-muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
    .ver { list-style: none; margin: 0; padding: 0; background: var(--ui-surface); border-radius: 12px; border: 1px solid var(--ui-hair); }
    .ver li { display: flex; justify-content: space-between; padding: 8px 14px; border-top: 1px solid var(--ui-hair); font-variant-numeric: tabular-nums; }
    .ver li:first-child { border-top: none; }
    .muted { color: var(--ui-muted); }
    .small { font-size: 12.5px; line-height: 1.5; margin-top: 20px; }
  `,
})
export class StatsPage {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);
  private readonly ui = inject(ReaderUiService);
  private readonly data = inject(UserDataApi);

  protected readonly w = W;
  protected readonly h = H;
  protected readonly s = signal<UsageStats | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly todayActive = computed(() => {
    const s = this.s();
    return s?.days.find((d) => d.day === s.today)?.active ?? 0;
  });
  protected readonly peak = computed(() => Math.max(1, ...(this.s()?.days.map((d) => d.active) ?? [1])));
  protected readonly barW = computed(() => Math.max(1, W / Math.max(1, this.s()?.days.length ?? 1) - 1));
  protected readonly bars = computed<Bar[]>(() => {
    const days = this.s()?.days ?? [];
    const peak = this.peak();
    const step = W / Math.max(1, days.length);
    return days.map((d, i) => ({
      day: d.day,
      active: d.active,
      installed: d.installed,
      h: Math.max(1, (d.active / peak) * H),
      hi: (d.installed / peak) * H,
      x: i * step,
    }));
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.s.set(await this.admin.stats());
    } catch (e) {
      this.error.set(
        String(e).includes('403') || String(e).includes('401')
          ? 'Statistik hanya untuk akun pengelola. Masuk dengan akun tersebut.'
          : 'Statistik belum bisa dimuat. Periksa koneksi lalu coba lagi.',
      );
    }
  }

  protected back(): void {
    void this.router.navigate(['/hal', this.data.position()?.page ?? this.ui.currentPage()]);
  }
}

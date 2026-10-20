import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentApi, SyncApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { PAGE_COUNT } from '../../core/models';
import { averagePerDay, juzRange, localDay } from '../../core/progress/progress-logic';
import { ProgressService } from '../../core/progress/progress.service';
import { barHeight, etaText, formatDecimal, weekSummary, weekdayShort } from './progress-format';
import { SheetHistory } from './sheet-history';
import { SHEET_STYLES } from './sheet-styles';

const MIN_TARGET = 1;
const MAX_TARGET = 40;

/** Body of the "Progres membaca" sheet (design sheet N). */
@Component({
  selector: 'app-progress-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    SHEET_STYLES,
    `
      .round {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--ui-accent-ink);
      }
      .pct-row {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
      }
      .pct {
        font-family: var(--ui-display);
        font-size: 44px;
        font-weight: 500;
        line-height: 1;
        color: var(--ui-primary);
        font-variant-numeric: tabular-nums;
      }
      .pct-sub {
        font-size: 14px;
        color: var(--ui-ink2);
        white-space: nowrap;
      }
      .eta {
        font-size: 13.5px;
        line-height: 1.5;
        color: var(--ui-ink2);
        text-wrap: pretty;
      }
      .next {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: var(--mf-tap);
        padding: 12px 14px;
        margin-top: 4px;
        border-radius: 14px;
        border: 1px solid var(--ui-primary);
        background: transparent;
        text-align: left;
        color: var(--ui-ink);
        width: 100%;
      }
      .next .lbl {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--ui-primary);
      }
      .next .val {
        font-size: 15px;
        font-weight: 500;
      }
      .next .go {
        font-size: 13px;
        color: var(--ui-primary);
      }
      .grow {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 18px;
        border-top: 1px solid var(--ui-hair);
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .head .t {
        font-size: 15px;
        font-weight: 500;
      }
      .head .s {
        font-size: 13px;
        color: var(--ui-muted);
      }
      .stepper {
        display: flex;
        align-items: center;
        gap: 2px;
        border: 1px solid var(--ui-line);
        border-radius: 26px;
        padding: 2px;
      }
      .stepper button {
        width: var(--mf-tap);
        height: var(--mf-tap);
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--ui-ink);
        font-size: 20px;
      }
      .stepper button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--ui-ink) 6%, transparent);
      }
      .stepper button:disabled {
        opacity: 0.4;
      }
      .stepper .val {
        min-width: 64px;
        text-align: center;
        font-size: 14px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .week {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 8px;
        align-items: end;
        height: 132px;
        position: relative;
      }
      .col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        height: 100%;
        justify-content: flex-end;
      }
      .col .n {
        height: 16px;
        line-height: 16px;
        font-size: 11.5px;
        color: var(--ui-muted);
        font-variant-numeric: tabular-nums;
      }
      .col .bar-v {
        width: 100%;
        max-width: 28px;
        border-radius: 6px 6px 2px 2px;
        background: color-mix(in srgb, var(--ui-primary) 32%, transparent);
        transition: height var(--mf-dur-base) var(--mf-ease);
      }
      .col .bar-v.zero {
        background: color-mix(in srgb, var(--ui-ink) 12%, transparent);
      }
      .col .bar-v.hit {
        background: var(--ui-primary);
      }
      .col .d {
        height: 18px;
        line-height: 18px;
        font-size: 12px;
        white-space: nowrap;
        color: var(--ui-muted);
        border-bottom: 2px solid transparent;
      }
      .col .d.today {
        font-weight: 600;
        color: var(--ui-ink);
        border-bottom-color: var(--ui-accent);
      }
      .target-line {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px dashed var(--ui-accent);
        pointer-events: none;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
        font-size: 12.5px;
        color: var(--ui-muted);
        white-space: nowrap;
      }
      .legend span {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sw {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        background: var(--ui-primary);
      }
      .sw-line {
        width: 14px;
        border-top: 1px dashed var(--ui-accent);
      }
      .juz {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 6px;
      }
      .cell {
        position: relative;
        aspect-ratio: 1;
        min-height: var(--mf-tap);
        border-radius: 10px;
        border: 1px solid var(--ui-line);
        background: transparent;
        color: var(--ui-ink);
        font-size: 14px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cell .fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        background: color-mix(in srgb, var(--ui-primary) 16%, transparent);
      }
      .cell .num {
        position: relative;
      }
      .cell.done {
        background: var(--ui-primary);
        color: var(--ui-on);
        border-color: var(--ui-primary);
      }
      .cell.cur {
        border-color: var(--ui-accent);
        border-width: 2px;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .range {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 10px;
        font-size: 14px;
      }
      .range input {
        width: 84px;
      }
      .opt {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        min-height: var(--mf-tap);
        padding: 8px 4px;
        font-size: 14px;
      }
      .opt input {
        width: 20px;
        height: 20px;
        margin-top: 2px;
        accent-color: var(--ui-primary);
        flex: none;
      }
      .opt small {
        display: block;
        color: var(--ui-muted);
        font-size: 12.5px;
        margin-top: 2px;
      }
      .err {
        color: var(--mf-danger);
        font-size: 13px;
      }
      .suggest {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-start;
        padding: 12px 14px;
        border-radius: var(--mf-radius-lg);
        border: 1px solid var(--ui-accent);
        background: color-mix(in srgb, var(--ui-accent) 8%, transparent);
        font-size: 14px;
        line-height: 1.45;
      }
      .done-msg {
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: flex-start;
      }
    `,
  ],
  template: `
    <section aria-labelledby="pg-round">
      <div class="round" id="pg-round">Khatam ke-{{ roundNumber() }}</div>
      <div class="pct-row">
        <span class="pct">{{ percentText() }}%</span>
        <span class="pct-sub">{{ readCount() }} dari {{ total }} halaman</span>
      </div>
      <div
        class="bar"
        role="progressbar"
        aria-label="Progres khatam"
        aria-valuemin="0"
        [attr.aria-valuemax]="total"
        [attr.aria-valuenow]="readCount()"
        [attr.aria-valuetext]="readCount() + ' dari ' + total + ' halaman'"
      >
        <span [style.width.%]="progress.percent()"></span>
      </div>

      @if (progress.roundComplete()) {
        <div class="done-msg">
          <p class="eta">Alhamdulillah, semua halaman sudah dibaca.</p>
          <button type="button" class="mf-btn mf-btn--primary" (click)="startNext()">
            Selesai khatam ke-{{ roundNumber() }} · mulai khatam ke-{{ roundNumber() + 1 }}
          </button>
        </div>
      } @else {
        <p class="eta">{{ eta() }}</p>
        @if (progress.firstUnread(); as next) {
          <button type="button" class="next" (click)="open(next)">
            <span class="grow">
              <span class="lbl">Belum dibaca berikutnya</span>
              <span class="val">Halaman {{ next }}</span>
            </span>
            <span class="go">Buka</span>
          </button>
        }
      }
    </section>

    <section class="block" aria-labelledby="pg-target" data-search-id="progress-target">
      <div class="head">
        <div class="grow">
          <span class="t" id="pg-target">Target harian</span>
          <span class="s" role="status">{{ todayLabel() }}</span>
        </div>
        <div class="stepper" role="group" aria-labelledby="pg-target">
          <button
            type="button"
            aria-label="Kurangi target"
            [disabled]="target() <= minTarget"
            (click)="setTarget(target() - 1)"
          >
            −
          </button>
          <span class="val" aria-live="polite">{{ target() }} hal.</span>
          <button
            type="button"
            aria-label="Tambah target"
            [disabled]="target() >= maxTarget"
            (click)="setTarget(target() + 1)"
          >
            +
          </button>
        </div>
      </div>

      <div class="week" aria-hidden="true">
        @for (d of week(); track d.day) {
          <div class="col">
            <span class="n">{{ d.count }}</span>
            <div
              class="bar-v"
              [class.hit]="d.hit"
              [class.zero]="d.count === 0"
              [style.height.px]="d.height"
            ></div>
            <span class="d" [class.today]="d.today">{{ d.label }}</span>
          </div>
        }
        <div class="target-line" [style.bottom.px]="targetLine()"></div>
      </div>
      <table class="mf-visually-hidden">
        <caption>
          {{
            weekAria()
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Hari</th>
            <th scope="col">Halaman dibaca</th>
          </tr>
        </thead>
        <tbody>
          @for (d of week(); track d.day) {
            <tr>
              <th scope="row">{{ d.today ? 'Hari ini' : d.label }}</th>
              <td>{{ d.count }}{{ d.hit ? ', target tercapai' : '' }}</td>
            </tr>
          }
        </tbody>
      </table>
      <div class="legend" aria-hidden="true">
        <span><span class="sw"></span>Target tercapai</span>
        <span><span class="sw-line"></span>Target</span>
      </div>
    </section>

    <section class="block" aria-labelledby="pg-mark" data-search-id="progress-mark">
      <div class="head">
        <span class="t" id="pg-mark">Tandai sudah dibaca</span>
        <button
          type="button"
          class="mf-btn mf-btn--outline"
          [attr.aria-expanded]="formOpen()"
          (click)="formOpen.set(!formOpen())"
        >
          {{ formOpen() ? 'Tutup' : 'Tandai' }}
        </button>
      </div>
      @if (suggestion(); as sg) {
        <div class="suggest">
          <span
            >Penanda terakhirmu ada di hal. {{ sg.upTo }}{{ sg.where }}. Tandai hal. 1–{{
              sg.upTo
            }}
            sudah dibaca?</span
          >
          <button type="button" class="mf-btn mf-btn--primary" (click)="applySuggestion(sg.upTo)">
            Tandai hal. 1–{{ sg.upTo }}
          </button>
        </div>
      }
      @if (formOpen()) {
        <form class="form" (submit)="onSubmit($event)">
          <div class="range">
            <label for="pg-from">Dari hal.</label>
            <input
              id="pg-from"
              class="mf-input"
              type="number"
              inputmode="numeric"
              min="1"
              max="604"
              [value]="from()"
              (input)="onFrom($any($event.target).value)"
            />
            <label for="pg-to">sampai</label>
            <input
              id="pg-to"
              class="mf-input"
              type="number"
              inputmode="numeric"
              min="1"
              max="604"
              [value]="to()"
              (input)="onTo($any($event.target).value)"
            />
          </div>
          @if (rangeError(); as e) {
            <div class="err" role="alert">{{ e }}</div>
          }
          <fieldset class="stack" style="border: none; padding: 0; margin: 0">
            <legend class="mf-visually-hidden">Kapan dibaca</legend>
            <label class="opt">
              <input
                type="radio"
                name="pg-when"
                [checked]="when() === 'today'"
                (change)="pickWhen('today')"
              />
              <span
                >Dibaca hari ini<small>Dihitung di grafik harian dan target hari ini.</small></span
              >
            </label>
            <label class="opt">
              <input
                type="radio"
                name="pg-when"
                [checked]="when() === 'before'"
                (change)="pickWhen('before')"
              />
              <span
                >Dibaca sebelumnya<small
                  >Hanya menambah khatam, tidak masuk grafik harian.</small
                ></span
              >
            </label>
          </fieldset>
          <div class="actions">
            <button type="submit" class="mf-btn mf-btn--primary" [disabled]="!range().ok">
              Tandai sudah dibaca
            </button>
            <button
              type="button"
              class="mf-btn mf-btn--outline"
              [disabled]="!range().ok"
              (click)="unmark()"
            >
              Batalkan tanda
            </button>
          </div>
        </form>
      }
    </section>

    <section class="block" aria-labelledby="pg-juz">
      <div class="head">
        <span class="t" id="pg-juz">Peta juz</span>
        <span class="s">{{ juzDone() }} juz selesai</span>
      </div>
      <div class="juz">
        @for (j of juz(); track j.n) {
          <button
            type="button"
            class="cell"
            [class.done]="j.done"
            [class.cur]="j.current"
            [attr.aria-label]="j.aria"
            (click)="openJuz(j.n)"
          >
            @if (!j.done) {
              <span class="fill" [style.height.%]="j.fill"></span>
            }
            <span class="num">{{ j.n }}</span>
          </button>
        }
      </div>
      <p class="muted">
        Isian menunjukkan bagian juz yang sudah dibaca, termasuk halaman yang kamu tandai sendiri.
        Ketuk juz untuk membuka halaman pertama yang belum dibaca.
      </p>
    </section>

    <p class="muted">
      @if (!progress.enabled()) {
        Pencatatan progres sedang dimatikan di Pengaturan.
      } @else if (sync.account()) {
        Progres ikut tersinkron ke akunmu, jadi bisa dilanjutkan di perangkat lain.
      } @else {
        Tanpa akun. Progres tersimpan di perangkat ini.
      }
    </p>
  `,
})
export class ProgressSheet {
  protected readonly progress = inject(ProgressService);
  protected readonly sync = inject(SyncApi);
  private readonly history = inject(SheetHistory);
  private readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);

  protected readonly formOpen = signal(false);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly when = signal<'today' | 'before'>('today');
  private whenTouched = false;

  protected readonly suggestion = computed(() => {
    const sg = this.progress.suggestFromBookmarks();
    if (!sg) return null;
    const b = sg.source;
    let where = '';
    if (b.kind === 'verse' && b.surah && b.ayah) {
      const name = this.content.index()
        ? this.content.surah(b.surah).nameLatin
        : `Surah ${b.surah}`;
      where = ` (${name} · Ayat ${b.ayah})`;
    }
    return { upTo: sg.upTo, where };
  });

  /** Parsed range; `error` is shown only once the user typed something. */
  protected readonly range = computed(() => {
    const raw = this.from();
    const f = Number(raw);
    const t = Number(this.to() === '' ? raw : this.to());
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= PAGE_COUNT;
    let error: string | null = null;
    if (raw === '') error = 'Isi nomor halaman awal.';
    else if (!valid(f) || !valid(t)) error = `Nomor halaman harus 1 sampai ${PAGE_COUNT}.`;
    else if (f > t) error = 'Halaman awal tidak boleh lebih besar dari halaman akhir.';
    return { ok: error === null, from: f, to: t, error };
  });
  protected readonly rangeError = computed(() =>
    this.from() !== '' || this.to() !== '' ? this.range().error : null,
  );

  protected readonly total = PAGE_COUNT;
  protected readonly minTarget = MIN_TARGET;
  protected readonly maxTarget = MAX_TARGET;

  protected readonly roundNumber = computed(() => this.progress.currentRound()?.n ?? 1);
  protected readonly readCount = computed(() => this.progress.readInRound().size);
  protected readonly percentText = computed(() => formatDecimal(this.progress.percent()));
  protected readonly target = this.progress.dailyTarget;

  protected readonly eta = computed(() =>
    etaText(
      PAGE_COUNT - this.readCount(),
      this.progress.eta(),
      averagePerDay(this.progress.days(), localDay(Date.now())),
    ),
  );

  protected readonly todayLabel = computed(() => {
    const n = this.progress.todayCount();
    const t = this.target();
    return `Hari ini ${n} dari ${t} halaman${n >= t ? ' · tercapai' : ''}`;
  });

  private readonly weekMax = computed(() =>
    Math.max(this.target(), ...this.progress.last7().map((d) => d.count), 1),
  );

  protected readonly week = computed(() => {
    const week = this.progress.last7();
    const max = this.weekMax();
    const t = this.target();
    return week.map((d, i) => ({
      day: d.day,
      count: d.count,
      label: weekdayShort(d.day),
      today: i === week.length - 1,
      hit: d.count >= t,
      height: barHeight(d.count, max),
    }));
  });

  /** Bottom offset of the dashed line: label row (18) + gap (6) + bar scale. */
  protected readonly targetLine = computed(() => 18 + 6 + barHeight(this.target(), this.weekMax()));
  protected readonly weekAria = computed(() => weekSummary(this.progress.last7(), this.target()));

  protected readonly juz = computed(() => {
    const cur = this.currentJuz();
    return this.progress.juzProgress().map((j) => {
      const done = j.read >= j.total;
      return {
        n: j.juz,
        done,
        current: cur === j.juz,
        fill: j.total ? (j.read / j.total) * 100 : 0,
        aria: `Juz ${j.juz}, ${j.read} dari ${j.total} halaman${done ? ', selesai' : ''}`,
      };
    });
  });
  protected readonly juzDone = computed(() => this.juz().filter((j) => j.done).length);

  /** The juz of the most recently read page marks the "current" one; none before the first read. */
  private currentJuz(): number | null {
    const recent = this.progress.recent(1)[0];
    if (!recent) return null;
    for (let n = 30; n >= 1; n--) if (recent.page >= juzRange(n)[0]) return n;
    return 1;
  }

  protected onFrom(v: string): void {
    this.from.set(v);
    this.autoWhen();
  }

  protected onTo(v: string): void {
    this.to.set(v);
    this.autoWhen();
  }

  protected pickWhen(w: 'today' | 'before'): void {
    this.whenTouched = true;
    this.when.set(w);
  }

  /** Default: 'today' up to 40 pages, else 'before' (until the user picks one). */
  private autoWhen(): void {
    const r = this.range();
    if (this.whenTouched || !r.ok) return;
    this.when.set(r.to - r.from + 1 <= 40 ? 'today' : 'before');
  }

  protected applySuggestion(upTo: number): void {
    this.from.set('1');
    this.to.set(String(upTo));
    this.whenTouched = true;
    this.when.set('before');
    this.formOpen.set(true);
  }

  protected onSubmit(ev: Event): void {
    ev.preventDefault();
    void this.confirmMark();
  }

  private async confirmMark(): Promise<void> {
    const r = this.range();
    if (!r.ok) return;
    const res = await this.progress.markRead({ from: r.from, to: r.to }, { when: this.when() });
    if (res.added === 0) {
      this.ui.showToast({ message: 'Semua halaman itu sudah tercatat dibaca.' });
      return;
    }
    this.ui.showToast({
      message: `${res.added} halaman ditandai`,
      actionLabel: 'Urungkan',
      action: () =>
        void res.undo().then((ok) => {
          if (!ok) this.ui.showToast({ message: 'Tanda ini tidak dapat diurungkan lagi.' });
        }),
      duration: 8000,
    });
  }

  protected async unmark(): Promise<void> {
    const r = this.range();
    if (!r.ok) return;
    const n = await this.progress.unmarkRead({ from: r.from, to: r.to });
    this.ui.showToast({
      message: n > 0 ? `${n} tanda dibatalkan` : 'Tidak ada tanda di rentang itu.',
    });
  }

  protected setTarget(n: number): void {
    void this.progress.setDailyTarget(Math.min(MAX_TARGET, Math.max(MIN_TARGET, n)));
  }

  protected open(page: number): void {
    this.history.navigateTo(page);
  }

  protected openJuz(n: number): void {
    this.history.navigateTo(this.progress.firstUnreadInJuz(n) ?? juzRange(n)[0]);
  }

  protected async startNext(): Promise<void> {
    await this.progress.startNextRound();
  }
}

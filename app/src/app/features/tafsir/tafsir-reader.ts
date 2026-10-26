import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { TranslationService } from '../../core/content/translation.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { TafsirAccessError, TafsirIkService } from '../../core/tafsir/tafsir-ik.service';
import { Block, Inline, kemenagBlocks, parseTafsir, sectionIndexFor } from './tafsir-format';
import { TafsirService } from '../../core/content/tafsir.service';
import { syncedSetting } from '../../core/synced-setting';

export type ReadFont = 'poppins' | 'serif' | 'system';
export type ReadSpacing = 'tight' | 'normal' | 'loose';
export interface ReadView {
  font: ReadFont;
  size: number;
  spacing: ReadSpacing;
  /** Show every RAGU note inline instead of only the ⚠ button. */
  notes: boolean;
}

export const READ_VIEW_DEFAULT: ReadView = { font: 'poppins', size: 18, spacing: 'normal', notes: false };
export const READ_SIZE_MIN = 14;
export const READ_SIZE_MAX = 26;
const VIEW_KEY = 'mf-tafsir-view';
const SOURCE_KEY = 'mf-tafsir-source';
export type TafsirSource = 'kemenag' | 'ik';
/** Blocks rendered at first, then added as the reader scrolls (Al-Baqarah has thousands). */
const STEP = 80;

const FONT_STACK: Record<ReadFont, string> = {
  poppins: "'Mf Read Poppins', 'Poppins', system-ui, sans-serif",
  serif: "'Mf Read Serif', 'Source Serif 4', Georgia, serif",
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};
const LINE: Record<ReadSpacing, number> = { tight: 1.55, normal: 1.75, loose: 1.95 };

/** Stored view settings, sanitised (synced with the account through syncedSetting). */
export function readView(raw: string | null): ReadView {
  try {
    const v = { ...READ_VIEW_DEFAULT, ...(JSON.parse(raw ?? '{}') as Partial<ReadView>) };
    if (!(v.font in FONT_STACK)) v.font = READ_VIEW_DEFAULT.font;
    if (!(v.spacing in LINE)) v.spacing = READ_VIEW_DEFAULT.spacing;
    v.size = Math.min(READ_SIZE_MAX, Math.max(READ_SIZE_MIN, Math.round(Number(v.size) || 18)));
    v.notes = v.notes === true;
    return v;
  } catch {
    return { ...READ_VIEW_DEFAULT };
  }
}

/**
 * Tafsir reading page (Menu › Tafsir): Tafsir Kemenag for everyone, the private Tafsir Ibnu
 * Katsir for the allow-listed account. Built for long reading: one column, adjustable font / size / spacing, ayah quotes shown as the
 * Kemenag translation, review notes (RAGU) folded behind a small ⚠.
 */
@Component({
  selector: 'app-tafsir-reader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--read-font]': 'fontStack()',
    '[style.--read-size.px]': 'view().size',
    '[style.--read-line]': 'lineHeight()',
  },
  template: `
    <div class="bar">
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali ke mushaf" (click)="back()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <label class="pick">
        <span class="pick__sub">{{ sourceLabel() }}</span>
        <select class="pick__sel" aria-label="Pilih surah" [value]="surahNum()" (change)="goSurah($event)">
          @for (s of surahs(); track s.number) {
            <option [value]="s.number" [selected]="s.number === surahNum()">{{ s.number }}. {{ s.nameLatin }}</option>
          }
        </select>
      </label>
      <button type="button" class="mf-icon-btn aa" data-testid="view-btn" aria-label="Tampilan bacaan"
        [attr.aria-expanded]="panel()" (click)="panel.set(!panel())">Aa</button>
    </header>

    @if (panel()) {
      <section class="panel" aria-label="Tampilan bacaan" data-testid="view-panel">
        <div class="row">
          <span class="row__label">Huruf</span>
          <div class="seg" role="radiogroup" aria-label="Huruf">
            @for (f of fonts; track f.id) {
              <button type="button" role="radio" [attr.aria-checked]="view().font === f.id"
                [style.font-family]="fontOf(f.id)" (click)="set({ font: f.id })">{{ f.label }}</button>
            }
          </div>
        </div>
        <div class="row">
          <span class="row__label">Ukuran</span>
          <div class="stepper">
            <button type="button" class="mf-icon-btn" aria-label="Perkecil huruf"
              [disabled]="view().size <= sizeMin" (click)="set({ size: view().size - 1 })">A−</button>
            <span class="stepper__val" aria-live="polite">{{ view().size }}</span>
            <button type="button" class="mf-icon-btn" aria-label="Perbesar huruf"
              [disabled]="view().size >= sizeMax" (click)="set({ size: view().size + 1 })">A+</button>
          </div>
        </div>
        <div class="row">
          <span class="row__label">Spasi</span>
          <div class="seg" role="radiogroup" aria-label="Spasi baris">
            @for (s of spacings; track s.id) {
              <button type="button" role="radio" [attr.aria-checked]="view().spacing === s.id"
                (click)="set({ spacing: s.id })">{{ s.label }}</button>
            }
          </div>
        </div>
        <div class="row">
          <span class="row__label" id="sw-notes">Catatan ⚠ selalu tampil</span>
          <button type="button" class="switch" role="switch" aria-labelledby="sw-notes"
            [attr.aria-checked]="view().notes" (click)="set({ notes: !view().notes })"></button>
        </div>
      </section>
    }
    </div>

    <main class="wrap" #wrap>
      @if (state() === 'loading') {
        <p class="status">Memuat tafsir…</p>
      } @else if (state() === 'denied') {
        <p class="status">Tafsir ini hanya tersedia untuk akun tertentu. Masuk dengan akun tersebut lalu coba lagi.</p>
      } @else if (state() === 'error') {
        <p class="status">Tafsir surah ini belum bisa dimuat. Periksa koneksi lalu coba lagi.</p>
        <button type="button" class="mf-btn mf-btn--primary retry" (click)="reload()">Coba lagi</button>
      } @else {
        <h1 class="title">{{ surahName() }}</h1>
        <p class="lead">{{ ayahCount() }} ayat</p>
        @if (ikAllowed()) {
          <div class="seg source" role="radiogroup" aria-label="Sumber tafsir" data-testid="tafsir-source">
            <button type="button" role="radio" [attr.aria-checked]="source() === 'kemenag'" (click)="setSource('kemenag')">
              Kemenag
            </button>
            <button type="button" role="radio" [attr.aria-checked]="source() === 'ik'" (click)="setSource('ik')">
              Ibnu Katsir
            </button>
          </div>
        }
        @if (source() === 'ik') {
          <p class="disclaimer">
            Terjemahan AI dari teks Arab Ibnu Katsir, belum ditashih. Kutipan ayat memakai terjemahan
            Kemenag RI. Tanda ⚠ menandai bagian yang perlu dicek ahli. Untuk keperluan pribadi.
          </p>
        } @else {
          <p class="disclaimer">
            Tafsir Kementerian Agama RI (quran.kemenag.go.id, lewat EQuran.id). Terjemahan ayat: Kemenag
            RI, edisi penyempurnaan 2019.
          </p>
        }
        @if (sections().length > 1) {
          <label class="jump">
            <span>Lompat ke</span>
            <select aria-label="Lompat ke ayat" (change)="jump($event)">
              <option value="" selected disabled>pilih ayat</option>
              @for (s of sections(); track s.i) {
                <option [value]="s.i">Ayat {{ s.label }}</option>
              }
            </select>
          </label>
        }

        @for (b of shown(); track $index) {
          @if (b.kind === 'section') {
            <h2 class="sec" [id]="'sec-' + $index" [attr.data-ayah]="b.from">{{ sectionLabel(b) }}</h2>
            @if (b.s) {
              <div class="verses">
                @for (a of range(b.from, b.to); track a) {
                  <p><span class="num">{{ a }}</span>{{ ayah(b.s, a) }}</p>
                }
              </div>
            }
          } @else {
            <p class="para">
              @for (part of b.parts; track $index) {
                @switch (part.t) {
                  @case ('text') {
                    @if (part.strong) {
                      <strong>{{ part.v }}</strong>
                    } @else if (part.em) {
                      <em>{{ part.v }}</em>
                    } @else {
                      {{ part.v }}
                    }
                  }
                  @case ('qs') {
                    <span class="qs">“{{ verseText(part.s, part.from, part.to) }}”
                      <button type="button" class="ref" (click)="openMushaf(part.s, part.from)">({{ refLabel(part.s, part.from, part.to) }})</button></span>
                  }
                  @case ('frag') {
                    <span class="ar" lang="ar" dir="rtl">{{ part.arabic }}</span>
                    <button type="button" class="ref" [attr.aria-label]="'Terjemahan ' + refLabel(part.s, part.from, part.to)"
                      (click)="showVerse(part.s, part.from, part.to)">({{ shortRef(part.s, part.from, part.to) }})</button>
                  }
                  @case ('unknown') {
                    <span class="ar" lang="ar" dir="rtl">{{ part.arabic }}</span>
                  }
                  @case ('ragu') {
                    <button type="button" class="ragu" [attr.aria-expanded]="isOpen(part)"
                      aria-label="Catatan: perlu dicek" (click)="toggleNote(part)">⚠</button>
                    @if (isOpen(part)) {
                      <span class="ragu-note">{{ part.note || 'Bagian ini perlu dicek.' }}</span>
                    }
                  }
                }
              }
            </p>
          }
        }
        @if (limit() < blocks().length) {
          <div class="more" #more aria-hidden="true">Memuat lanjutan…</div>
        } @else {
          <nav class="nav" aria-label="Surah lain">
            @if (surahNum() > 1) {
              <button type="button" class="mf-btn mf-btn--ghost" (click)="openSurah(surahNum() - 1)">‹ {{ nameOf(surahNum() - 1) }}</button>
            }
            <span class="grow"></span>
            @if (surahNum() < 114) {
              <button type="button" class="mf-btn mf-btn--ghost" (click)="openSurah(surahNum() + 1)">{{ nameOf(surahNum() + 1) }} ›</button>
            }
          </nav>
        }
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      position: fixed;
      inset: 0;
      overflow-y: auto;
      background: var(--ui-surface);
      color: var(--ui-ink);
      font-family: var(--ui-font);
      -webkit-text-size-adjust: 100%;
    }
    /* Scrolls away with the text: the whole screen is for reading. */
    .bar {
      position: relative;
      z-index: 3;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: calc(var(--mf-safe-top) + 4px) 8px 4px;
      border-bottom: 1px solid var(--ui-hair);
    }
    .pick {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .pick__sub {
      font-size: 12px;
      color: var(--ui-muted);
    }
    .pick__sel {
      max-width: 100%;
      font: inherit;
      font-size: 17px;
      font-weight: 500;
      color: var(--ui-ink);
      background: transparent;
      border: none;
      padding: 0;
    }
    .aa {
      font-size: 17px;
      font-weight: 600;
    }
    .panel {
      display: grid;
      gap: 10px;
      padding: 12px 16px 14px;
      background: var(--ui-surface);
      border-bottom: 1px solid var(--ui-hair);
      box-shadow: 0 6px 16px rgb(0 0 0 / 0.06);
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 14px;
    }
    .row__label {
      color: var(--ui-muted);
    }
    .seg {
      display: flex;
      border: 1px solid var(--ui-hair);
      border-radius: var(--mf-radius-pill);
      overflow: hidden;
    }
    .seg button {
      min-height: 38px;
      padding: 0 12px;
      border: none;
      background: transparent;
      color: var(--ui-ink);
      font-size: 14px;
    }
    .seg button[aria-checked='true'] {
      background: var(--ui-primary);
      color: var(--ui-on-primary, #fff);
    }
    .stepper {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .stepper__val {
      min-width: 2ch;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .switch {
      position: relative;
      flex: none;
      width: 48px;
      height: 28px;
      border-radius: 14px;
      border: none;
      background: var(--ui-line);
      padding: 0;
    }
    .switch::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      transition: transform var(--mf-dur-fast) var(--mf-ease);
    }
    .switch[aria-checked='true'] {
      background: var(--ui-primary);
    }
    .switch[aria-checked='true']::after {
      transform: translateX(20px);
    }
    .wrap {
      max-width: 680px;
      margin: 0 auto;
      padding: 20px 20px calc(var(--mf-safe-bottom) + 48px);
      font-family: var(--read-font);
      font-size: var(--read-size);
      line-height: var(--read-line);
    }
    .status {
      margin: 48px 0 16px;
      text-align: center;
      color: var(--ui-muted);
      font-size: 15px;
    }
    .retry {
      display: block;
      margin: 0 auto;
    }
    .title {
      margin: 8px 0 0;
      font-size: 1.6em;
      font-weight: 600;
      line-height: 1.25;
    }
    .lead {
      margin: 2px 0 12px;
      color: var(--ui-muted);
      font-size: 0.8em;
    }
    .source {
      width: fit-content;
      margin: 4px 0 14px;
      font-family: var(--ui-font);
    }
    .disclaimer {
      margin: 0 0 16px;
      padding: 10px 12px;
      border-left: 3px solid var(--ui-primary);
      background: color-mix(in srgb, var(--ui-primary) 7%, transparent);
      border-radius: 6px;
      font-size: 0.75em;
      line-height: 1.55;
      color: var(--ui-ink2);
    }
    .jump {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 0.8em;
      color: var(--ui-muted);
    }
    .jump select {
      font: inherit;
      color: var(--ui-ink);
      background: var(--ui-surface);
      border: 1px solid var(--ui-hair);
      border-radius: 8px;
      padding: 6px 8px;
    }
    .sec {
      margin: 2.2em 0 0.6em;
      padding-top: 0.6em;
      border-top: 1px solid var(--ui-hair);
      font-size: 0.85em;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ui-primary);
      scroll-margin-top: calc(var(--mf-safe-top) + 12px);
    }
    .verses {
      margin: 0 0 1.2em;
      padding: 0.7em 0.9em;
      border-radius: 10px;
      background: color-mix(in srgb, var(--ui-ink) 4%, transparent);
      font-size: 0.92em;
      line-height: 1.6;
      color: var(--ui-ink2);
    }
    .verses p {
      margin: 0.3em 0;
    }
    .num {
      display: inline-block;
      min-width: 1.8em;
      margin-right: 0.3em;
      font-size: 0.75em;
      font-weight: 600;
      color: var(--ui-primary);
    }
    .para {
      margin: 0 0 1em;
      text-wrap: pretty;
      hyphens: manual;
      overflow-wrap: break-word;
    }
    .para,
    .verses {
      content-visibility: auto;
      contain-intrinsic-size: auto 6em;
    }
    .qs {
      color: var(--ui-ink2);
      font-style: italic;
    }
    .ref {
      margin-inline-start: 0.25em;
      border: none;
      background: none;
      padding: 0;
      font: inherit;
      font-style: normal;
      font-size: 0.8em;
      color: var(--ui-primary);
      cursor: pointer;
      white-space: nowrap;
    }
    .ar {
      font-family: 'Mushaf Doa Naskh', 'Noto Naskh Arabic', 'Amiri', serif;
      font-size: 1.15em;
      line-height: 1;
    }
    .ragu {
      border: none;
      background: color-mix(in srgb, #d08700 16%, transparent);
      color: #a86a00;
      border-radius: 6px;
      padding: 0 4px;
      margin: 0 1px;
      font-size: 0.7em;
      line-height: 1.5;
      vertical-align: 0.15em;
      cursor: pointer;
    }
    .ragu-note {
      display: inline;
      margin: 0 2px;
      padding: 1px 6px;
      border-radius: 6px;
      background: color-mix(in srgb, #d08700 10%, transparent);
      color: var(--ui-muted);
      font-family: var(--ui-font);
      font-size: 0.72em;
      line-height: 1.5;
    }
    .more {
      padding: 24px 0;
      text-align: center;
      color: var(--ui-muted);
      font-size: 0.8em;
    }
    .nav {
      display: flex;
      gap: 8px;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--ui-hair);
    }
    .grow {
      flex: 1;
    }
  `,
})
export class TafsirReader {
  private readonly content = inject(ContentApi);
  private readonly translations = inject(TranslationService);
  private readonly tafsir = inject(TafsirIkService);
  private readonly kemenag = inject(TafsirService);
  private readonly ui = inject(ReaderUiService);
  private readonly userData = inject(UserDataApi);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Route param and ?ayat= (component input binding). */
  readonly surah = input<string>('1');
  readonly ayat = input<string | undefined>(undefined);
  /** ?sumber=ik opens Ibnu Katsir (search entry); otherwise the last choice, Kemenag at first. */
  readonly sumber = input<string | undefined>(undefined);

  /** Ibnu Katsir is private (allow-listed account); everyone else reads Tafsir Kemenag. */
  protected readonly ikAllowed = this.tafsir.allowed;
  private readonly sourceSetting = syncedSetting<TafsirSource>('tafsirSource', SOURCE_KEY, (r) => (r === 'ik' ? 'ik' : 'kemenag'), (v) => v);
  private readonly chosen = this.sourceSetting.value;
  protected readonly source = computed<TafsirSource>(() => {
    const want = this.sumber() === 'ik' ? 'ik' : this.chosen();
    return want === 'ik' && this.ikAllowed() ? 'ik' : 'kemenag';
  });
  protected readonly sourceLabel = computed(() =>
    this.source() === 'ik' ? 'Tafsir Ibnu Katsir' : 'Tafsir Kemenag',
  );

  protected readonly fonts: { id: ReadFont; label: string }[] = [
    { id: 'poppins', label: 'Poppins' },
    { id: 'serif', label: 'Serif' },
    { id: 'system', label: 'Sistem' },
  ];
  protected readonly spacings: { id: ReadSpacing; label: string }[] = [
    { id: 'tight', label: 'Rapat' },
    { id: 'normal', label: 'Sedang' },
    { id: 'loose', label: 'Lega' },
  ];
  protected readonly sizeMin = READ_SIZE_MIN;
  protected readonly sizeMax = READ_SIZE_MAX;

  /** Reading view and source follow the account (prefs.extra), mirrored to the old local keys. */
  private readonly viewSetting = syncedSetting<ReadView>('tafsirView', VIEW_KEY, readView, (v) => JSON.stringify(v));
  protected readonly view = this.viewSetting.value;
  protected readonly panel = signal(false);
  protected readonly fontStack = computed(() => FONT_STACK[this.view().font]);
  protected readonly lineHeight = computed(() => LINE[this.view().spacing]);

  protected readonly surahNum = computed(() => {
    const n = Number(this.surah());
    return Number.isInteger(n) && n >= 1 && n <= 114 ? n : 1;
  });
  protected readonly surahs = computed(() => this.content.index()?.surahs ?? []);
  protected readonly surahName = computed(() => this.nameOf(this.surahNum()));
  protected readonly ayahCount = computed(() => this.surahs()[this.surahNum() - 1]?.ayahCount ?? 0);

  protected readonly state = signal<'loading' | 'ready' | 'error' | 'denied'>('loading');
  protected readonly blocks = signal<Block[]>([]);
  protected readonly limit = signal(STEP);
  protected readonly shown = computed(() => this.blocks().slice(0, this.limit()));
  protected readonly sections = computed(() => {
    const out: { i: number; label: string }[] = [];
    this.blocks().forEach((b, i) => {
      if (b.kind === 'section' && b.from) out.push({ i, label: rangeLabel(b.from, b.to) });
    });
    return out;
  });
  private readonly tr = signal<Record<string, string>>({});
  private readonly open = signal(new Set<Inline>());
  private readonly more = viewChild<ElementRef<HTMLElement>>('more');
  private loadSeq = 0;

  constructor() {
    void this.translations.all().then((f) => f && this.tr.set(f.ayahs));
    effect(() => {
      const s = this.surahNum();
      const ayat = Number(this.ayat()) || 0;
      const src = this.source();
      untracked(() => void this.load(s, ayat, src));
    });
    // Render more blocks as the end comes into view.
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) this.limit.update((n) => n + STEP);
      },
      { root: this.host.nativeElement, rootMargin: '1200px 0px' },
    );
    effect(() => {
      const el = this.more()?.nativeElement;
      io.disconnect();
      if (el) io.observe(el);
    });
    inject(DestroyRef).onDestroy(() => io.disconnect());
  }

  private async load(s: number, ayat: number, src: TafsirSource): Promise<void> {
    const seq = ++this.loadSeq;
    this.state.set('loading');
    this.open.set(new Set());
    try {
      let blocks: Block[];
      if (src === 'ik') blocks = parseTafsir(await this.tafsir.load(s));
      else {
        const f = await this.kemenag.surah(s);
        if (!f) throw new Error('unavailable');
        blocks = kemenagBlocks(s, f.ayahs);
      }
      if (seq !== this.loadSeq) return;
      const target = ayat ? sectionIndexFor(blocks, ayat) : -1;
      this.blocks.set(blocks);
      this.limit.set(Math.max(STEP, target + STEP));
      this.state.set('ready');
      this.scrollTo(target);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.state.set(e instanceof TafsirAccessError ? 'denied' : 'error');
    }
  }

  private scrollTo(blockIndex: number): void {
    const hostEl = this.host.nativeElement;
    afterNextRender(
      () => {
        if (blockIndex <= 0) {
          hostEl.scrollTop = 0;
          return;
        }
        hostEl.querySelector(`#sec-${blockIndex}`)?.scrollIntoView({ block: 'start' });
      },
      { injector: this.injector },
    );
  }

  protected reload(): void {
    void this.load(this.surahNum(), Number(this.ayat()) || 0, this.source());
  }

  /** Switch source and stay at the ayah being read. */
  protected setSource(src: TafsirSource): void {
    if (src === this.source()) return;
    const ayah = this.ayahInView();
    this.sourceSetting.set(src);
    void this.router.navigate(['/tafsir', this.surahNum()], {
      queryParams: { ayat: ayah, sumber: src === 'ik' ? 'ik' : null },
      replaceUrl: true,
    });
  }

  protected set(patch: Partial<ReadView>): void {
    this.viewSetting.set(readView(JSON.stringify({ ...this.view(), ...patch })));
  }

  protected fontOf(f: ReadFont): string {
    return FONT_STACK[f];
  }

  protected nameOf(n: number): string {
    return this.surahs()[n - 1]?.nameLatin ?? `Surah ${n}`;
  }

  protected sectionLabel(b: Extract<Block, { kind: 'section' }>): string {
    if (!b.s) return b.label;
    return b.s === this.surahNum() ? `Ayat ${rangeLabel(b.from, b.to)}` : `QS. ${this.nameOf(b.s)} ${b.s}:${rangeLabel(b.from, b.to)}`;
  }

  protected range(from: number, to: number): number[] {
    const out: number[] = [];
    for (let a = from; a <= Math.min(to, from + 60); a++) out.push(a);
    return out;
  }

  protected ayah(s: number, a: number): string {
    return this.tr()[`${s}:${a}`] ?? '…';
  }

  protected verseText(s: number, from: number, to: number): string {
    if (from === to) return this.ayah(s, from);
    return this.range(from, to)
      .map((a) => `(${a}) ${this.ayah(s, a)}`)
      .join(' ');
  }

  protected refLabel(s: number, from: number, to: number): string {
    return `QS. ${this.nameOf(s)} ${s}:${rangeLabel(from, to)}`;
  }

  /** Fragments are mostly the ayah under discussion: "2:3" is enough (the name is in the toast). */
  protected shortRef(s: number, from: number, to: number): string {
    return `${s}:${rangeLabel(from, to)}`;
  }

  protected showVerse(s: number, from: number, to: number): void {
    this.ui.showToast({
      message: `${this.refLabel(s, from, to)}: “${this.verseText(s, from, to)}”`,
      actionLabel: 'Buka',
      action: () => this.openMushaf(s, from),
      duration: 9000,
    });
  }

  protected isOpen(part: Inline): boolean {
    return this.view().notes || this.open().has(part);
  }

  protected toggleNote(part: Inline): void {
    this.open.update((set) => {
      const next = new Set(set);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  }

  protected goSurah(e: Event): void {
    this.openSurah(Number((e.target as HTMLSelectElement).value));
  }

  protected openSurah(n: number): void {
    void this.router.navigate(['/tafsir', n]);
  }

  protected jump(e: Event): void {
    const sel = e.target as HTMLSelectElement;
    const i = Number(sel.value);
    sel.value = '';
    this.limit.update((n) => Math.max(n, i + STEP));
    this.scrollTo(i);
  }

  protected openMushaf(s: number, a: number): void {
    void this.router.navigate(['/', s, a]);
  }

  /** Back to the mushaf page of the ayah being read. */
  protected back(): void {
    const ayah = this.ayahInView();
    const page =
      (ayah ? this.content.pageOf({ surah: this.surahNum(), ayah }) : null) ??
      this.userData.position()?.page ??
      this.ui.currentPage();
    void this.router.navigate(['/hal', page]);
  }

  private ayahInView(): number {
    const hostEl = this.host.nativeElement;
    let ayah = 0;
    for (const h of Array.from(hostEl.querySelectorAll<HTMLElement>('h2.sec[data-ayah]'))) {
      if (h.getBoundingClientRect().top > 120) break;
      ayah = Number(h.dataset['ayah']) || ayah;
    }
    return ayah || Number(this.ayat()) || 1;
  }
}

function rangeLabel(from: number, to: number): string {
  return to > from ? `${from}–${to}` : String(from);
}

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

export type ReadFont = 'serif' | 'newsreader' | 'poppins' | 'jakarta' | 'plex' | 'system';
export type ReadSpacing = 'tight' | 'normal' | 'loose';
export type ArabicScale = 1 | 1.2 | 1.5;
export interface ReadView {
  font: ReadFont;
  size: number;
  spacing: ReadSpacing;
  /** Arabic text (fragments in the tafsir) relative to the reading size. */
  arabic: ArabicScale;
  /** Show every RAGU note inline instead of only the ⚠ button. */
  notes: boolean;
}

export const READ_VIEW_DEFAULT: ReadView = {
  font: 'serif',
  size: 18,
  spacing: 'normal',
  arabic: 1.2,
  notes: false,
};
export const READ_SIZE_MIN = 14;
export const READ_SIZE_MAX = 26;
export const ARABIC_SCALES: readonly ArabicScale[] = [1, 1.2, 1.5];
const VIEW_KEY = 'mf-tafsir-view';
const SOURCE_KEY = 'mf-tafsir-source';
const LAST_KEY = 'mf-tafsir-last';
export type TafsirSource = 'kemenag' | 'ik';
/** Where the reader stopped last: surah, ayah in view, and which tafsir was open. */
export interface TafsirLast {
  s: number;
  a: number;
  src: TafsirSource;
}
/** Blocks rendered at first, then added as the reader scrolls (Al-Baqarah has thousands). */
const STEP = 80;
/** Ayat quoted under a heading: more than this folds behind a button. */
const VERSES_OPEN = 3;
const RING = 2 * Math.PI * 17;

const FONT_STACK: Record<ReadFont, string> = {
  serif: "'Mf Read Serif', 'Source Serif 4', Georgia, serif",
  newsreader: "'Newsreader', Georgia, serif",
  poppins: "'Mf Read Poppins', 'Poppins', system-ui, sans-serif",
  jakarta: "'Plus Jakarta Sans', system-ui, sans-serif",
  plex: "'IBM Plex Sans', system-ui, sans-serif",
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
    v.arabic = nearestScale(v.arabic);
    v.notes = v.notes === true;
    return v;
  } catch {
    return { ...READ_VIEW_DEFAULT };
  }
}

/** Snap a stored Arabic multiplier to the nearest allowed one (anything not a number: default). */
function nearestScale(x: unknown): ArabicScale {
  const n = Number(x);
  if (typeof x !== 'number' || !Number.isFinite(n)) return READ_VIEW_DEFAULT.arabic;
  return ARABIC_SCALES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}

/** Stored last position, sanitised; null when missing or not a valid surah / ayah. */
export function tafsirLast(raw: string | null): TafsirLast | null {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<TafsirLast> | null;
    if (!v || typeof v !== 'object') return null;
    const s = Number(v.s);
    const a = Number(v.a);
    if (!Number.isInteger(s) || s < 1 || s > 114) return null;
    if (!Number.isInteger(a) || a < 1 || a > 286) return null;
    return { s, a, src: v.src === 'ik' ? 'ik' : 'kemenag' };
  } catch {
    return null;
  }
}

/**
 * Tafsir reading page (Menu › Tafsir), design "Kitab": Tafsir Kemenag for everyone, the private
 * Tafsir Ibnu Katsir for the allow-listed account. One centred column on the chosen paper theme,
 * a bottom dock for source and position, sheets for the reading view and for jumping to an ayah.
 * Ayah quotes show the Kemenag translation, review notes (RAGU) are folded behind a small ⚠.
 */
@Component({
  selector: 'app-tafsir-reader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--read-font]': 'fontStack()',
    '[style.--read-size.px]': 'view().size',
    '[style.--read-line]': 'lineHeight()',
    '[style.--ar-scale]': 'view().arabic',
    '(document:keydown.escape)': 'closeSheet()',
    '(document:visibilitychange)': 'onVisibility()',
  },
  template: `
    <div class="top">
      <button type="button" class="link" aria-label="Kembali ke Mushaf" (click)="back()">
        ‹ Mushaf
      </button>
      <button
        type="button"
        class="link aa"
        data-testid="view-btn"
        aria-label="Tampilan bacaan"
        aria-haspopup="dialog"
        (click)="openSheet('view')"
      >
        Aa
      </button>
    </div>

    <main class="wrap" #wrap>
      @if (state() === 'loading') {
        <p class="status">Memuat tafsir…</p>
      } @else if (state() === 'denied') {
        <p class="status">
          Tafsir ini hanya tersedia untuk akun tertentu. Masuk dengan akun tersebut lalu coba lagi.
        </p>
      } @else if (state() === 'error') {
        <p class="status">Tafsir surah ini belum bisa dimuat. Periksa koneksi lalu coba lagi.</p>
        <button type="button" class="mf-btn mf-btn--primary retry" (click)="reload()">
          Coba lagi
        </button>
      } @else {
        <header class="head">
          @if (surahArabic()) {
            <div class="head__ar" lang="ar" dir="rtl">{{ surahArabic() }}</div>
          }
          <h1 class="title">{{ surahName() }}</h1>
          <p class="lead">{{ ayahCount() }} ayat</p>
          <label class="pill">
            <span>Ganti surah</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            <select
              class="pill__sel"
              aria-label="Pilih surah"
              [value]="surahNum()"
              (change)="goSurah($event)"
            >
              @for (s of surahs(); track s.number) {
                <option [value]="s.number" [selected]="s.number === surahNum()">
                  {{ s.number }}. {{ s.nameLatin }}
                </option>
              }
            </select>
          </label>
        </header>

        <p class="attr">
          {{ attribution() }}
          <button
            type="button"
            class="attr__more"
            [attr.aria-expanded]="detail()"
            (click)="detail.set(!detail())"
          >
            rincian
          </button>
        </p>
        @if (detail()) {
          <p class="disclaimer">{{ disclaimer() }}</p>
        }

        @if (resumeAt(); as at) {
          <button type="button" class="resume" (click)="resume(at)">
            Lanjutkan dari Ayat {{ at }} →
          </button>
        }

        @for (b of shown(); track $index) {
          @if (b.kind === 'section') {
            <h2
              class="sec"
              [id]="'sec-' + $index"
              [attr.data-ayah]="b.s === surahNum() ? b.from : null"
            >
              <span class="sec__rule" aria-hidden="true"></span>
              <span class="sec__col">
                @if (secCap(b); as cap) {
                  <span class="sec__cap">{{ cap }}</span>
                }
                <span class="sec__num" [class.sec__num--text]="!b.s">{{ secNum(b) }}</span>
              </span>
              <span class="sec__rule" aria-hidden="true"></span>
            </h2>
            @if (b.s) {
              @let v = verseView(b, $index);
              <div class="verses" [class.verses--one]="v.single">
                @if (v.single) {
                  <p class="verse">{{ ayah(b.s, b.from) }}</p>
                } @else {
                  <p class="verse">
                    @for (a of v.list; track a) {
                      <sup class="vn">{{ a }}</sup
                      >{{ ayah(b.s, a) }}{{ ' ' }}
                    }
                  </p>
                  @if (v.more; as m) {
                    <button type="button" class="verses__more" (click)="expand($index)">
                      Tampilkan ayat {{ m.from }}–{{ m.to }}
                    </button>
                  }
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
                    <span class="qs"
                      >“{{ verseText(part.s, part.from, part.to) }}”
                      <button type="button" class="ref" (click)="openMushaf(part.s, part.from)">
                        ({{ refLabel(part.s, part.from, part.to) }})
                      </button></span
                    >
                  }
                  @case ('frag') {
                    <span class="ar" lang="ar" dir="rtl">{{ part.arabic }}</span>
                    <button
                      type="button"
                      class="ref"
                      [attr.aria-label]="'Terjemahan ' + refLabel(part.s, part.from, part.to)"
                      (click)="showVerse(part.s, part.from, part.to)"
                    >
                      ({{ shortRef(part.s, part.from, part.to) }})
                    </button>
                  }
                  @case ('unknown') {
                    <span class="ar" lang="ar" dir="rtl">{{ part.arabic }}</span>
                  }
                  @case ('ragu') {
                    <button
                      type="button"
                      class="ragu"
                      [attr.aria-expanded]="isOpen(part)"
                      aria-label="Catatan: perlu dicek"
                      (click)="toggleNote(part)"
                    >
                      ⚠
                    </button>
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
              <button type="button" class="link" (click)="openSurah(surahNum() - 1)">
                ‹ {{ nameOf(surahNum() - 1) }}
              </button>
            }
            <span class="grow"></span>
            @if (surahNum() < 114) {
              <button type="button" class="link" (click)="openSurah(surahNum() + 1)">
                {{ nameOf(surahNum() + 1) }} ›
              </button>
            }
          </nav>
        }
      }
    </main>

    @if (state() === 'ready' && !sheet()) {
      <div class="dock" data-testid="tafsir-dock">
        @if (ikAllowed()) {
          <div class="seg" role="radiogroup" aria-label="Sumber tafsir" data-testid="tafsir-source">
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="source() === 'kemenag'"
              (click)="setSource('kemenag')"
            >
              Kemenag
            </button>
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="source() === 'ik'"
              (click)="setSource('ik')"
            >
              Ibnu Katsir
            </button>
          </div>
        }
        <button
          type="button"
          class="pos"
          data-testid="jump-btn"
          aria-haspopup="dialog"
          [attr.aria-label]="
            'Posisi: Ayat ' + currentAyah() + ' dari ' + ayahCount() + '. Lompat ke ayat'
          "
          (click)="openSheet('jump')"
        >
          <svg class="ring" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <circle class="ring__bg" cx="20" cy="20" r="17" />
            <circle
              class="ring__fg"
              cx="20"
              cy="20"
              r="17"
              transform="rotate(-90 20 20)"
              [attr.stroke-dasharray]="ringDash()"
            />
          </svg>
          <span class="pos__num" aria-hidden="true">{{ currentAyah() }}</span>
          <svg
            class="pos__up"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </div>
    }

    @if (sheet(); as which) {
      <div class="scrim" (click)="closeSheet()" aria-hidden="true"></div>
      @if (which === 'view') {
        <section
          #sheetEl
          class="sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Tampilan bacaan"
          tabindex="-1"
          data-testid="view-panel"
        >
          <div class="sheet__head">
            <h2 class="sheet__title">Tampilan bacaan</h2>
            <button type="button" class="link" (click)="closeSheet()">Selesai</button>
          </div>

          <div class="group">
            <span class="group__label" id="lb-font">HURUF BACA</span>
            <div class="cards" role="radiogroup" aria-labelledby="lb-font">
              @for (f of fonts; track f.id) {
                <button
                  type="button"
                  role="radio"
                  class="card"
                  [attr.aria-checked]="view().font === f.id"
                  (click)="set({ font: f.id })"
                >
                  <span class="card__name" [style.font-family]="fontOf(f.id)">{{ f.label }}</span>
                  <span class="card__note">{{ f.note }}</span>
                </button>
              }
            </div>
          </div>

          <div class="group">
            <span class="group__label">UKURAN</span>
            <div class="size">
              <button
                type="button"
                class="round size__a"
                aria-label="Perkecil huruf"
                [disabled]="view().size <= sizeMin"
                (click)="set({ size: view().size - 1 })"
              >
                A
              </button>
              <input
                type="range"
                class="range"
                aria-label="Ukuran huruf"
                [min]="sizeMin"
                [max]="sizeMax"
                step="1"
                [value]="view().size"
                (input)="set({ size: +$any($event.target).value })"
              />
              <button
                type="button"
                class="round size__a size__a--big"
                aria-label="Perbesar huruf"
                [disabled]="view().size >= sizeMax"
                (click)="set({ size: view().size + 1 })"
              >
                A
              </button>
              <output class="size__val" aria-live="polite">{{ view().size }}</output>
            </div>
          </div>

          <div class="group">
            <span class="group__label" id="lb-space">SPASI</span>
            <div class="seg seg--full" role="radiogroup" aria-labelledby="lb-space">
              @for (s of spacings; track s.id) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="view().spacing === s.id"
                  (click)="set({ spacing: s.id })"
                >
                  {{ s.label }}
                </button>
              }
            </div>
          </div>

          <div class="group">
            <span class="group__label" id="lb-arab">UKURAN TEKS ARAB</span>
            <div class="seg seg--full" role="radiogroup" aria-labelledby="lb-arab">
              @for (o of arabicOptions; track o.id) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="view().arabic === o.id"
                  (click)="set({ arabic: o.id })"
                >
                  {{ o.label }}
                </button>
              }
            </div>
          </div>

          @if (source() === 'ik') {
            <div class="group group--row">
              <span class="group__text" id="sw-notes">Catatan ⚠ selalu tampil</span>
              <button
                type="button"
                class="switch"
                role="switch"
                aria-labelledby="sw-notes"
                [attr.aria-checked]="view().notes"
                (click)="set({ notes: !view().notes })"
              ></button>
            </div>
          }
        </section>
      } @else {
        <section
          #sheetEl
          class="sheet"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="surahName() + ' · lompat ke'"
          tabindex="-1"
          data-testid="jump-sheet"
        >
          <div class="sheet__head">
            <h2 class="sheet__title">{{ surahName() }} · lompat ke</h2>
            <button type="button" class="link" (click)="closeSheet()">Tutup</button>
          </div>

          <div class="stepper">
            <button
              type="button"
              class="round round--lg"
              aria-label="Ayat sebelumnya"
              [disabled]="jumpTo() <= 1"
              (click)="nudge(-1)"
            >
              −
            </button>
            <output class="stepper__num" aria-live="polite">{{ jumpTo() }}</output>
            <button
              type="button"
              class="round round--lg"
              aria-label="Ayat berikutnya"
              [disabled]="jumpTo() >= ayahCount()"
              (click)="nudge(1)"
            >
              +
            </button>
          </div>
          <label class="sr" for="jump-range">Nomor ayat</label>
          <input
            id="jump-range"
            type="range"
            class="range range--wide"
            min="1"
            [max]="ayahCount()"
            step="1"
            [value]="jumpTo()"
            (input)="jumpTo.set(+$any($event.target).value)"
          />
          <p class="caption">Ayat {{ currentAyah() }} · posisi sekarang</p>
          <button type="button" class="mf-btn mf-btn--primary go" (click)="jumpGo()">
            Buka Ayat {{ jumpTo() }}
          </button>

          <div class="sheet__nav">
            @if (surahNum() > 1) {
              <button type="button" class="link" (click)="openSurah(surahNum() - 1)">
                ‹ {{ nameOf(surahNum() - 1) }}
              </button>
            } @else {
              <span></span>
            }
            <label class="link all">
              <span>Semua surah</span>
              <select
                class="pill__sel"
                aria-label="Semua surah"
                [value]="surahNum()"
                (change)="goSurah($event)"
              >
                @for (s of surahs(); track s.number) {
                  <option [value]="s.number" [selected]="s.number === surahNum()">
                    {{ s.number }}. {{ s.nameLatin }}
                  </option>
                }
              </select>
            </label>
            @if (surahNum() < 114) {
              <button type="button" class="link" (click)="openSurah(surahNum() + 1)">
                {{ nameOf(surahNum() + 1) }} ›
              </button>
            } @else {
              <span></span>
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host {
      /* The page sits on the chosen paper theme; night / contrast / custom themes redefine --mf-*. */
      --t-paper: var(--mf-paper);
      --t-raise: var(--mf-surface-paper);
      --t-ink: var(--mf-text-ink);
      --t-ink2: color-mix(in srgb, var(--mf-text-ink) 85%, var(--mf-paper));
      --t-muted: color-mix(in srgb, var(--mf-text-ink) 72%, var(--mf-paper));
      --t-line: color-mix(in srgb, var(--mf-text-ink) 22%, var(--mf-paper));
      --t-hair: color-mix(in srgb, var(--mf-text-ink) 12%, var(--mf-paper));
      --t-tint: color-mix(in srgb, var(--ui-primary) 9%, var(--mf-paper));
      --t-accent: var(--ui-primary);
      --t-on-accent: var(--ui-on);
      --t-warn: color-mix(in srgb, #a86a00 85%, var(--mf-text-ink));
      --t-warnbg: color-mix(in srgb, #d08700 16%, var(--mf-paper));
      --t-serif: 'Mf Read Serif', 'Source Serif 4', Georgia, serif;
      display: block;
      position: fixed;
      inset: 0;
      overflow-y: auto;
      background: var(--t-paper);
      color: var(--t-ink);
      font-family: var(--ui-font);
      -webkit-text-size-adjust: 100%;
    }
    button,
    select,
    input {
      font-family: var(--ui-font);
    }
    /* Scrolls away with the text: the whole screen is for reading. */
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 680px;
      margin: 0 auto;
      padding: calc(var(--mf-safe-top) + 4px) 12px 0;
    }
    .link {
      min-height: 44px;
      padding: 0 8px;
      border: none;
      background: none;
      color: var(--t-accent);
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
    }
    .aa {
      font-size: 17px;
      font-weight: 600;
    }
    .wrap {
      max-width: 680px;
      margin: 0 auto;
      padding: 8px 20px calc(var(--mf-safe-bottom) + 120px);
      font-size: var(--read-size);
      line-height: var(--read-line);
    }
    .status {
      margin: 48px 0 16px;
      text-align: center;
      color: var(--t-muted);
      font-size: 15px;
    }
    .retry {
      display: block;
      margin: 0 auto;
    }
    .head {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .head__ar {
      font-family: 'Mushaf Doa Naskh', 'Noto Naskh Arabic', 'Amiri', serif;
      font-size: 2.2em;
      line-height: 1.5;
      color: var(--t-accent);
    }
    .title {
      margin: 0;
      font-family: var(--t-serif);
      font-size: 1.65em;
      font-weight: 600;
      line-height: 1.25;
    }
    .lead {
      margin: 2px 0 12px;
      color: var(--t-muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .pill,
    .all {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--t-line);
      border-radius: var(--mf-radius-pill);
      color: var(--t-ink);
      font-size: 14px;
      font-weight: 500;
    }
    .all {
      border: none;
      padding: 0 8px;
      color: var(--t-accent);
      font-size: 15px;
    }
    /* The native picker, invisible over its label, keeps keyboard and screen-reader behaviour. */
    .pill__sel {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
      font-size: 16px;
    }
    .attr {
      margin: 14px 0 0;
      text-align: center;
      color: var(--t-muted);
      font-size: 12.5px;
      font-style: italic;
      line-height: 1.5;
    }
    .attr__more {
      min-height: 32px;
      padding: 0 4px;
      border: none;
      background: none;
      color: var(--t-accent);
      font-size: inherit;
      font-style: normal;
      text-decoration: underline;
      cursor: pointer;
    }
    .disclaimer {
      margin: 4px 0 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--t-tint);
      color: var(--t-ink2);
      font-size: 13px;
      line-height: 1.55;
    }
    .resume {
      display: block;
      min-height: 44px;
      margin: 12px auto 0;
      padding: 0 12px;
      border: none;
      background: none;
      color: var(--t-accent);
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    .sec {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin: 2.2em 0 0.7em;
      scroll-margin-top: calc(var(--mf-safe-top) + 12px);
    }
    .sec__rule {
      flex: 0 0 40px;
      height: 1px;
      background: var(--t-line);
    }
    .sec__col {
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.2;
    }
    .sec__cap {
      font-family: var(--ui-font);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.16em;
      color: var(--t-muted);
      text-transform: uppercase;
    }
    .sec__num {
      font-family: var(--t-serif);
      font-size: 1.65em;
      font-weight: 600;
      color: var(--t-accent);
    }
    .sec__num--text {
      font-size: 1.1em;
    }
    .verses {
      margin: 0 0 1.1em;
      font-family: var(--read-font);
      font-style: italic;
      color: var(--t-ink2);
    }
    .verses--one {
      text-align: center;
      font-family: var(--t-serif);
      font-size: 1.05em;
    }
    .verse {
      margin: 0;
      line-height: 1.7;
    }
    .vn {
      margin-inline-end: 0.3em;
      font-family: var(--ui-font);
      font-size: 0.6em;
      font-style: normal;
      font-weight: 600;
      line-height: 0;
      color: var(--t-accent);
    }
    .verses__more {
      min-height: 44px;
      padding: 0 4px;
      border: none;
      background: none;
      color: var(--t-accent);
      font-size: 13px;
      font-style: normal;
      cursor: pointer;
    }
    .para {
      margin: 0 0 0.8em;
      font-family: var(--read-font);
      text-wrap: pretty;
      hyphens: manual;
      overflow-wrap: break-word;
    }
    .para + .para {
      text-indent: 1.4em;
    }
    .para,
    .verses {
      content-visibility: auto;
      contain-intrinsic-size: auto 6em;
    }
    .qs {
      color: var(--t-ink2);
      font-style: italic;
    }
    /* Padding makes the tap box taller without changing the line height. */
    .ref {
      margin: -0.5em 0;
      margin-inline-start: 0.25em;
      padding: 0.5em 0.2em;
      border: none;
      background: none;
      font-family: var(--ui-font);
      font-style: normal;
      font-size: 0.75em;
      font-weight: 600;
      color: var(--t-accent);
      cursor: pointer;
      white-space: nowrap;
    }
    .ar {
      font-family: 'Mushaf Doa Naskh', 'Noto Naskh Arabic', 'Amiri', serif;
      font-size: calc(1em * var(--ar-scale, 1.2));
      line-height: 1;
    }
    .ragu {
      display: inline-grid;
      place-items: center;
      width: 1.45em;
      height: 1.45em;
      margin: 0 2px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--t-warnbg);
      color: var(--t-warn);
      font-size: 0.7em;
      line-height: 1;
      vertical-align: 0.1em;
      cursor: pointer;
    }
    .ragu-note {
      display: inline;
      margin: 0 2px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--t-warnbg);
      color: var(--t-warn);
      font-family: var(--ui-font);
      font-size: 0.72em;
      line-height: 1.5;
    }
    .more {
      padding: 24px 0;
      text-align: center;
      color: var(--t-muted);
      font-size: 0.8em;
    }
    .nav {
      display: flex;
      gap: 8px;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--t-hair);
    }
    .grow {
      flex: 1;
    }

    .dock {
      position: fixed;
      left: 0;
      right: 0;
      bottom: calc(var(--mf-safe-bottom) + 16px);
      z-index: var(--mf-z-chrome);
      width: fit-content;
      max-width: calc(100% - 24px);
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 4px;
      border: 1px solid var(--t-hair);
      border-radius: var(--mf-radius-pill);
      background: var(--t-raise);
      box-shadow: 0 6px 22px rgb(0 0 0 / 0.14);
    }
    .seg {
      display: flex;
      gap: 2px;
      padding: 2px;
      border-radius: var(--mf-radius-pill);
      background: var(--t-tint);
    }
    .seg button {
      min-height: 40px;
      padding: 0 14px;
      border: none;
      border-radius: var(--mf-radius-pill);
      background: transparent;
      color: var(--t-ink);
      font-size: 14px;
      cursor: pointer;
    }
    .seg button[aria-checked='true'] {
      background: var(--t-accent);
      color: var(--t-on-accent);
    }
    .seg--full {
      border: 1px solid var(--t-hair);
    }
    .seg--full button {
      flex: 1;
    }
    .pos {
      display: flex;
      align-items: center;
      gap: 2px;
      position: relative;
      min-height: 44px;
      padding: 0 6px 0 2px;
      border: none;
      background: none;
      color: var(--t-ink);
      cursor: pointer;
    }
    .ring__bg,
    .ring__fg {
      fill: none;
      stroke-width: 3;
    }
    .ring__bg {
      stroke: var(--t-hair);
    }
    .ring__fg {
      stroke: var(--t-accent);
      stroke-linecap: round;
    }
    .pos__num {
      position: absolute;
      left: 2px;
      width: 40px;
      text-align: center;
      font-family: var(--t-serif);
      font-size: 14px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .pos__up {
      color: var(--t-muted);
    }

    .scrim {
      position: fixed;
      inset: 0;
      z-index: var(--mf-z-scrim);
      background: var(--mf-scrim);
    }
    .sheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: var(--mf-z-sheet);
      max-width: 560px;
      max-height: 90vh;
      margin: 0 auto;
      overflow-y: auto;
      padding: 8px 20px calc(var(--mf-safe-bottom) + 20px);
      border-radius: var(--mf-radius-sheet) var(--mf-radius-sheet) 0 0;
      background: var(--t-raise);
      color: var(--t-ink);
      outline: none;
      box-shadow: 0 -8px 30px rgb(0 0 0 / 0.16);
    }
    .sheet__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .sheet__title {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .group {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }
    .group--row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .group__label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.14em;
      color: var(--t-muted);
    }
    .group__text {
      font-size: 14px;
    }
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 56px;
      padding: 8px 12px;
      border: 1px solid var(--t-line);
      border-radius: 12px;
      background: transparent;
      color: var(--t-ink);
      text-align: start;
      cursor: pointer;
    }
    .card[aria-checked='true'] {
      border-color: var(--t-accent);
      background: var(--t-tint);
      box-shadow: inset 0 0 0 1px var(--t-accent);
    }
    .card__name {
      font-size: 16px;
      font-weight: 600;
    }
    .card__note {
      font-size: 11.5px;
      color: var(--t-muted);
    }
    .size {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .round {
      flex: none;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 1px solid var(--t-line);
      border-radius: 50%;
      background: transparent;
      color: var(--t-ink);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .round:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .size__a--big {
      font-size: 22px;
    }
    .round--lg {
      width: 52px;
      height: 52px;
      font-size: 24px;
    }
    .size__val {
      min-width: 2.2ch;
      text-align: end;
      font-variant-numeric: tabular-nums;
      color: var(--t-muted);
      font-size: 14px;
    }
    .range {
      flex: 1;
      min-width: 0;
      height: 44px;
      accent-color: var(--t-accent);
    }
    .range--wide {
      display: block;
      width: 100%;
      margin: 8px 0 0;
    }
    .stepper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 24px;
      margin-top: 8px;
    }
    .stepper__num {
      min-width: 2.2ch;
      text-align: center;
      font-family: var(--t-serif);
      font-size: 56px;
      font-weight: 600;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
      color: var(--t-accent);
    }
    .caption {
      margin: 0 0 12px;
      text-align: center;
      color: var(--t-muted);
      font-size: 13px;
    }
    .go {
      width: 100%;
      min-height: 48px;
    }
    .sheet__nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
    }
    .switch {
      position: relative;
      flex: none;
      width: 48px;
      height: 28px;
      border-radius: 14px;
      border: none;
      background: var(--t-line);
      padding: 0;
      cursor: pointer;
    }
    .switch::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--t-raise);
      transition: transform var(--mf-dur-fast) var(--mf-ease);
    }
    .switch[aria-checked='true'] {
      background: var(--t-accent);
    }
    .switch[aria-checked='true']::after {
      transform: translateX(20px);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
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
  private readonly sourceSetting = syncedSetting<TafsirSource>(
    'tafsirSource',
    SOURCE_KEY,
    (r) => (r === 'ik' ? 'ik' : 'kemenag'),
    (v) => v,
  );
  private readonly chosen = this.sourceSetting.value;
  protected readonly source = computed<TafsirSource>(() => {
    const want = this.sumber() === 'ik' ? 'ik' : this.chosen();
    return want === 'ik' && this.ikAllowed() ? 'ik' : 'kemenag';
  });
  protected readonly attribution = computed(() =>
    this.source() === 'ik'
      ? 'Terjemahan AI dari teks Arab Ibnu Katsir, belum ditashih'
      : 'Tafsir Kementerian Agama RI · terjemahan edisi 2019',
  );
  protected readonly disclaimer = computed(() =>
    this.source() === 'ik'
      ? 'Terjemahan AI dari teks Arab Ibnu Katsir, belum ditashih. Kutipan ayat memakai terjemahan Kemenag RI. Tanda ⚠ menandai bagian yang perlu dicek ahli. Untuk keperluan pribadi.'
      : 'Tafsir Kementerian Agama RI (quran.kemenag.go.id, lewat EQuran.id). Terjemahan ayat: Kemenag RI, edisi penyempurnaan 2019.',
  );
  protected readonly detail = signal(false);

  protected readonly fonts: { id: ReadFont; label: string; note: string }[] = [
    { id: 'serif', label: 'Source Serif', note: 'bawaan' },
    { id: 'newsreader', label: 'Newsreader', note: 'serif buku' },
    { id: 'poppins', label: 'Poppins', note: 'sans bulat' },
    { id: 'jakarta', label: 'Plus Jakarta', note: 'sans UI' },
    { id: 'plex', label: 'IBM Plex Sans', note: 'sans tegas' },
    { id: 'system', label: 'Sistem', note: 'font perangkat' },
  ];
  protected readonly spacings: { id: ReadSpacing; label: string }[] = [
    { id: 'tight', label: 'Rapat' },
    { id: 'normal', label: 'Sedang' },
    { id: 'loose', label: 'Lega' },
  ];
  protected readonly arabicOptions: { id: ArabicScale; label: string }[] = [
    { id: 1, label: '1×' },
    { id: 1.2, label: '1,2×' },
    { id: 1.5, label: '1,5×' },
  ];
  protected readonly sizeMin = READ_SIZE_MIN;
  protected readonly sizeMax = READ_SIZE_MAX;

  /** Reading view and source follow the account (prefs.extra), mirrored to the old local keys. */
  private readonly viewSetting = syncedSetting<ReadView>('tafsirView', VIEW_KEY, readView, (v) =>
    JSON.stringify(v),
  );
  protected readonly view = this.viewSetting.value;
  private readonly lastSetting = syncedSetting<TafsirLast | null>(
    'tafsirLast',
    LAST_KEY,
    tafsirLast,
    (v) => (v ? JSON.stringify(v) : null),
  );
  protected readonly sheet = signal<'view' | 'jump' | null>(null);
  protected readonly fontStack = computed(() => FONT_STACK[this.view().font]);
  protected readonly lineHeight = computed(() => LINE[this.view().spacing]);

  protected readonly surahNum = computed(() => {
    const n = Number(this.surah());
    return Number.isInteger(n) && n >= 1 && n <= 114 ? n : 1;
  });
  protected readonly surahs = computed(() => this.content.index()?.surahs ?? []);
  protected readonly surahName = computed(() => this.nameOf(this.surahNum()));
  protected readonly surahArabic = computed(
    () => this.surahs()[this.surahNum() - 1]?.nameArabic ?? '',
  );
  protected readonly ayahCount = computed(() => this.surahs()[this.surahNum() - 1]?.ayahCount ?? 0);

  protected readonly state = signal<'loading' | 'ready' | 'error' | 'denied'>('loading');
  protected readonly blocks = signal<Block[]>([]);
  protected readonly limit = signal(STEP);
  protected readonly shown = computed(() => this.blocks().slice(0, this.limit()));
  /** Ayah at the top of the screen, for the dock ring and the jump sheet. */
  protected readonly currentAyah = signal(1);
  protected readonly ringDash = computed(() => {
    const n = this.ayahCount();
    const f = n ? Math.min(1, Math.max(0, this.currentAyah() / n)) : 0;
    return `${(f * RING).toFixed(1)} ${RING.toFixed(1)}`;
  });
  /** Offered at the top when the page opens without ?ayat and a saved spot exists. */
  protected readonly resumeAt = signal<number | null>(null);
  protected readonly jumpTo = signal(1);
  private readonly expanded = signal(new Set<number>());
  private readonly tr = signal<Record<string, string>>({});
  private readonly open = signal(new Set<Inline>());
  private readonly more = viewChild<ElementRef<HTMLElement>>('more');
  private readonly sheetEl = viewChild<ElementRef<HTMLElement>>('sheetEl');
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
    // Follow the scroll for the dock, at most once per frame.
    const hostEl = this.host.nativeElement;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (this.state() === 'ready') this.currentAyah.set(this.ayahInView());
      });
    };
    hostEl.addEventListener('scroll', onScroll, { passive: true });
    // Move focus into a sheet when it opens.
    effect(() => this.sheetEl()?.nativeElement.focus({ preventScroll: true }));
    inject(DestroyRef).onDestroy(() => {
      io.disconnect();
      hostEl.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      this.savePosition(false);
    });
  }

  private async load(s: number, ayat: number, src: TafsirSource): Promise<void> {
    const seq = ++this.loadSeq;
    this.state.set('loading');
    this.open.set(new Set());
    this.expanded.set(new Set());
    this.resumeAt.set(null);
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
      const last = this.lastSetting.value();
      this.resumeAt.set(
        !ayat && last && last.s === s && last.src === src && last.a > 1 ? last.a : null,
      );
      this.blocks.set(blocks);
      this.limit.set(Math.max(STEP, target + STEP));
      this.currentAyah.set(ayat || 1);
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
        if (blockIndex <= 0) hostEl.scrollTop = 0;
        else hostEl.querySelector(`#sec-${blockIndex}`)?.scrollIntoView({ block: 'start' });
        this.currentAyah.set(this.ayahInView());
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

  protected openSheet(which: 'view' | 'jump'): void {
    if (which === 'jump') {
      const now = this.ayahInView();
      this.currentAyah.set(now);
      this.jumpTo.set(this.clampAyah(now));
    }
    this.sheet.set(which);
  }

  protected closeSheet(): void {
    this.sheet.set(null);
  }

  private clampAyah(n: number): number {
    const max = this.ayahCount() || n;
    return Math.min(max, Math.max(1, Math.round(n) || 1));
  }

  protected nudge(by: number): void {
    this.jumpTo.set(this.clampAyah(this.jumpTo() + by));
  }

  /** Jump to an ayah's section: render far enough first, then scroll. */
  private goToAyah(ayah: number): void {
    const i = sectionIndexFor(this.blocks(), ayah);
    this.limit.update((n) => Math.max(n, i + STEP));
    this.scrollTo(i);
  }

  protected jumpGo(): void {
    this.goToAyah(this.jumpTo());
    this.closeSheet();
  }

  protected resume(ayah: number): void {
    this.resumeAt.set(null);
    this.goToAyah(ayah);
  }

  protected fontOf(f: ReadFont): string {
    return FONT_STACK[f];
  }

  protected nameOf(n: number): string {
    return this.surahs()[n - 1]?.nameLatin ?? `Surah ${n}`;
  }

  /** Small label above the heading number: "AYAT", or the quoted surah. Empty without a ref. */
  protected secCap(b: Extract<Block, { kind: 'section' }>): string {
    if (!b.s) return '';
    return b.s === this.surahNum() ? 'AYAT' : `QS. ${this.nameOf(b.s)}`;
  }

  protected secNum(b: Extract<Block, { kind: 'section' }>): string {
    if (!b.s) return b.label;
    const r = rangeLabel(b.from, b.to);
    return b.s === this.surahNum() ? r : `${b.s}:${r}`;
  }

  /** Ayat quoted under a heading; a long run shows its first two behind a "Tampilkan" button. */
  protected verseView(
    b: Extract<Block, { kind: 'section' }>,
    i: number,
  ): { list: number[]; single: boolean; more: { from: number; to: number } | null } {
    const all = this.range(b.from, b.to);
    if (all.length > VERSES_OPEN && !this.expanded().has(i)) {
      return { list: all.slice(0, 2), single: false, more: { from: all[2]!, to: all.at(-1)! } };
    }
    return { list: all, single: all.length === 1, more: null };
  }

  protected expand(i: number): void {
    this.expanded.update((set) => new Set(set).add(i));
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
    this.savePosition(true);
    this.closeSheet();
    void this.router.navigate(['/tafsir', n]);
  }

  protected openMushaf(s: number, a: number): void {
    void this.router.navigate(['/', s, a]);
  }

  /** Back to the mushaf page of the ayah being read. */
  protected back(): void {
    const ayah = this.ayahInView();
    this.savePosition(true);
    const page =
      (ayah ? this.content.pageOf({ surah: this.surahNum(), ayah }) : null) ??
      this.userData.position()?.page ??
      this.ui.currentPage();
    void this.router.navigate(['/hal', page]);
  }

  /** Remember the spot on leaving or hiding the page, not on every scroll. */
  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') this.savePosition(true);
  }

  /** `live`: measure the page now; on destroy the DOM is going away, so use the tracked ayah. */
  private savePosition(live: boolean): void {
    if (this.state() !== 'ready') return;
    const a = live ? this.ayahInView() : this.currentAyah();
    const s = this.surahNum();
    const src = this.source();
    const cur = this.lastSetting.value();
    if (cur && cur.s === s && cur.a === a && cur.src === src) return;
    this.lastSetting.set({ s, a, src });
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

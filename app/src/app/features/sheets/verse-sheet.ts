import { BookmarkToggleService } from '../../core/bookmark-toggle.service';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ArabicTextService } from '../../core/content/arabic.service';
import { LatinService } from '../../core/content/latin.service';
import { TafsirService } from '../../core/content/tafsir.service';
import { TranslationService } from '../../core/content/translation.service';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { AudioService } from '../../core/audio/audio.service';
import { SheetHistory } from './sheet-history';
import { latinCopyText, shareText, translationCopyText, verseReference, verseUrl } from './nav-helpers';

@Component({
  selector: 'app-verse-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as v) {
      <div class="head">
        <div class="title">{{ v.title }}</div>
        <div class="sub">{{ v.sub }}</div>
      </div>
      <section class="latin" aria-label="Cara membaca">
        <div class="latin-head">
          <span class="mf-eyebrow">Cara membaca</span>
          <button
            type="button"
            class="latin-toggle"
            [attr.aria-expanded]="!latinCollapsed()"
            aria-controls="mf-latin-body"
            (click)="toggleLatin()"
          >
            {{ latinCollapsed() ? 'Tampilkan bacaan Latin' : 'Sembunyikan bacaan Latin' }}
          </button>
        </div>
        @if (!latinCollapsed()) {
          <div id="mf-latin-body" aria-live="polite">
            @if (latinText(); as t) {
              <p class="latin-text" lang="id-Latn">{{ t }}</p>
              <div class="latin-foot">
                @if (latinSource(); as src) {
                  <span class="attr">Transliterasi: {{ src }}</span>
                }
                <button type="button" class="latin-copy" (click)="copyLatin()">Salin bacaan</button>
              </div>
            } @else if (latinText() === undefined) {
              <div class="skeleton" aria-busy="true" aria-label="Memuat bacaan Latin">
                <span></span><span></span><span class="short"></span>
              </div>
            } @else {
              <p class="muted">
                Bacaan Latin belum tersedia (perlu koneksi untuk memuat pertama kali).
              </p>
            }
          </div>
        }
      </section>
      <section class="latin" aria-label="Terjemahan">
        <div class="latin-head">
          <span class="mf-eyebrow">Terjemahan</span>
          <button
            type="button"
            class="latin-toggle"
            [attr.aria-expanded]="!trCollapsed()"
            aria-controls="mf-tr-body"
            (click)="toggleTr()"
          >
            {{ trCollapsed() ? 'Tampilkan terjemahan' : 'Sembunyikan terjemahan' }}
          </button>
        </div>
        @if (!trCollapsed()) {
          <div id="mf-tr-body" aria-live="polite">
            @if (trText(); as t) {
              <p class="tr-text" lang="id">{{ t }}</p>
              <div class="latin-foot">
                <span class="attr">{{ trSource() }}</span>
                <button type="button" class="latin-copy" (click)="copyTr()">
                  Salin terjemahan
                </button>
              </div>
            } @else if (trText() === undefined) {
              <div class="skeleton" aria-busy="true" aria-label="Memuat terjemahan">
                <span></span><span></span><span class="short"></span>
              </div>
            } @else {
              <p class="muted">
                Terjemahan belum tersedia (perlu koneksi untuk memuat pertama kali).
              </p>
            }
          </div>
        }
      </section>
      <section class="latin" aria-label="Tafsir">
        <div class="latin-head">
          <span class="mf-eyebrow">Tafsir</span>
          <button
            type="button"
            class="latin-toggle"
            [attr.aria-expanded]="tafsirOpen()"
            aria-controls="mf-tafsir-body"
            (click)="toggleTafsir()"
          >
            {{ tafsirOpen() ? 'Sembunyikan tafsir' : 'Baca tafsir' }}
          </button>
        </div>
        @if (tafsirOpen()) {
          <div id="mf-tafsir-body" aria-live="polite">
            @if (tafsirParagraphs(); as paras) {
              <div class="tafsir-text" lang="id">
                @for (p of paras; track $index) {
                  <p>{{ p }}</p>
                }
              </div>
              <div class="latin-foot">
                <span class="attr">Tafsir Kemenag RI · via EQuran.id</span>
              </div>
            } @else if (tafsirText() === undefined) {
              <div class="skeleton" aria-busy="true" aria-label="Memuat tafsir">
                <span></span><span></span><span class="short"></span>
              </div>
            } @else {
              <p class="muted">
                Tafsir belum dapat dimuat (perlu koneksi untuk memuat pertama kali).
                <button type="button" class="latin-copy" (click)="retryTafsir()">Coba lagi</button>
              </p>
            }
          </div>
        }
      </section>
      <div class="grid">
        <button type="button" class="act" [class.on]="nowPlaying()" (click)="play()">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            @if (nowPlaying()) {
              <path d="M8 5v14M16 5v14" stroke-linecap="round" />
            } @else {
              <path d="M8 5.5v13l10-6.5z" />
            }
          </svg>
          {{ nowPlaying() ? 'Jeda' : 'Putar' }}
        </button>
        <button type="button" class="act" aria-label="Salin ayat" (click)="copy()">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path d="M5 15V6a1 1 0 011-1h9" />
          </svg>
          Salin
        </button>
        <button type="button" class="act" (click)="share()">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v11M7.5 8.5L12 4l4.5 4.5M5 13v6h14v-6" />
          </svg>
          Bagikan
        </button>
        <button
          type="button"
          class="act"
          [class.on]="v.bookmarked"
          [attr.aria-pressed]="v.bookmarked"
          (click)="toggleBookmark()"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            [attr.fill]="v.bookmarked ? 'currentColor' : 'none'"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
          </svg>
          {{ v.bookmarked ? 'Ditandai' : 'Tandai' }}
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-4);
      padding: var(--mf-space-1) var(--mf-space-5) 0;
      color: var(--ui-ink);
    }
    .head {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .title {
      font-size: 16px;
      font-weight: 500;
    }
    .sub {
      font-size: 13.5px;
      color: var(--ui-muted);
    }
    .latin {
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-2);
    }
    .latin-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .latin-toggle,
    .latin-copy {
      min-height: var(--mf-tap);
      padding: 0 var(--mf-space-2);
      border: none;
      background: transparent;
      color: var(--ui-primary);
      font-size: 13px;
      font-weight: 500;
    }
    .latin-text {
      margin: 0;
      font-size: 16.5px;
      line-height: 1.6;
      font-style: normal;
      user-select: text;
      -webkit-user-select: text;
    }
    .tr-text {
      margin: 0;
      font-size: 15.5px;
      line-height: 1.6;
      user-select: text;
      -webkit-user-select: text;
    }
    .tafsir-text {
      max-height: 40vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      font-size: 15.5px;
      line-height: 1.65;
      user-select: text;
      -webkit-user-select: text;
    }
    .tafsir-text p {
      margin: 0 0 var(--mf-space-3);
      overflow-wrap: anywhere;
    }
    .tafsir-text p:last-child {
      margin-bottom: 0;
    }
    .latin-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .attr {
      font-size: 11.5px;
      color: var(--ui-muted);
    }
    .muted {
      margin: 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--ui-muted);
    }
    .skeleton {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 6px 0;
    }
    .skeleton span {
      height: 14px;
      border-radius: 7px;
      background: color-mix(in srgb, var(--ui-ink) 8%, transparent);
      animation: mf-pulse 1.2s ease-in-out infinite;
    }
    .skeleton .short {
      width: 60%;
    }
    @keyframes mf-pulse {
      50% {
        opacity: 0.45;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .skeleton span {
        animation: none;
      }
    }
    .grid {
      position: sticky;
      bottom: 0;
      z-index: 1;
      background: var(--ui-surface);
      padding-bottom: var(--mf-space-4);
      border-top: 1px solid var(--ui-hair);
      padding-top: var(--mf-space-1);
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mf-space-1);
    }
    .act {
      min-height: 64px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: none;
      border-radius: var(--mf-radius-md);
      background: transparent;
      font-size: 12.5px;
      color: var(--ui-ink);
    }
    .act:hover {
      background: color-mix(in srgb, var(--ui-ink) 5%, transparent);
    }
    .act.on {
      color: var(--ui-accent-ink);
    }
    .act.on svg {
      color: var(--ui-accent-icon);
    }
  `,
})
export class VerseSheet {
  protected readonly ui = inject(ReaderUiService);
  protected readonly history = inject(SheetHistory);
  private readonly content = inject(ContentApi);
  private readonly userData = inject(UserDataApi);
  private readonly bookmarkToggle = inject(BookmarkToggleService);
  private readonly latin = inject(LatinService);
  private readonly arabic = inject(ArabicTextService);
  private readonly audio = inject(AudioService);

  /** True while this exact ayah is playing (or loading). */
  protected readonly nowPlaying = computed(() => {
    const v = this.ui.selectedVerse();
    const cur = this.audio.current();
    const st = this.audio.state();
    return (
      !!v &&
      !!cur &&
      cur.surah === v.surah &&
      cur.ayah === v.ayah &&
      (st === 'playing' || st === 'loading')
    );
  });

  protected play(): void {
    const v = this.ui.selectedVerse();
    if (!v) return;
    const cur = this.audio.current();
    const same = !!cur && cur.surah === v.surah && cur.ayah === v.ayah;
    if (this.nowPlaying()) {
      this.audio.toggle();
      return;
    }
    if (same && this.audio.state() === 'paused') this.audio.toggle();
    else this.audio.play({ surah: v.surah, ayah: v.ayah }, v.page);
    this.history.close();
  }

  /** undefined = loading, null = unavailable. */
  protected readonly latinText = signal<string | null | undefined>(undefined);
  protected readonly latinCollapsed = signal(readCollapsed());
  protected readonly latinSource = computed(() => {
    const src = this.latin.source();
    return src ? src.origin || src.name : null;
  });
  private latinSeq = 0;

  private readonly translation = inject(TranslationService);
  protected readonly trText = signal<string | null | undefined>(undefined);
  protected readonly trCollapsed = signal(readFlag(TR_KEY));
  protected readonly trSource = computed(() => {
    const src = this.translation.source();
    return src?.name && src.edition
      ? `${src.name} · ${src.edition}`
      : 'Terjemahan Kemenag RI (edisi 2019)';
  });
  private trSeq = 0;

  private readonly tafsir = inject(TafsirService);
  /** Collapsed by default for every ayah: the texts are long. */
  protected readonly tafsirOpen = signal(false);
  /** undefined = loading, null = unavailable. */
  protected readonly tafsirText = signal<string | null | undefined>(undefined);
  protected readonly tafsirParagraphs = computed(() => {
    const t = this.tafsirText();
    return t ? t.split(/\n{2,}/).filter((p) => p.trim()) : null;
  });
  private tafsirSeq = 0;

  constructor() {
    effect(() => {
      const v = this.ui.selectedVerse();
      untracked(() => {
        const ref = v ? { surah: v.surah, ayah: v.ayah } : null;
        if (ref) this.arabic.preload();
        this.loadLatin(ref);
        this.loadTr(ref);
        this.tafsirOpen.set(false);
        this.tafsirSeq++;
        this.tafsirText.set(undefined);
      });
    });
  }

  private loadTr(ref: { surah: number; ayah: number } | null): void {
    const seq = ++this.trSeq;
    this.trText.set(undefined);
    if (!ref) return;
    this.translation
      .get(ref)
      .then((t) => seq === this.trSeq && this.trText.set(t))
      .catch(() => seq === this.trSeq && this.trText.set(null));
  }

  protected toggleTafsir(): void {
    const open = !this.tafsirOpen();
    this.tafsirOpen.set(open);
    if (open) this.loadTafsir();
  }

  protected retryTafsir(): void {
    this.loadTafsir();
  }

  private loadTafsir(): void {
    const v = this.ui.selectedVerse();
    const seq = ++this.tafsirSeq;
    this.tafsirText.set(undefined);
    if (!v) return;
    this.tafsir
      .get({ surah: v.surah, ayah: v.ayah })
      .then((t) => seq === this.tafsirSeq && this.tafsirText.set(t))
      .catch(() => seq === this.tafsirSeq && this.tafsirText.set(null));
  }

  protected toggleTr(): void {
    const next = !this.trCollapsed();
    this.trCollapsed.set(next);
    writeFlag(TR_KEY, next);
  }

  protected async copyTr(): Promise<void> {
    const v = this.ui.selectedVerse();
    const t = this.trText();
    const surah = v ? this.content.index()?.surahs[v.surah - 1] : undefined;
    if (!v || !t || !surah) return;
    this.ui.showToast({
      message: (await copyText(translationCopyText(surah, v.ayah, t)))
        ? 'Terjemahan disalin'
        : 'Terjemahan gagal disalin',
    });
  }

  private loadLatin(ref: { surah: number; ayah: number } | null): void {
    const seq = ++this.latinSeq;
    this.latinText.set(undefined);
    if (!ref) return;
    this.latin
      .get(ref)
      .then((t) => seq === this.latinSeq && this.latinText.set(t))
      .catch(() => seq === this.latinSeq && this.latinText.set(null));
  }

  protected toggleLatin(): void {
    const next = !this.latinCollapsed();
    this.latinCollapsed.set(next);
    try {
      localStorage.setItem(LATIN_KEY, next ? '1' : '0');
    } catch {
      // storage unavailable: preference is session-only
    }
  }

  protected async copyLatin(): Promise<void> {
    const v = this.ui.selectedVerse();
    const t = this.latinText();
    const surah = v ? this.content.index()?.surahs[v.surah - 1] : undefined;
    if (!v || !t || !surah) return;
    this.ui.showToast({
      message: (await copyText(latinCopyText(surah, v.ayah, t)))
        ? 'Bacaan disalin'
        : 'Bacaan gagal disalin',
    });
  }

  protected readonly info = computed(() => {
    const v = this.ui.selectedVerse();
    const index = this.content.index();
    if (!v || !index) return null;
    const surah = index.surahs[v.surah - 1];
    if (!surah) return null;
    this.userData.bookmarks(); // reactive dependency for the bookmarked flag
    return {
      title: `${surah.nameLatin} · Ayat ${v.ayah}`,
      sub: `Surah ${surah.number} · Hal. ${v.page} · Juz ${this.content.juzAt(v.page).number}`,
      bookmarked: this.bookmarkToggle.isVerseBookmarked({ surah: v.surah, ayah: v.ayah }),
      reference: verseReference(surah, v.ayah, v.page),
    };
  });

  protected toggleBookmark(): Promise<void> {
    const v = this.ui.selectedVerse();
    if (!v) return Promise.resolve();
    return this.bookmarkToggle.toggleVerse({ surah: v.surah, ayah: v.ayah }, v.page);
  }

  /**
   * Text for Salin/Bagikan: reference, Arabic (Latin when the Arabic file cannot be
   * loaded), Kemenag translation and the deep link on this app's origin.
   */
  private async verseText(): Promise<string | null> {
    const v = this.ui.selectedVerse();
    const ref = this.info()?.reference;
    if (!v || !ref) return null;
    const ayah = { surah: v.surah, ayah: v.ayah };
    // Already in memory in the normal case (preloaded when the sheet opened); otherwise
    // wait briefly so a slow connection does not delay sharing, then fall back to Latin.
    const arabic =
      this.arabic.peek(ayah) ??
      (await Promise.race([
        this.arabic.get(ayah),
        new Promise<null>((r) => setTimeout(() => r(null), ARABIC_WAIT_MS)),
      ]));
    return shareText({
      reference: ref,
      arabic,
      latin: this.latinText(),
      translation: this.trText(),
      url: verseUrl(location.origin, v.surah, v.ayah),
    });
  }

  protected async copy(): Promise<void> {
    const text = await this.verseText();
    if (!text) return;
    this.ui.showToast({
      message: (await copyText(text)) ? 'Ayat disalin' : 'Ayat gagal disalin',
    });
  }

  protected async share(): Promise<void> {
    const text = await this.verseText();
    if (!text) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // fall through to copy
      }
    }
    this.ui.showToast({
      message: (await copyText(text)) ? 'Teks ayat disalin untuk dibagikan' : 'Teks gagal disalin',
    });
  }
}

/** Longest wait for the Arabic file before sharing falls back to the Latin text. */
const ARABIC_WAIT_MS = 2000;

const LATIN_KEY = 'mf-latin-collapsed';

const TR_KEY = 'mf-translation-collapsed';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // storage unavailable: preference is session-only
  }
}

function readCollapsed(): boolean {
  return readFlag(LATIN_KEY);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

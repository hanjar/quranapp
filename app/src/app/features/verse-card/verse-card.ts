import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { ArabicTextService } from '../../core/content/arabic.service';
import { QcfService } from '../../core/content/qcf.service';
import { TranslationService } from '../../core/content/translation.service';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { luminance, normalizeHex } from '../../core/custom-theme';
import { ReaderUiService } from '../../core/reader-ui.service';
import { CardFormat, GlyphWord, cardFileName, wordsOnPage } from './verse-card-layout';
import { CardBackdrop, CardColors, renderVerseCard } from './verse-card-render';
import { CARD_BACKGROUNDS, PHOTO_BACKGROUNDS, photoBackgroundUrl } from './card-backgrounds';

/** Day colours used when the app is in night mode (the glyph ink is dark). */
const DAY_FALLBACK: CardColors = {
  paper: '#f4ecd8',
  surround: '#e2d3b3',
  frame: '#6e4a24',
  ink: '#2b2117',
  accent: '#a07a2c',
};

/**
 * "Gambar ayat": a shareable image of one ayah (mushaf glyphs, Kemenag translation, braided frame
 * in the current theme's colours), for WhatsApp / Instagram. Opened from the verse sheet.
 */
@Component({
  selector: 'app-verse-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali ke mushaf" (click)="back()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 class="mf-display">Gambar ayat</h1>
    </header>

    <main class="wrap">
      <div class="preview" [class.is-story]="format() === 'story'">
        @if (url(); as u) {
          <img [src]="u" [alt]="'Gambar ' + reference()" />
        } @else if (failed()) {
          <p class="status">Gambar belum bisa dibuat. Periksa koneksi lalu coba lagi.</p>
        } @else {
          <p class="status">Membuat gambar…</p>
        }
      </div>

      <div class="bgs" role="radiogroup" aria-label="Latar">
        <button type="button" role="radio" class="bg" [attr.aria-checked]="bg() === 'theme'" (click)="bg.set('theme')">
          <span class="bg__thumb bg__thumb--theme" aria-hidden="true"></span>
          <span class="bg__label">Tema</span>
        </button>
        @for (b of backgrounds; track b.id) {
          <button type="button" role="radio" class="bg" [attr.aria-checked]="bg() === b.id" (click)="bg.set(b.id)">
            <img class="bg__thumb" [src]="b.thumb" alt="" />
            <span class="bg__label">{{ b.label }}</span>
          </button>
        }
        <label class="bg" [class.is-on]="bg() === 'photo'">
          <input type="file" accept="image/*" class="mf-visually-hidden" (change)="pickPhoto($event)" />
          @if (photoThumb(); as t) {
            <img class="bg__thumb" [src]="t" alt="" />
          } @else {
            <span class="bg__thumb bg__thumb--photo" aria-hidden="true">+</span>
          }
          <span class="bg__label">Foto saya</span>
        </label>
      </div>

      <div class="opts">
        <div class="seg" role="radiogroup" aria-label="Ukuran">
          <button type="button" role="radio" [attr.aria-checked]="format() === 'post'" (click)="format.set('post')">
            Post 4:5
          </button>
          <button type="button" role="radio" [attr.aria-checked]="format() === 'story'" (click)="format.set('story')">
            Story 9:16
          </button>
        </div>
        <label class="check">
          <input type="checkbox" [checked]="withTranslation()" (change)="withTranslation.set(!withTranslation())" />
          Terjemahan
        </label>
        <label class="check">
          <input type="checkbox" data-testid="card-tajweed" [checked]="tajweed()" (change)="setTajweed(!tajweed())" />
          Tajwid berwarna
        </label>
      </div>

      <div class="actions">
        <button type="button" class="mf-btn mf-btn--outline" [disabled]="!blob()" (click)="save()">Simpan</button>
        <button type="button" class="mf-btn mf-btn--primary" data-testid="card-share" [disabled]="!blob()" (click)="share()">
          Bagikan
        </button>
      </div>
      <p class="note">
        Teks Arab dari mushaf Madinah (font QCF V4, King Fahd Complex), terjemahan Kemenag RI.
        Gambar memakai warna tema Anda.
      </p>
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
    }
    .top {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: calc(var(--mf-safe-top) + 6px) 8px 6px;
      background: var(--ui-surface);
      border-bottom: 1px solid var(--ui-hair);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
    }
    .wrap {
      max-width: 560px;
      margin: 0 auto;
      padding: 16px 16px calc(var(--mf-safe-bottom) + 32px);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .preview {
      display: grid;
      place-items: center;
      aspect-ratio: 4 / 5;
      max-height: 62svh;
      border-radius: 12px;
      background: color-mix(in srgb, var(--ui-ink) 5%, transparent);
      overflow: hidden;
    }
    .preview.is-story {
      aspect-ratio: 9 / 16;
    }
    .preview img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .status {
      margin: 0;
      padding: 16px;
      text-align: center;
      color: var(--ui-muted);
      font-size: 14px;
    }
    .bgs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: thin;
    }
    .bg {
      flex: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: 66px;
      padding: 0;
      border: none;
      background: none;
      color: var(--ui-ink);
      font: inherit;
      cursor: pointer;
    }
    .bg__thumb {
      width: 60px;
      height: 75px;
      border-radius: 8px;
      object-fit: cover;
      border: 2px solid transparent;
      box-sizing: border-box;
    }
    .bg[aria-checked='true'] .bg__thumb,
    .bg.is-on .bg__thumb {
      border-color: var(--ui-primary);
    }
    .bg__thumb--theme {
      background: var(--mf-paper);
      outline: 3px solid var(--mf-frame-ink);
      outline-offset: -8px;
    }
    .bg__thumb--photo {
      display: grid;
      place-items: center;
      font-size: 26px;
      color: var(--ui-muted);
      border: 2px dashed var(--ui-hair);
    }
    .bg__label {
      font-size: 11.5px;
      text-align: center;
      line-height: 1.2;
    }
    .opts {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .seg {
      display: flex;
      border: 1px solid var(--ui-hair);
      border-radius: var(--mf-radius-pill);
      overflow: hidden;
    }
    .seg button {
      min-height: 40px;
      padding: 0 14px;
      border: none;
      background: transparent;
      color: var(--ui-ink);
      font-size: 14px;
    }
    .seg button[aria-checked='true'] {
      background: var(--ui-primary);
      color: var(--ui-on-primary, #fff);
    }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      font-size: 14px;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 10px;
    }
    .note {
      margin: 0;
      color: var(--ui-muted);
      font-size: 12.5px;
      line-height: 1.5;
    }
  `,
})
export class VerseCard {
  private readonly content = inject(ContentApi);
  private readonly qcf = inject(QcfService);
  private readonly translation = inject(TranslationService);
  private readonly arabic = inject(ArabicTextService);
  private readonly ui = inject(ReaderUiService);
  private readonly userData = inject(UserDataApi);
  private readonly router = inject(Router);

  /** Route params (component input binding). */
  readonly surah = input<string>('1');
  readonly ayah = input<string>('1');

  protected readonly format = signal<CardFormat>('post');
  protected readonly withTranslation = signal(true);
  /** Tajweed colours on the mushaf glyphs (remembered on this device). */
  protected readonly tajweed = signal(readTajweed());
  protected readonly blob = signal<Blob | null>(null);
  protected readonly url = signal<string | null>(null);
  protected readonly failed = signal(false);
  /** 'theme' (paper + braided band), a drawn background id, or 'photo'. */
  protected readonly bg = signal<string>('theme');
  /** Photos first (`img:<id>`), then the drawn ones. */
  protected readonly backgrounds = [
    ...PHOTO_BACKGROUNDS.map((p) => ({ id: `img:${p.id}`, label: p.label, thumb: photoBackgroundUrl(p.id, 'thumb') })),
    ...CARD_BACKGROUNDS.map((b) => ({ id: b.id, label: b.label, thumb: thumbnail(b.draw) })),
  ];
  private readonly photoCache = new Map<string, Promise<ImageBitmap>>();
  private readonly photo = signal<ImageBitmap | null>(null);
  protected readonly photoThumb = signal<string | null>(null);

  private readonly ref = computed(() => ({
    surah: clampInt(this.surah(), 1, 114),
    ayah: Math.max(1, Math.trunc(Number(this.ayah())) || 1),
  }));
  protected readonly reference = computed(() => {
    const r = this.ref();
    const name = this.content.index() ? this.content.surah(r.surah).nameLatin : `Surah ${r.surah}`;
    return `QS. ${name} [${r.surah}]: ${r.ayah}`;
  });
  private seq = 0;

  constructor() {
    effect(() => {
      const r = this.ref();
      const f = this.format();
      const tr = this.withTranslation();
      this.tajweed();
      this.bg();
      this.photo();
      this.content.index();
      untracked(() => void this.build(r, f, tr));
    });
    inject(DestroyRef).onDestroy(() => this.setUrl(null));
  }

  private async build(r: { surah: number; ayah: number }, format: CardFormat, withTr: boolean): Promise<void> {
    const seq = ++this.seq;
    this.failed.set(false);
    try {
      const [glyphs, translation, arabic] = await Promise.all([
        this.glyphs(r),
        withTr ? this.translation.get(r) : Promise.resolve(null),
        this.arabic.get(r).catch(() => null),
      ]);
      await Promise.all([
        document.fonts.load("38px 'Mf Read Poppins'"),
        document.fonts.load("600 38px 'Mf Read Poppins'"),
      ]).catch(() => undefined);
      const idx = this.content.index();
      const name = idx ? this.content.surah(r.surah).nameLatin : `Surah ${r.surah}`;
      const canvas = await renderVerseCard(
        {
          title: `${name} · Ayat ${r.ayah}`,
          reference: this.reference(),
          glyphs,
          arabic,
          translation,
          tajweed: this.tajweed(),
          footer: `Mushaf Digital · ${location.host}`,
          credit: glyphs.length
            ? 'Mushaf Madinah (KFGQPC QCF V4) · Terjemahan Kemenag RI'
            : 'Teks dan terjemahan Kemenag RI',
        },
        this.colors(),
        format,
        await this.backdropFor(format),
      );
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (seq !== this.seq) return;
      if (!blob) throw new Error('blob');
      this.blob.set(blob);
      this.setUrl(URL.createObjectURL(blob));
    } catch {
      if (seq === this.seq) this.failed.set(true);
    }
  }

  /** Mushaf glyphs of the ayah, across a page break when needed; [] when QCF is unavailable. */
  private async glyphs(r: { surah: number; ayah: number }): Promise<GlyphWord[]> {
    const start = this.content.index() ? this.content.pageOf(r) : null;
    if (!start) return [];
    const key = `${r.surah}:${r.ayah}`;
    const out: GlyphWord[] = [];
    try {
      for (let p = start; p <= Math.min(604, start + 2); p++) {
        const data = await this.qcf.load(p);
        const { words, ended } = wordsOnPage(data.layout, data.family, key);
        out.push(...words);
        if (ended) return out;
      }
      return out;
    } catch {
      return [];
    }
  }

  /** The theme's day colours; night mode falls back to a warm day palette (glyph ink is dark). */
  private colors(): CardColors {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => normalizeHex(css.getPropertyValue(n).trim());
    const paper = v('--mf-paper');
    if (!paper || luminance(paper) < 0.4) return DAY_FALLBACK;
    return {
      paper,
      surround: v('--mf-surround') ?? DAY_FALLBACK.surround,
      frame: v('--mf-frame-ink') ?? DAY_FALLBACK.frame,
      ink: v('--mf-text-ink') ?? DAY_FALLBACK.ink,
      accent: v('--mf-ayah-ornament') ?? DAY_FALLBACK.accent,
    };
  }

  private async backdropFor(format: CardFormat): Promise<CardBackdrop | null> {
    const id = this.bg();
    if (id.startsWith('img:')) {
      const url = photoBackgroundUrl(id.slice(4), format);
      let p = this.photoCache.get(url);
      if (!p) {
        p = fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.blob();
          })
          .then((b) => createImageBitmap(b));
        p.catch(() => this.photoCache.delete(url));
        this.photoCache.set(url, p);
      }
      return { image: await p };
    }
    if (id === 'photo') {
      const p = this.photo();
      return p ? { image: p } : null;
    }
    const b = CARD_BACKGROUNDS.find((x) => x.id === id);
    return b ? { draw: b.draw } : null;
  }

  /** "Foto saya": stays on this device, only drawn into the image. */
  protected async pickPhoto(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      this.photo()?.close();
      this.photo.set(bmp);
      this.photoThumb.set(thumbnail((ctx, w, h) => {
        const sc = Math.max(w / bmp.width, h / bmp.height);
        ctx.drawImage(bmp, (w - bmp.width * sc) / 2, (h - bmp.height * sc) / 2, bmp.width * sc, bmp.height * sc);
      }));
      this.bg.set('photo');
    } catch {
      this.ui.showToast({ message: 'Foto tidak bisa dibuka. Coba foto lain.' });
    }
  }

  protected setTajweed(on: boolean): void {
    this.tajweed.set(on);
    try {
      localStorage.setItem(TAJWEED_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked: lasts for this page */
    }
  }

  private setUrl(u: string | null): void {
    const old = this.url();
    if (old) URL.revokeObjectURL(old);
    this.url.set(u);
  }

  private file(): File | null {
    const b = this.blob();
    const r = this.ref();
    return b ? new File([b], cardFileName(r.surah, r.ayah), { type: 'image/png' }) : null;
  }

  protected async share(): Promise<void> {
    const f = this.file();
    if (!f) return;
    const r = this.ref();
    const link = `${location.origin}/${r.surah}/${r.ayah}`;
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] })) {
      try {
        await navigator.share({ files: [f], text: `${this.reference()}\n${link}` });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    this.save();
    this.ui.showToast({ message: 'Perangkat ini belum bisa membagikan gambar langsung. Gambar disimpan.' });
  }

  protected save(): void {
    const f = this.file();
    const u = this.url();
    if (!f || !u) return;
    const a = document.createElement('a');
    a.href = u;
    a.download = f.name;
    a.click();
  }

  protected back(): void {
    const r = this.ref();
    const page = (this.content.index() ? this.content.pageOf(r) : null) ?? this.userData.position()?.page ?? 1;
    void this.router.navigate(['/hal', page]);
  }
}

const TAJWEED_KEY = 'mf-card-tajweed';

function readTajweed(): boolean {
  try {
    return localStorage.getItem(TAJWEED_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Small preview of a drawn background (drawn at card size, scaled down). */
function thumbnail(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): string {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 150;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.scale(120 / 1080, 150 / 1350);
  draw(ctx, 1080, 1350);
  return c.toDataURL('image/jpeg', 0.8);
}

function clampInt(raw: string, lo: number, hi: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

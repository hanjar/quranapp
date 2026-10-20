import { LOCAL_WRITE_TIMEOUT_MS, withTimeout } from '../../core/async';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { LatinService } from '../../core/content/latin.service';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { SheetHistory } from './sheet-history';
import { latinCopyText, verseReference } from './nav-helpers';

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
              <p class="muted">Bacaan Latin belum tersedia (perlu koneksi untuk memuat pertama kali).</p>
            }
          </div>
        }
      </section>
      <div class="grid">
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
        <button type="button" class="act" (click)="copy()">
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
          Salin rujukan
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
        <button type="button" class="act" (click)="history.close()">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          Tutup
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
    .latin { display: flex; flex-direction: column; gap: var(--mf-space-2); }
    .latin-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .latin-toggle, .latin-copy { min-height: var(--mf-tap); padding: 0 var(--mf-space-2); border: none; background: transparent; color: var(--ui-primary); font-size: 13px; font-weight: 500; }
    .latin-text { margin: 0; font-size: 16.5px; line-height: 1.6; font-style: normal; user-select: text; -webkit-user-select: text; }
    .latin-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .attr { font-size: 11.5px; color: var(--ui-muted); }
    .muted { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--ui-muted); }
    .skeleton { display: flex; flex-direction: column; gap: 8px; padding: 6px 0; }
    .skeleton span { height: 14px; border-radius: 7px; background: color-mix(in srgb, var(--ui-ink) 8%, transparent); animation: mf-pulse 1.2s ease-in-out infinite; }
    .skeleton .short { width: 60%; }
    @keyframes mf-pulse { 50% { opacity: 0.45; } }
    @media (prefers-reduced-motion: reduce) { .skeleton span { animation: none; } }
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
  private readonly latin = inject(LatinService);

  /** undefined = loading, null = unavailable. */
  protected readonly latinText = signal<string | null | undefined>(undefined);
  protected readonly latinCollapsed = signal(readCollapsed());
  protected readonly latinSource = computed(() => {
    const src = this.latin.source();
    return src ? src.origin || src.name : null;
  });
  private latinSeq = 0;

  constructor() {
    effect(() => {
      const v = this.ui.selectedVerse();
      untracked(() => this.loadLatin(v ? { surah: v.surah, ayah: v.ayah } : null));
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
      message: (await copyText(latinCopyText(surah, v.ayah, t))) ? 'Bacaan disalin' : 'Bacaan gagal disalin',
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
      bookmarked: this.userData.isVerseBookmarked({ surah: v.surah, ayah: v.ayah }),
      reference: verseReference(surah, v.ayah, v.page),
    };
  });

  protected async toggleBookmark(): Promise<void> {
    const v = this.ui.selectedVerse();
    if (!v) return;
    const ref = { surah: v.surah, ayah: v.ayah };
    try {
      const result = await withTimeout(
        this.userData.toggleVerseBookmark(ref, v.page),
        LOCAL_WRITE_TIMEOUT_MS,
      );
      this.ui.showToast({
        message: result === 'added' ? 'Ayat ditandai' : 'Penanda dihapus',
        actionLabel: 'Urungkan',
        action: () => void this.userData.toggleVerseBookmark(ref, v.page),
      });
    } catch (e) {
      console.error('[bookmark] verse toggle failed', e);
      this.ui.showToast({
        message: 'Penanda gagal disimpan. Tutup tab lain aplikasi ini lalu muat ulang.',
        duration: 8000,
      });
    }
  }

  protected async copy(): Promise<void> {
    const text = this.info()?.reference;
    if (!text) return;
    this.ui.showToast({
      message: (await copyText(text)) ? 'Rujukan disalin' : 'Rujukan gagal disalin',
    });
  }

  protected async share(): Promise<void> {
    const text = this.info()?.reference;
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
      message: (await copyText(text)) ? 'Rujukan disalin' : 'Rujukan gagal disalin',
    });
  }
}

const LATIN_KEY = 'mf-latin-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(LATIN_KEY) === '1';
  } catch {
    return false;
  }
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

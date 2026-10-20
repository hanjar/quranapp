import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { SheetHistory } from './sheet-history';
import { verseReference } from './nav-helpers';

@Component({
  selector: 'app-verse-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as v) {
      <div class="head">
        <div class="title">{{ v.title }}</div>
        <div class="sub">{{ v.sub }}</div>
      </div>
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
      padding: var(--mf-space-1) var(--mf-space-5) var(--mf-space-6);
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
    .grid {
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
      const result = await this.userData.toggleVerseBookmark(ref, v.page);
      this.ui.showToast({
        message: result === 'added' ? 'Ayat ditandai' : 'Penanda dihapus',
        actionLabel: 'Urungkan',
        action: () => void this.userData.toggleVerseBookmark(ref, v.page),
      });
    } catch {
      this.ui.showToast({ message: 'Penanda gagal disimpan' });
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

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { Bookmark } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { formatDate } from './nav-helpers';
import { SheetHistory } from './sheet-history';

type BmTab = 'verse' | 'page';

@Component({
  selector: 'app-bookmarks-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (last(); as l) {
      <button type="button" class="last" (click)="openLast()">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2" />
        </svg>
        <span class="lmain">
          <span class="mf-eyebrow lbl">Posisi terakhir</span>
          <span class="ltitle">{{ l.label }}</span>
        </span>
        <span class="open">Buka</span>
      </button>
    }

    <button type="button" class="mf-btn mf-btn--outline manage" (click)="history.navigateUrl('/penanda')">Kelola</button>

    <div class="mf-segmented" role="tablist" aria-label="Jenis penanda">
      <button
        type="button"
        role="tab"
        [attr.aria-selected]="tab() === 'verse'"
        (click)="tab.set('verse')"
      >
        Ayat
      </button>
      <button
        type="button"
        role="tab"
        [attr.aria-selected]="tab() === 'page'"
        (click)="tab.set('page')"
      >
        Halaman
      </button>
    </div>

    @for (r of rows(); track r.id) {
      <div class="item">
        <svg
          class="flag"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          stroke-width="1.4"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
        </svg>
        <button type="button" class="go" (click)="open(r.bookmark)">
          <span class="title">{{ r.title }}</span>
          <span class="sub">{{ r.sub }}</span>
          @if (r.folderName) { <span class="tag">{{ r.folderName }}</span> }
          @if (r.bookmark.note) { <span class="note">{{ r.bookmark.note }}</span> }
        </button>
        <button
          type="button"
          class="mf-icon-btn del"
          [attr.aria-label]="'Hapus penanda ' + r.title"
          (click)="remove(r.bookmark)"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
          </svg>
        </button>
      </div>
    } @empty {
      <div class="emptystate">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke-width="1.4"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
        </svg>
        <div class="etitle">
          {{ tab() === 'verse' ? 'Belum ada ayat ditandai' : 'Belum ada halaman ditandai' }}
        </div>
        <div class="ehint">
          {{
            tab() === 'verse'
              ? 'Ketuk sebuah ayat, lalu pilih Tandai.'
              : 'Tampilkan kontrol, lalu ketuk ikon penanda di bilah bawah.'
          }}
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: var(--mf-space-1) var(--mf-space-5) var(--mf-space-6);
      color: var(--ui-ink);
    }
    .last {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: var(--mf-radius-lg);
      border: 1px solid var(--ui-primary);
      background: transparent;
      text-align: left;
      color: var(--ui-primary);
      min-height: var(--mf-tap);
    }
    .lmain {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lbl {
      color: var(--ui-primary);
    }
    .ltitle {
      font-size: 15px;
      font-weight: 500;
      color: var(--ui-ink);
    }
    .open {
      font-size: 13px;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0 6px 4px;
      border-bottom: 1px solid var(--ui-hair);
    }
    .flag {
      flex: none;
      fill: var(--ui-accent-icon);
      stroke: var(--ui-accent-icon);
    }
    .go {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      justify-content: center;
      min-height: var(--mf-tap);
      padding: 2px 4px;
      border: none;
      background: transparent;
      text-align: left;
      color: var(--ui-ink);
    }
    .title {
      font-size: 15px;
      font-weight: 500;
    }
    .sub {
      font-size: 12.5px;
      color: var(--ui-muted);
    }
    .tag { font-size: 12px; color: var(--ui-accent-ink); }
    .note { font-size: 12.5px; font-style: italic; color: var(--ui-ink2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .manage { align-self: flex-start; min-height: var(--mf-tap); }
    .del {
      flex: none;
      color: var(--ui-muted);
    }
    .emptystate {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      text-align: center;
      padding: 28px 12px;
    }
    .emptystate svg {
      stroke: var(--ui-accent-icon);
    }
    .etitle {
      font-family: var(--ui-display);
      font-size: 19px;
    }
    .ehint {
      font-size: 14px;
      line-height: 1.5;
      color: var(--ui-ink2);
      max-width: 280px;
    }
  `,
})
export class BookmarksSheet {
  private readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly userData = inject(UserDataApi);
  protected readonly history = inject(SheetHistory);

  protected readonly tab = signal<BmTab>('verse');

  protected readonly last = computed(() => {
    const pos = this.userData.position();
    const index = this.content.index();
    if (!pos || !index) return null;
    const surah = index.surahs[(pos.surah ?? this.content.surahAt(pos.page).number) - 1];
    const parts = [`Halaman ${pos.page}`, surah?.nameLatin ?? ''];
    if (pos.ayah) parts.push(`Ayat ${pos.ayah}`);
    if (pos.updatedAt > 0) parts.push(formatDate(pos.updatedAt));
    return { label: parts.filter(Boolean).join(' · ') };
  });

  protected readonly rows = computed(() => {
    const index = this.content.index();
    if (!index) return [];
    const kind = this.tab();
    const folders = this.userData.folders();
    const folderName = (b: Bookmark) => folders.find((f) => f.id === b.folderId)?.name ?? null;
    return this.userData
      .bookmarks()
      .filter((b) => b.kind === kind)
      .map((b) => {
        const date = formatDate(b.createdAt);
        if (b.kind === 'verse' && b.surah && b.ayah) {
          const name = index.surahs[b.surah - 1]?.nameLatin ?? `Surah ${b.surah}`;
          return {
            id: b.id,
            bookmark: b,
            title: `${name} · Ayat ${b.ayah}`,
            sub: `Hal. ${b.page} · ${date}`,
          };
        }
        const surah = this.content.surahAt(b.page).nameLatin;
        return {
          id: b.id,
          bookmark: b,
          folderName: folderName(b),
          title: `Halaman ${b.page} · ${surah}`,
          sub: `Juz ${this.content.juzAt(b.page).number} · ${date}`,
        };
      });
  });

  protected openLast(): void {
    const pos = this.userData.position();
    if (!pos) return;
    const highlight = pos.surah && pos.ayah ? { surah: pos.surah, ayah: pos.ayah } : null;
    this.history.navigateTo(pos.page, { highlight });
  }

  protected open(b: Bookmark): void {
    const highlight =
      b.kind === 'verse' && b.surah && b.ayah ? { surah: b.surah, ayah: b.ayah } : null;
    this.history.navigateTo(b.page, { highlight });
  }

  protected async remove(b: Bookmark): Promise<void> {
    try {
      const undo = await this.userData.removeBookmark(b.id);
      this.ui.showToast({
        message: 'Penanda dihapus',
        actionLabel: 'Urungkan',
        action: () => void undo(),
        duration: 6000,
      });
    } catch {
      this.ui.showToast({ message: 'Penanda gagal dihapus' });
    }
  }
}

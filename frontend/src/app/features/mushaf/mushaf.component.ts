import { Component, inject, signal, OnInit, HostListener, ElementRef, viewChild, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageMappingService } from '../../core/services/page-mapping.service';
import { QuranDataService } from '../../core/services/quran-data.service';
import { AudioService } from '../../core/services/audio.service';
import { BookmarkService } from '../../core/services/bookmark.service';
import { QpcFontLoaderService } from '../../core/services/qpc-font-loader.service';
import { MushafLine, MushafWord, MushafPageDataV2 } from '../../core/models/surah.model';
import { FloatingMenuComponent } from './floating-menu.component';


import { BookmarkModalComponent } from '../../shared/components/bookmark-modal.component';

@Component({
  selector: 'app-mushaf',
  imports: [CommonModule, FloatingMenuComponent, BookmarkModalComponent],
  template: `
    <div class="mushaf-page-frame">
      <div
        class="mushaf-page"
        [class.centered-page]="isCenteredPage()"
        [class.font-loading]="fontLoading()"
        #pageContainer
      >
        @if (fontLoading()) {
          <div class="loading-overlay">
            <div class="loading-spinner"></div>
          </div>
        }

        <div class="mushaf-lines" dir="rtl">
          @for (line of lines(); track line.line) {
            @switch (line.type) {
              @case ('surah-header') {
                <div class="mushaf-line surah-header-line">
                  <span class="surah-header-text arabic-ui">{{ line.text }}</span>
                </div>
              }
              @case ('basmala') {
                <div class="mushaf-line basmala-line">
                  <span class="basmala-text arabic-ui">بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ</span>
                </div>
              }
              @case ('text') {
                <div
                  class="mushaf-line text-line"
                  [style.font-family]="fontFamily()"
                >
                  @for (word of line.words; track $index) {
                    <span
                      class="qpc-word"
                      [class.playing]="isPlayingWord(word)"
                      [class.bookmarked-word]="isBookmarkedWord(word)"
                      [attr.data-location]="word.location"
                      (click)="onWordClick($event, word)"
                    >{{ word.qpc }}</span>{{" "}}
                  }
                </div>
              }
            }
          }
        </div>

        <!-- Translation card (shown below the line containing the selected ayah) -->
        @if (translationKey()) {
          <div class="translation-card" dir="ltr" (click)="$event.stopPropagation()">
            <div class="translation-ref latin-ui">{{ translationRef() }}</div>
            <div class="translation-text latin-ui">{{ translationText() }}</div>
          </div>
        }

        @if (menuVisible()) {
          <app-floating-menu
            [top]="menuTop()"
            [left]="menuLeft()"
            (bookmark)="onBookmark()"
            (translate)="onTranslate()"
            (play)="onPlay()"
            (note)="onNote()"
          />
        }

        @if (showBookmarkModal()) {
            <app-bookmark-modal 
              [surah]="bookmarkingMeta()?.surah ?? 0"
              [ayah]="bookmarkingMeta()?.ayah ?? 0"
              [surahNameAr]="bookmarkingMeta()?.nameAr ?? ''"
              [surahNameEn]="bookmarkingMeta()?.nameEn ?? ''"
              (close)="showBookmarkModal.set(false)"
            />
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .mushaf-page-frame {
      max-width: 820px;
      margin: 0 auto;
      padding: 8px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .mushaf-page {
      flex: 1;
      position: relative;
      overflow-y: auto;
      background: var(--bg-primary);
      border: 2px solid var(--gold-primary);
      border-radius: 4px;
      box-shadow:
        inset 0 0 0 4px var(--bg-primary),
        inset 0 0 0 5px rgba(196, 168, 124, 0.3),
        0 2px 12px rgba(0, 0, 0, 0.08);
      padding: 12px 16px 20px;
      display: flex;
      flex-direction: column;
    }
    .mushaf-page.centered-page {
      /* Vertical centering for Page 1 & 2 */
      justify-content: center;
      /* Ensure horizontal centering context */
      align-items: center; 
    }
    .mushaf-page.centered-page .mushaf-lines {
      /* Reset justification for centered pages */
      flex: unset; /* Don't force height stretch */
      justify-content: center;
      gap: 12px; /* Add some spacing between lines */
      width: 100%;
      height: auto; /* Allow content to dictate height */
    }
    .mushaf-page.font-loading {
      .mushaf-lines { opacity: 0; }
    }

    /* Loading overlay */
    .loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
    }
    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(196, 168, 124, 0.2);
      border-top-color: var(--gold-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* QPC mushaf lines */
    .mushaf-lines {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: opacity 0.15s;
      width: 100%;
      max-width: 480px; /* Constrained width for neat block */
      margin: 0 auto;
      padding-inline: 8px; /* Extra room so marker circles don't clip on edges */
    }

    .mushaf-line {
      text-align: center; /* Fallback */
      line-height: 1.8;
      min-height: 2em;
    }

    .text-line {
      font-size: clamp(24px, 5.8vw, 29px);
      color: var(--text-primary);
      cursor: pointer;
      text-align: justify;
      text-align-last: justify;
      white-space: nowrap; /* Keep lines on one visual line */
      overflow: visible; /* Allow ayah markers to render fully */
    }
    
    /* Center Page 1 & 2 only */
    .centered-page .text-line {
      text-align: center;
      text-align-last: center;
    }

    .surah-header-line {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 0;
    }
    .surah-header-text {
      font-size: 16px;
      color: var(--gold-dark);
      padding: 6px 24px;
      border: 1.5px solid var(--gold-primary);
      border-radius: 20px;
      background: rgba(196, 168, 124, 0.06);
    }

    .basmala-line {
      padding: 2px 0;
    }
    .basmala-text {
      font-family: 'Amiri Quran', 'Amiri', serif;
      font-size: clamp(18px, 4vw, 24px);
      color: var(--text-primary);
    }

    .qpc-word {
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      border-radius: 3px;
      padding: 0 1px;

      &:hover {
        background: rgba(196, 168, 124, 0.1);
      }
      &.playing {
        background: rgba(196, 168, 124, 0.2);
        color: var(--gold-dark);
      }
      &.bookmarked-word {
        text-decoration: underline;
        text-decoration-color: var(--gold-primary);
        text-underline-offset: 4px;
        text-decoration-thickness: 2px;
      }
    }



    /* Translation card */
    .translation-card {
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 12px 16px;
      margin: 8px 0 12px;
      border-left: 3px solid var(--gold-primary);
    }
    .translation-ref {
      color: var(--text-muted);
      font-size: 11px;
      margin-bottom: 4px;
    }
    .translation-text {
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.7;
    }
    
    @keyframes highlightFlash {
      0%, 100% { background: transparent; }
      50% { background: rgba(196, 168, 124, 0.4); }
    }
    .highlight-flash {
      animation: highlightFlash 1s ease 2;
      border-radius: 4px;
    }
  `,
})
export class MushafComponent implements OnInit {
  private pageMappingService = inject(PageMappingService);
  quranData = inject(QuranDataService);
  private audioService = inject(AudioService);
  bookmarkService = inject(BookmarkService);
  private qpcFont = inject(QpcFontLoaderService);

  private pageContainer = viewChild<ElementRef>('pageContainer');

  lines = signal<MushafLine[]>([]);
  currentPage = signal(1);
  fontLoading = signal(false);

  menuVisible = signal(false);
  menuTop = signal(0);
  menuLeft = signal(0);
  selectedAyah = signal<{ surah: number; ayah: number } | null>(null);
  translationKey = signal<string | null>(null);
  translationRef = signal('');
  translationText = signal('');

  pageChanged = output<{ current: number; total: number }>();

  private translations = new Map<string, string>();

  /** Compute CSS font-family for current page */
  fontFamily = computed(() => {
    const page = this.currentPage();
    return `'${this.qpcFont.getFontFamily(page)}', serif`;
  });

  get totalPages(): number {
    return this.pageMappingService.totalPages;
  }

  isCenteredPage(): boolean {
    const page = this.currentPage();
    return page === 1 || page === 2;
  }

  ngOnInit() {
    this.loadPage(1);
  }

  async loadPage(pageNum: number) {
    const clamped = Math.max(1, Math.min(pageNum, this.totalPages));
    this.closeMenu();
    this.translationKey.set(null);
    this.fontLoading.set(true);

    try {
      // Load font + data in parallel
      const [data] = await Promise.all([
        this.pageMappingService.loadMushafPage(clamped),
        this.qpcFont.loadPageFont(clamped),
      ]);

      this.lines.set(data.lines);
      this.currentPage.set(clamped);
      this.emitPageChange();

      // Preload adjacent pages' fonts
      this.qpcFont.preloadAdjacentPages(clamped);
    } finally {
      this.fontLoading.set(false);
    }

    // Scroll to top of page container
    const container = this.pageContainer()?.nativeElement as HTMLElement;
    if (container) container.scrollTop = 0;
  }

  async loadSurahPage(surahNum: number) {
    const page = await this.pageMappingService.getSurahFirstPage(surahNum);
    await this.loadPage(page);
  }

  scrollToAyah(surah: number, ayah: number) {
    // Find the first word of the ayah
    // location format: "surah:ayah:word"
    // We look for "surah:ayah:1"
    const selector = `[data-location="${surah}:${ayah}:1"]`;
    const container = this.pageContainer()?.nativeElement as HTMLElement;

    // We might need to wait for render if called immediately after loadPage
    // But usually loadPage awaits rendering

    // Retry a few times if not found immediately (e.g. font loading layout shift)
    const attemptScroll = (retries = 0) => {
      const el = container.querySelector(selector) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight effect?
        el.classList.add('highlight-flash');
        setTimeout(() => el.classList.remove('highlight-flash'), 2000);
      } else if (retries < 5) {
        setTimeout(() => attemptScroll(retries + 1), 100);
      }
    };

    attemptScroll();
  }

  nextPage() {
    if (this.currentPage() < this.totalPages) {
      this.loadPage(this.currentPage() + 1);
    }
  }

  prevPage() {
    if (this.currentPage() > 1) {
      this.loadPage(this.currentPage() - 1);
    }
  }

  private emitPageChange() {
    this.pageChanged.emit({ current: this.currentPage(), total: this.totalPages });
  }

  /** Parse "surah:ayah:word" location into {surah, ayah} */
  private parseLocation(loc: string): { surah: number; ayah: number } {
    const [s, a] = loc.split(':').map(Number);
    return { surah: s, ayah: a };
  }

  onWordClick(event: MouseEvent, word: MushafWord) {
    event.stopPropagation();

    const { surah, ayah } = this.parseLocation(word.location);

    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    const container = this.pageContainer()?.nativeElement as HTMLElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const top = rect.top - containerRect.top + container.scrollTop - 60;
    const left = rect.left - containerRect.left + rect.width / 2;

    this.selectedAyah.set({ surah, ayah });
    this.menuTop.set(Math.max(0, top));
    this.menuLeft.set(left);
    this.menuVisible.set(true);
  }

  @HostListener('document:click')
  closeMenu() {
    this.menuVisible.set(false);
    this.selectedAyah.set(null);
  }

  showBookmarkModal = signal(false);
  bookmarkingMeta = signal<{ surah: number; ayah: number; nameAr: string; nameEn: string } | null>(null);

  onBookmark() {
    const sel = this.selectedAyah();
    if (!sel) return;

    if (this.bookmarkService.isBookmarked(sel.surah, sel.ayah)) {
      this.bookmarkService.remove(`${sel.surah}:${sel.ayah}`);
      this.closeMenu();
    } else {
      const meta = this.quranData.getSurahMeta(sel.surah);
      this.bookmarkingMeta.set({
        surah: sel.surah,
        ayah: sel.ayah,
        nameAr: meta?.name ?? '',
        nameEn: meta?.englishName ?? ''
      });
      this.showBookmarkModal.set(true);
      // Close menu so it doesn't overlap modal (or keep open if desired, but user interaction shifts to modal)
      this.closeMenu();
    }
  }

  async onTranslate() {
    const sel = this.selectedAyah();
    if (!sel) return;

    const key = `${sel.surah}:${sel.ayah}`;
    if (this.translationKey() === key) {
      this.translationKey.set(null);
      this.closeMenu();
      return;
    }

    // Load translation if not cached
    if (!this.translations.has(key)) {
      const data = await this.quranData.loadTranslation(sel.surah);
      for (const v of data.verses) {
        this.translations.set(`${sel.surah}:${v.id}`, v.translation);
      }
    }

    const meta = this.quranData.getSurahMeta(sel.surah);
    this.translationRef.set(`${meta?.englishName ?? `Surah ${sel.surah}`} : ${sel.ayah}`);
    this.translationText.set(this.translations.get(key) ?? 'Memuat terjemahan...');
    this.translationKey.set(key);
    this.closeMenu();
  }

  onPlay() {
    const sel = this.selectedAyah();
    if (!sel) return;
    this.audioService.play(sel.surah, sel.ayah);
    this.closeMenu();
  }

  onNote() {
    this.closeMenu();
  }

  isPlayingWord(word: MushafWord): boolean {
    const { surah, ayah } = this.parseLocation(word.location);
    const current = this.audioService.currentAyah();
    return current?.surah === surah && current?.ayah === ayah;
  }

  isBookmarkedWord(word: MushafWord): boolean {
    const { surah, ayah } = this.parseLocation(word.location);
    return this.bookmarkService.isBookmarked(surah, ayah);
  }
}

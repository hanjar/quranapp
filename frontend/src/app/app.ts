import { Component, inject, signal, OnInit, viewChild, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { QuranDataService } from './core/services/quran-data.service';
import { PageMappingService } from './core/services/page-mapping.service';
import { AudioService } from './core/services/audio.service';
import { ThemeService } from './core/services/theme.service'; // Import ThemeService
import { MushafComponent } from './features/mushaf/mushaf.component';
import { AudioBarComponent } from './features/audio/audio-bar.component';
import { SurahListComponent } from './shared/components/surah-list.component';
import { SwipeDirective } from './shared/directives/swipe.directive';
import { GoToDialogComponent } from './features/navigation/go-to-dialog.component';
import { APP_VERSIONS } from './version';

@Component({
  selector: 'app-root',
  imports: [MushafComponent, AudioBarComponent, SurahListComponent, SwipeDirective, RouterOutlet, GoToDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  quranData = inject(QuranDataService);
  pageMappingService = inject(PageMappingService);
  themeService = inject(ThemeService); // Inject ThemeService
  private audioService = inject(AudioService);
  private mushaf = viewChild(MushafComponent);

  themeMenuOpen = signal(false);
  drawerOpen = signal(false);
  currentSurahNumber = signal(1);
  currentPage = signal(1);
  totalPages = signal(604);
  readonly versions = APP_VERSIONS;


  /** Immersive reading mode — hides header & nav for distraction-free reading */
  immersiveMode = signal(true);
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit() {
    await this.quranData.loadSurahList();
    this.audioService.setSurahMetas(this.quranData.surahs());
  }

  async onSelectSurah(number: number) {
    this.currentSurahNumber.set(number);
    this.mushaf()?.loadSurahPage(number);
    this.drawerOpen.set(false);
  }

  async onSelectBookmark(bookmark: import('./core/models/bookmark.model').Bookmark) {
    this.drawerOpen.set(false);
    try {
      const page = await this.pageMappingService.getAyahPage(bookmark.surah, bookmark.ayah);
      await this.mushaf()?.loadPage(page);
      // Wait for page to render then scroll
      setTimeout(() => {
        this.mushaf()?.scrollToAyah(bookmark.surah, bookmark.ayah);
      }, 100);
    } catch (e) {
      console.error('Failed to navigate to bookmark', e);
    }
  }

  onPageChanged(event: { current: number; total: number }) {
    this.currentPage.set(event.current);
    this.totalPages.set(event.total);

    // Update current surah from mushaf page data
    const mushafPage = this.pageMappingService.currentMushafPage();
    if (mushafPage && mushafPage.lines.length > 0) {
      // Find the first text line to get surah number
      const firstTextLine = mushafPage.lines.find(l => l.type === 'text' && l.words?.length);
      if (firstTextLine?.words?.[0]) {
        const surahNum = parseInt(firstTextLine.words[0].location.split(':')[0]);
        if (!isNaN(surahNum)) {
          this.currentSurahNumber.set(surahNum);
        }
      }
    }
  }

  prevPage() {
    this.mushaf()?.prevPage();
  }

  nextPage() {
    this.mushaf()?.nextPage();
  }

  getSurahName(): string {
    return this.quranData.getSurahMeta(this.currentSurahNumber())?.name ?? '';
  }

  getSurahEnglish(): string {
    return this.quranData.getSurahMeta(this.currentSurahNumber())?.englishName ?? '';
  }

  // ── Immersive Mode ──

  /** Toggle UI visibility (called on tap in empty space) */
  toggleImmersive() {
    if (this.immersiveMode()) {
      this.showUI();
    } else {
      this.hideUI();
    }
  }

  /** Show UI elements and start auto-hide timer */
  showUI() {
    this.immersiveMode.set(false);
    this.startAutoHideTimer();
  }

  /** Hide UI elements */
  hideUI() {
    this.immersiveMode.set(true);
    this.clearAutoHideTimer();
  }

  /** Called when user interacts with UI (prevents auto-hide) */
  onUIInteraction() {
    this.startAutoHideTimer();
  }

  private startAutoHideTimer() {
    this.clearAutoHideTimer();
    this.autoHideTimer = setTimeout(() => {
      this.immersiveMode.set(true);
    }, 3000);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      this.prevPage(); // RTL: Right arrow goes to previous page (right side)
    } else if (event.key === 'ArrowLeft') {
      this.nextPage(); // RTL: Left arrow goes to next page (left side)
    } else if (event.key === ' ' || event.key === 'Enter') {
      this.toggleImmersive();
    }
  }

  private clearAutoHideTimer() {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  toggleThemeMenu() {
    this.themeMenuOpen.update(v => !v);
  }

  selectTheme(theme: 'default' | 'classic') {
    this.themeService.setTheme(theme);
    this.themeMenuOpen.set(false);
  }

  showGoToDialog = signal(false);

  onGoToPage(page: number) {
    this.showGoToDialog.set(false);
    this.mushaf()?.loadPage(page);
  }

  async onGoToAyah(target: { surah: number; ayah: number }) {
    this.showGoToDialog.set(false);
    try {
      const page = await this.pageMappingService.getAyahPage(target.surah, target.ayah);
      await this.mushaf()?.loadPage(page);
      setTimeout(() => {
        this.mushaf()?.scrollToAyah(target.surah, target.ayah);
      }, 100);
    } catch (e) {
      console.error('Failed to navigate', e);
    }
  }
}

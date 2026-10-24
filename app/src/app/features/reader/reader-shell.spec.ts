import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KhatamService } from '../../core/khatam.service';
import { ContentApi, DownloadState, OfflineApi, SyncApi, UserDataApi } from '../../core/contracts';
import {
  ContentIndex,
  DEFAULT_PREFERENCES,
  PageLoadError,
  Preferences,
  SyncStatus,
} from '../../core/models';
import { AudioService } from '../../core/audio/audio.service';
import { AudioOfflineApi } from '../../core/audio/audio-offline.api';
import { ProgressService } from '../../core/progress/progress.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { UpdateService } from '../../core/update.service';
import { ReadingViewService } from '../../core/reading-view.service';
import { TranslationService } from '../../core/content/translation.service';
import { LatinService } from '../../core/content/latin.service';
import { ReaderShell } from './reader-shell';

function svgFor(page: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 345 550');
  for (const ayah of [1, 2]) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('class', 'ayahPolygon');
    p.setAttribute('surah', '1');
    p.setAttribute('ayah', String(ayah + page * 0));
    p.setAttribute('d', 'M0 0Z');
    svg.appendChild(p);
  }
  return svg;
}

class FakeContent extends ContentApi {
  override readonly index = signal<ContentIndex | null>({} as ContentIndex);
  override readonly loadError = signal<string | null>(null);
  failing = new Set<number>();
  prefetched: number[][] = [];
  override async load() {}
  override pageMeta(page: number) {
    return {
      page,
      first: { surah: 1, ayah: 1 },
      last: { surah: 1, ayah: 2 },
      surahs: [1],
      juz: 1,
      juzStarts: [],
    };
  }
  override surah(number: number) {
    return {
      number,
      nameArabic: 'x',
      nameLatin: 'Al-Fatihah',
      nameEnglish: 'Al-Fatiha',
      ayahCount: 7,
      startPage: 1,
      endPage: 1,
      juz: 1,
    };
  }
  override surahAt(page: number) {
    return this.surah(this.pageMeta(page).surahs[0]);
  }
  override juzAt() {
    return { number: 1, start: { surah: 1, ayah: 1 }, page: 1 };
  }
  override pageOf() {
    return 1;
  }
  override async getPage(page: number): Promise<SVGSVGElement> {
    if (this.failing.has(page)) throw new PageLoadError(page, 'network');
    return svgFor(page);
  }
  override prefetch(pages: number[]) {
    this.prefetched.push(pages);
  }
  override async isPageAvailableOffline() {
    return false;
  }
}

class FakeUserData extends UserDataApi {
  override readonly ready = signal(true);
  override readonly deviceId = signal('d');
  override readonly prefs = signal<Preferences>({ ...DEFAULT_PREFERENCES, layoutMode: 'single' });
  override readonly position = signal(null);
  override readonly bookmarks = signal([]);
  override readonly favorites = signal([]);
  override readonly archivedBookmarks = signal([]);
  override readonly archivedFolders = signal([]);
  saved: number[] = [];
  override async init() {}
  override async setPrefs() {}
  override savePosition(page: number) {
    this.saved.push(page);
  }
  override async flushPosition() {}
  override isPageBookmarked() {
    return false;
  }
  override isVerseBookmarked() {
    return false;
  }
  override isFavorite() {
    return false;
  }
  override async toggleFavorite() {
    return 'added' as const;
  }
  override async convertToFavorites() {
    return { count: 0, undo: async () => {} };
  }
  override async archiveCurrentBookmarks() {
    return { folder: null, count: 0, undo: async () => {} };
  }
  override async unarchiveFolder() {
    return { restored: 0, skipped: 0 };
  }
  override async togglePageBookmark() {
    return 'added' as const;
  }
  override async toggleVerseBookmark() {
    return 'added' as const;
  }
  override async removeBookmark() {
    return async () => {};
  }
  override async exportJson() {
    return new Blob();
  }
  override async importJson() {
    return { added: 0, skipped: 0 };
  }
  override async reload() {}
  override readonly folders = signal([]);
  override async createFolder(): Promise<never> {
    throw new Error('unused');
  }
  override async renameFolder() {}
  override async deleteFolder() {
    return async () => {};
  }
  override async moveBookmarks() {}
  override async removeBookmarks() {
    return async () => {};
  }
  override async setBookmarkNote() {}
}

class FakeOffline extends OfflineApi {
  override readonly status = signal({
    online: true,
    cachedPages: 0,
    totalPages: 604,
    cachedBytes: 0,
    totalBytes: 0,
    state: 'idle' as DownloadState,
    failedPages: [],
    persisted: null,
  });
  override async refresh() {}
  override async startFullDownload() {}
  override pause() {}
  override async resume() {}
  override async retryFailed() {}
  override async clearPages() {}
}

class FakeSync extends SyncApi {
  override readonly available = true;
  override readonly status = signal<SyncStatus>('off');
  override readonly account = signal(null);
  override readonly lastSuccessAt = signal(null);
  override readonly conflict = signal(null);
  override async init() {}
  override signIn() {}
  override async signInDev() {}
  override async signOut() {}
  override async syncNow() {}
  override async resolveConflict() {}
  override async deleteCloudData() {}
}

describe('ReaderShell', () => {
  let content: FakeContent;
  let userData: FakeUserData;
  let ui: ReaderUiService;
  let sync: FakeSync;
  let offline: FakeOffline;
  let updateAvailable: ReturnType<typeof signal<boolean>>;
  let goTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    content = new FakeContent();
    userData = new FakeUserData();
    sync = new FakeSync();
    offline = new FakeOffline();
    updateAvailable = signal(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ContentApi, useValue: content },
        { provide: UserDataApi, useValue: userData },
        { provide: OfflineApi, useValue: offline },
        { provide: AudioOfflineApi, useValue: { localUrl: async () => null } },
        { provide: SyncApi, useValue: sync },
        { provide: UpdateService, useValue: { available: updateAvailable } },
        {
          provide: ProgressService,
          useValue: {
            createTracker: () => ({ visible: () => {}, stop: () => {}, hidden: () => {} }),
            enabled: () => false,
            currentRound: () => null,
            startNextRound: async () => null,
          },
        },
        {
          provide: TranslationService,
          useValue: { source: signal(null), get: async (r: { surah: number; ayah: number }) => `Terjemah ${r.surah}:${r.ayah}` },
        },
        { provide: LatinService, useValue: { source: signal(null), get: async () => 'latin' } },
      ],
    });
    localStorage.clear();
    ui = TestBed.inject(ReaderUiService);
    goTo = vi.fn();
    ui.goToPage = goTo as unknown as ReaderUiService['goToPage'];
  });

  async function mount(page: string) {
    const fixture = TestBed.createComponent(ReaderShell);
    fixture.componentRef.setInput('page', page);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  describe('navigation chrome', () => {
    const q = (f: { nativeElement: HTMLElement }, sel: string) =>
      f.nativeElement.querySelector<HTMLElement>(sel);
    const labels = (f: { nativeElement: HTMLElement }, tag: string) =>
      Array.from(f.nativeElement.querySelectorAll(`${tag} button`)).map((b) =>
        b.getAttribute('aria-label'),
      );

    it('top bar: title + page line, search, night, menu only', async () => {
      const f = await mount('5');
      const top = labels(f, 'mf-chrome-top');
      expect(top).toHaveLength(5);
      expect(top[0]).toContain('Daftar surah, juz, halaman');
      expect(top[1]).toBe('Pilih halaman. Hal. 5 · Juz 1');
      expect(top.slice(2)).toEqual(['Cari', 'Nyalakan mode malam', 'Menu']);
      for (const gone of ['Penanda', 'Progres membaca', 'Pengaturan', 'Sembunyikan menu (layar penuh)']) {
        expect(top).not.toContain(gone);
      }
    });

    it('page 604 replaces the page-bookmark button with Khatam, which opens the khatam dialog', async () => {
      const f = await mount('604');
      expect(q(f, '[data-testid="bookmark-btn"]')).toBeNull();
      const btn = q(f, '[data-testid="khatam-btn"]')!;
      expect(btn.getAttribute('aria-label')).toBe('Khatam');
      btn.click();
      const state = TestBed.inject(KhatamService).dialog();
      expect(state).toMatchObject({ n: 1, count: 0 });
      expect(state!.folderName).toMatch(/^Khatam ke-1 · \w{3} \d{4}$/);
    });

    it('other pages keep the page-bookmark button and have no Khatam button', async () => {
      const f = await mount('603');
      expect(q(f, '[data-testid="bookmark-btn"]')).not.toBeNull();
      expect(q(f, '[data-testid="khatam-btn"]')).toBeNull();
    });

    it('title opens the browse sheet; menu button opens the menu sheet', async () => {
      const f = await mount('5');
      q(f, 'mf-chrome-top .title')!.click();
      expect(ui.sheet()).toBe('browse');
      expect(ui.browseTab()).toBe('surah');
      q(f, '[data-testid="page-btn"]')!.click();
      expect(ui.browseTab()).toBe('page');
      q(f, '[data-testid="settings-btn"]')!.click();
      expect(ui.sheet()).toBe('settings');
      q(f, 'mf-chrome-top .menu-btn')!.click();
      expect(ui.sheet()).toBe('menu');
    });

    it('menu dot appears for a sync error, an update, or a paused download', async () => {
      const f = await mount('5');
      const dot = () => q(f, '[data-testid="menu-dot"]');
      expect(dot()).toBeNull();
      sync.status.set('error');
      f.detectChanges();
      expect(dot()).not.toBeNull();
      sync.status.set('synced');
      updateAvailable.set(true);
      f.detectChanges();
      expect(dot()).not.toBeNull();
      updateAvailable.set(false);
      offline.status.update((s) => ({ ...s, state: 'paused' as DownloadState }));
      f.detectChanges();
      expect(dot()).not.toBeNull();
      offline.status.update((s) => ({ ...s, state: 'idle' as DownloadState }));
      f.detectChanges();
      expect(dot()).toBeNull();
    });

    it('bottom bar: no contents or zoom button, play + bookmark present', async () => {
      const f = await mount('5');
      const bottom = labels(f, 'mf-chrome-bottom');
      expect(bottom).toContain('Putar bacaan dari halaman 5');
      expect(bottom).toContain('Tandai halaman 5');
      expect(bottom).not.toContain('Daftar isi');
      expect(bottom.some((l) => l?.includes('Perbesar halaman'))).toBe(false);
      expect(bottom).toContain('Pengaturan');
    });

    it('play starts at the first ayah of the page', async () => {
      const f = await mount('5');
      const audio = TestBed.inject(AudioService);
      const play = vi.spyOn(audio, 'play').mockImplementation(() => {});
      q(f, '[data-testid="play-btn"]')!.click();
      expect(play).toHaveBeenCalledWith({ surah: 1, ayah: 1 }, 5);
    });

    it('bookmark: long-press opens the list instead of toggling; tap toggles', async () => {
      const f = await mount('5');
      vi.useFakeTimers();
      try {
        const toggle = vi.spyOn(userData, 'togglePageBookmark');
        const btn = q(f, '[data-testid="bookmark-btn"]')!;
        btn.dispatchEvent(new Event('pointerdown'));
        vi.advanceTimersByTime(600);
        btn.dispatchEvent(new Event('pointerup'));
        btn.click();
        expect(ui.sheet()).toBe('bookmarks');
        expect(toggle).not.toHaveBeenCalled();
        ui.closeSheet();
        btn.dispatchEvent(new Event('pointerdown'));
        btn.dispatchEvent(new Event('pointerup'));
        btn.click();
        expect(toggle).toHaveBeenCalledWith(5);
        expect(ui.sheet()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('right-click on the bookmark button opens the bookmarks sheet', async () => {
      const f = await mount('5');
      q(f, '[data-testid="bookmark-btn"]')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
      expect(ui.sheet()).toBe('bookmarks');
    });
  });

  it('redirects an invalid page to page 1 with replaceUrl', async () => {
    await mount('999');
    expect(goTo).toHaveBeenCalledWith(1, { replaceUrl: true });
  });

  it('publishes current/visible pages and saves the position after render', async () => {
    await mount('5');
    expect(ui.currentPage()).toBe(5);
    expect(ui.visiblePages()).toEqual([5]);
    expect(userData.saved).toEqual([5]);
    expect(content.prefetched.flat().sort((a, b) => a - b)).toEqual([3, 4, 6, 7]);
  });

  it('does not save the position when the page fails to render', async () => {
    content.failing.add(7);
    const fixture = await mount('7');
    expect(userData.saved).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Halaman tidak dapat ditampilkan');
  });

  it('ArrowLeft goes to the next page, ArrowRight to the previous', async () => {
    await mount('10');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(goTo).toHaveBeenLastCalledWith(11);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(goTo).toHaveBeenLastCalledWith(9);
  });

  it('next past page 604 opens the khatam doa instead of a mushaf page', async () => {
    const doa = vi.spyOn(ui, 'openDoaKhatam').mockImplementation(() => {});
    const fixture = await mount('604');
    const next = fixture.nativeElement.querySelector(
      'mf-chrome-bottom button[aria-label="Halaman berikutnya"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(doa).toHaveBeenCalledTimes(1);
    expect(goTo).not.toHaveBeenCalled();
    next.click();
    expect(doa).toHaveBeenCalledTimes(2);
    expect(userData.saved).toEqual([604]);
  });

  it('next past page 604 does nothing when the doa khatam is turned off', async () => {
    userData.prefs.set({ ...DEFAULT_PREFERENCES, layoutMode: 'single', showDoaKhatam: false });
    const doa = vi.spyOn(ui, 'openDoaKhatam').mockImplementation(() => {});
    await mount('604');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(doa).not.toHaveBeenCalled();
    expect(goTo).not.toHaveBeenCalled();
  });

  it('Escape chain: sheet, then zoom, then chrome', async () => {
    await mount('10');
    const esc = () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    ui.sheet.set('settings');
    ui.zoom.set(2);
    ui.chromeVisible.set(true);
    esc();
    expect(ui.sheet()).toBeNull();
    expect(ui.zoom()).toBe(2);
    esc();
    expect(ui.zoom()).toBe(1);
    expect(ui.chromeVisible()).toBe(true);
    esc();
    expect(ui.chromeVisible()).toBe(false);
  });

  it('turning the page keeps the zoom; changing the layout resets it', async () => {
    const fixture = await mount('10');
    ui.zoom.set(2);
    fixture.componentRef.setInput('page', '11');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ui.zoom()).toBe(2);
    userData.prefs.set({ ...DEFAULT_PREFERENCES, layoutMode: 'spread' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ui.zoom()).toBe(1);
  });

  it('spread mode shows the pair but keeps the even route page active', async () => {
    userData.prefs.set({ ...DEFAULT_PREFERENCES, layoutMode: 'spread' });
    const fixture = await mount('4');
    expect(ui.visiblePages()).toEqual([3, 4]);
    expect(ui.currentPage()).toBe(4);
    expect(goTo).not.toHaveBeenCalled();
    expect(userData.saved).toEqual([4]);
    expect(
      fixture.nativeElement.querySelector('mf-page-view[aria-current="page"]').dataset.page,
    ).toBe('4');
    expect(fixture.nativeElement.querySelectorAll('mf-page-view').length).toBe(2);
  });

  it('shows the load error when metadata is unavailable', async () => {
    content.index.set(null);
    content.loadError.set('Tidak dapat memuat');
    const fixture = await mount('1');
    expect(fixture.nativeElement.textContent).toContain('Tidak dapat memuat');
  });

  it('marks the playing ayah on the page and keeps it across an audio page change', async () => {
    const fixture = await mount('5');
    const audio = TestBed.inject(AudioService);
    audio.current.set({ surah: 1, ayah: 1 });
    audio.state.set('playing');
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.ayahPolygon.is-playing').length).toBe(1);
    fixture.componentRef.setInput('page', '6'); // audio-driven page turn
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(audio.state()).toBe('playing');
    expect(audio.highlight()).toEqual({ surah: 1, ayah: 1 });
    expect(el.querySelectorAll('.ayahPolygon.is-playing').length).toBe(1);
    audio.state.set('idle');
    audio.current.set(null);
  });

  describe('translation mode', () => {
    it('renders the page ayahs as text, saves position, opens the verse sheet on keyboard pick', async () => {
      TestBed.inject(ReadingViewService).setMode('translation');
      const fixture = await mount('5');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('mf-page-view')).toBeNull();
      expect(el.querySelectorAll('mf-translation-pane .ayah').length).toBe(2);
      expect(el.textContent).toContain('Terjemah 1:1');
      expect(userData.saved).toEqual([5]);
      const pick = vi.spyOn(ui, 'selectVerse');
      el.querySelector<HTMLElement>('.ayah')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      expect(pick).toHaveBeenCalledWith({ surah: 1, ayah: 1, page: 5 });
    });

    it('keeps page keyboard navigation and marks the playing ayah', async () => {
      TestBed.inject(ReadingViewService).setMode('translation');
      const fixture = await mount('10');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(goTo).toHaveBeenLastCalledWith(11);
      const audio = TestBed.inject(AudioService);
      audio.current.set({ surah: 1, ayah: 2 });
      audio.state.set('playing');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.ayah.is-playing')?.getAttribute('data-ayah'),
      ).toBe('2');
      audio.state.set('idle');
      audio.current.set(null);
    });
  });
});

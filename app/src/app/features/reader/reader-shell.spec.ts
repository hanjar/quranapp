import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentApi, OfflineApi, SyncApi, UserDataApi } from '../../core/contracts';
import {
  ContentIndex,
  DEFAULT_PREFERENCES,
  PageLoadError,
  Preferences,
  SyncStatus,
} from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
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
    state: 'idle' as const,
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
  let goTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    content = new FakeContent();
    userData = new FakeUserData();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ContentApi, useValue: content },
        { provide: UserDataApi, useValue: userData },
        { provide: OfflineApi, useValue: new FakeOffline() },
        { provide: SyncApi, useValue: new FakeSync() },
      ],
    });
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
});

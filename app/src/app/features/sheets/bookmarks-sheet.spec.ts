import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentApi, SyncApi, UserDataApi } from '../../core/contracts';
import { ProgressService } from '../../core/progress/progress.service';
import { MushafDb } from '../../core/storage/db';
import { MUSHAF_DB } from '../../core/storage/db-token';
import { installFakeIndexedDb } from '../../core/storage/testing';
import { UserDataService } from '../../core/storage/user-data.service';
import { BookmarksSheet } from './bookmarks-sheet';

installFakeIndexedDb();

const surah = (n: number) => ({ number: n, nameLatin: 'Surah' + n });

describe('BookmarksSheet tabs', () => {
  let data: UserDataService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MUSHAF_DB, useValue: new MushafDb('test-' + Math.random()) },
        { provide: UserDataApi, useExisting: UserDataService },
        {
          provide: ContentApi,
          useValue: {
            index: () => ({ surahs: Array.from({ length: 114 }, (_, i) => surah(i + 1)) }),
            surahAt: () => surah(1),
            juzAt: () => ({ number: 1 }),
            pageMeta: () => ({ first: { surah: 1, ayah: 1 }, last: { surah: 1, ayah: 7 } }),
          },
        },
        { provide: ProgressService, useValue: { days: () => [], recent: () => [] } },
        {
          provide: SyncApi,
          useValue: { account: signal(null), status: signal('off'), syncNow: async () => {} },
        },
      ],
    });
    data = TestBed.inject(UserDataService);
    await data.init();
  });

  function mount() {
    const f = TestBed.createComponent(BookmarksSheet);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return {
      f,
      el,
      tabs: () => Array.from(el.querySelectorAll('[role="tab"]')).map((t) => t.textContent!.trim()),
      tab: (name: string) =>
        Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')).find(
          (t) => t.textContent!.trim() === name,
        )!,
      titles: () =>
        Array.from(el.querySelectorAll('.item .title')).map((t) =>
          t.textContent!.replace(/\s+/g, ' ').trim(),
        ),
    };
  }

  it('has the tabs Semua, Ayat, Halaman, Favorit', () => {
    expect(mount().tabs()).toEqual(['Semua', 'Ayat', 'Halaman', 'Favorit']);
  });

  it('Semua/Ayat/Halaman show current penanda only; Favorit shows favorites', async () => {
    await data.toggleVerseBookmark({ surah: 2, ayah: 5 }, 3);
    await data.togglePageBookmark(10);
    await data.toggleFavorite({ surah: 3, ayah: 9 }, 50);
    const m = mount();
    expect(m.titles()).toHaveLength(2);
    expect(m.titles().join()).not.toContain('Surah3');

    m.tab('Favorit').click();
    m.f.detectChanges();
    expect(m.titles()).toEqual(['Surah3 · Ayat 9']);
    expect(m.tab('Favorit').getAttribute('aria-selected')).toBe('true');

    m.tab('Ayat').click();
    m.f.detectChanges();
    expect(m.titles()).toEqual(['Surah2 · Ayat 5']);
  });

  it('archived bookmarks are hidden from every tab, favorites stay in Favorit', async () => {
    await data.toggleVerseBookmark({ surah: 2, ayah: 5 }, 3);
    await data.togglePageBookmark(10);
    await data.toggleFavorite({ surah: 2, ayah: 5 }, 3);
    await data.archiveCurrentBookmarks('Khatam ke-1 · Okt 2026');
    const m = mount();
    expect(m.titles()).toEqual([]);
    expect(m.el.textContent).toContain('Belum ada penanda');
    m.tab('Ayat').click();
    m.f.detectChanges();
    expect(m.titles()).toEqual([]);
    m.tab('Halaman').click();
    m.f.detectChanges();
    expect(m.titles()).toEqual([]);
    m.tab('Favorit').click();
    m.f.detectChanges();
    expect(m.titles()).toEqual(['Surah2 · Ayat 5']);
  });

  it('removing a favorite from the sheet says Favorit dihapus', async () => {
    await data.toggleFavorite({ surah: 3, ayah: 9 }, 50);
    const m = mount();
    m.tab('Favorit').click();
    m.f.detectChanges();
    m.el.querySelector<HTMLButtonElement>('.del')!.click();
    await data.idle();
    expect(data.favorites()).toHaveLength(0);
  });
});

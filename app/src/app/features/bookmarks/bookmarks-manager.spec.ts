import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { MushafDb } from '../../core/storage/db';
import { MUSHAF_DB } from '../../core/storage/db-token';
import { installFakeIndexedDb } from '../../core/storage/testing';
import { UserDataService } from '../../core/storage/user-data.service';
import { BookmarksManager } from './bookmarks-manager';

installFakeIndexedDb();

const surah = (n: number) => ({ number: n, nameLatin: 'Surah' + n, nameEnglish: 'S' + n, nameArabic: 'س' });

describe('BookmarksManager favorites and archive', () => {
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
            load: async () => {},
            surahAt: () => surah(1),
            juzAt: () => ({ number: 1 }),
            pageMeta: () => ({ first: { surah: 1, ayah: 1 }, last: { surah: 1, ayah: 7 } }),
          },
        },
      ],
    });
    data = TestBed.inject(UserDataService);
    await data.init();
  });

  function mount() {
    const f = TestBed.createComponent(BookmarksManager);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return {
      f,
      el,
      q: (sel: string) => el.querySelector<HTMLElement>(sel),
      titles: () => Array.from(el.querySelectorAll('main > ul.list .item .title')).map((t) => t.textContent!.replace(/\s+/g, ' ').trim()),
      archiveTitles: () => Array.from(el.querySelectorAll('.archive .item .title')).map((t) => t.textContent!.replace(/\s+/g, ' ').trim()),
    };
  }

  it('lists current penanda in the main list; archived ones live in the collapsed Arsip section', async () => {
    await data.togglePageBookmark(10);
    await data.toggleVerseBookmark({ surah: 2, ayah: 5 }, 3);
    await data.archiveCurrentBookmarks('Khatam ke-1 · Okt 2026');
    await data.togglePageBookmark(20);
    const m = mount();
    expect(m.titles()).toHaveLength(1);
    expect(m.titles()[0]).toContain('Halaman 20');
    // collapsed by default
    expect(m.q('[data-testid="archive-toggle"]')!.getAttribute('aria-expanded')).toBe('false');
    expect(m.archiveTitles()).toEqual([]);
    m.q('[data-testid="archive-toggle"]')!.click();
    m.f.detectChanges();
    expect(m.q('[data-testid="archive-toggle"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(m.el.querySelector('.archgroup strong')!.textContent).toBe('Khatam ke-1 · Okt 2026');
    expect(m.archiveTitles()).toHaveLength(2);
  });

  it('Pulihkan brings the folder\'s bookmarks back and reports clashes', async () => {
    await data.togglePageBookmark(10);
    await data.togglePageBookmark(11);
    await data.archiveCurrentBookmarks('Khatam ke-1');
    await data.togglePageBookmark(10); // same key again in the new round
    const m = mount();
    m.q('[data-testid="archive-toggle"]')!.click();
    m.f.detectChanges();
    m.q('[data-testid="restore-btn"]')!.click();
    await vi.waitFor(() => expect(data.archivedBookmarks()).toHaveLength(1));
    expect(data.bookmarks().map((b) => b.page).sort()).toEqual([10, 11]);
    expect(TestBed.inject(ReaderUiService).toast()!.message).toBe(
      '1 penanda dipulihkan · 1 penanda tidak dapat dipulihkan karena sudah ada penanda yang sama',
    );
  });

  it('manual "Arsipkan penanda sekarang" archives and offers Urungkan', async () => {
    await data.togglePageBookmark(10);
    const m = mount();
    m.q('[data-testid="archive-toggle"]')!.click();
    m.f.detectChanges();
    m.q('[data-testid="archive-now"]')!.click();
    m.f.detectChanges();
    m.q('[data-testid="archive-confirm"]')!.click();
    await vi.waitFor(() => expect(data.archivedBookmarks()).toHaveLength(1));
    const toast = TestBed.inject(ReaderUiService).toast()!;
    expect(toast.message).toBe('1 penanda diarsipkan');
    expect(toast.actionLabel).toBe('Urungkan');
    expect(data.bookmarks()).toHaveLength(0);
  });

  it('the Favorit filter lists favorites (and not archived or other penanda)', async () => {
    await data.togglePageBookmark(10);
    await data.toggleFavorite({ surah: 2, ayah: 5 }, 3);
    const m = mount();
    m.q('[data-testid="kind-favorite"]')!.click();
    m.f.detectChanges();
    expect(m.titles()).toEqual(['Surah2 · Ayat 5']);
    // favorites have no folders and no archive
    expect(m.q('[data-testid="archive"]')).toBeNull();
  });

  it('"Jadikan favorit" turns the selected verse bookmarks into favorites', async () => {
    await data.toggleVerseBookmark({ surah: 2, ayah: 5 }, 3);
    await data.togglePageBookmark(10);
    const m = mount();
    m.el.querySelector<HTMLButtonElement>('.selbtn')!.click();
    m.f.detectChanges();
    const make = () => m.q('[data-testid="make-favorite"]') as HTMLButtonElement;
    expect(make().disabled).toBe(true);
    m.el.querySelectorAll<HTMLInputElement>('.item input[type="checkbox"]').forEach((c) => c.click());
    m.f.detectChanges();
    expect(make().disabled).toBe(false);
    make().click();
    await vi.waitFor(() => expect(data.favorites()).toHaveLength(1));
    expect(data.bookmarks().map((b) => b.kind)).toEqual(['page']);
    expect(TestBed.inject(ReaderUiService).toast()!.message).toBe('1 ayat dijadikan favorit');
  });
});

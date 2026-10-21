import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  BookmarkToggleService,
  OUTDATED_TOAST,
  SAVE_GIVE_UP_MS,
  SLOW_SAVE_NOTICE_MS,
} from './bookmark-toggle.service';
import { UserDataApi } from './contracts';
import { ReaderUiService } from './reader-ui.service';
import { clearStorageErrors, recentStorageErrors } from './storage/storage-diagnostics';
import { DB_BLOCKED_MESSAGE, StorageUnavailableError } from './storage/user-data.service';

type Result = 'added' | 'removed';

function setup() {
  const stored = signal(false);
  let release!: (r: Result) => void;
  let fail!: (e: unknown) => void;
  const userData = {
    isVerseBookmarked: () => stored(),
    isPageBookmarked: () => stored(),
    toggleVerseBookmark: vi.fn(
      () =>
        new Promise<Result>((res, rej) => {
          release = (r) => {
            stored.set(r === 'added');
            res(r);
          };
          fail = rej;
        }),
    ),
    togglePageBookmark: vi.fn(async () => 'added' as Result),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: UserDataApi, useValue: userData }] });
  const svc = TestBed.inject(BookmarkToggleService);
  const ui = TestBed.inject(ReaderUiService);
  return { svc, ui, userData, release: (r: Result) => release(r), fail: (e: unknown) => fail(e) };
}

describe('BookmarkToggleService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStorageErrors();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const ref = { surah: 2, ayah: 5 };

  it('flips the icon at once and confirms when the write finishes', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    expect(t.svc.isVerseBookmarked(ref)).toBe(true);
    expect(t.ui.toast()).toBeNull();
    t.release('added');
    await p;
    expect(t.svc.isVerseBookmarked(ref)).toBe(true);
    expect(t.ui.toast()?.message).toBe('Ayat ditandai');
    expect(t.ui.toast()?.actionLabel).toBe('Urungkan');
  });

  it('a slow write is not a failure: Menyimpan after 2 s, then the normal success toast', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    await vi.advanceTimersByTimeAsync(SLOW_SAVE_NOTICE_MS + 10);
    expect(t.ui.toast()?.message).toBe('Menyimpan…');
    await vi.advanceTimersByTimeAsync(8000); // well past the old 5 s timeout
    expect(t.ui.toast()?.message).not.toContain('gagal');
    expect(t.svc.isVerseBookmarked(ref)).toBe(true);
    t.release('added');
    await p;
    expect(t.ui.toast()?.message).toBe('Ayat ditandai');
  });

  it('ignores extra taps while the first is in flight', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    await t.svc.toggleVerse(ref, 3);
    await t.svc.toggleVerse(ref, 3);
    expect(t.userData.toggleVerseBookmark).toHaveBeenCalledTimes(1);
    t.release('added');
    await p;
    const p2 = t.svc.toggleVerse(ref, 3);
    expect(t.userData.toggleVerseBookmark).toHaveBeenCalledTimes(2);
    expect(t.svc.isVerseBookmarked(ref)).toBe(false);
    t.release('removed');
    await p2;
    expect(t.ui.toast()?.message).toBe('Penanda dihapus');
  });

  it('a real error reverts the icon, names the error and offers a retry', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    expect(t.svc.isVerseBookmarked(ref)).toBe(true);
    const err = new Error('boom');
    err.name = 'QuotaExceededError';
    t.fail(err);
    await p;
    expect(t.svc.isVerseBookmarked(ref)).toBe(false);
    expect(t.ui.toast()?.message).toBe('Penanda gagal disimpan (QuotaExceededError). Coba lagi.');
    expect(t.ui.toast()?.actionLabel).toBe('Coba lagi');
    expect(recentStorageErrors().some((e) => e.name === 'QuotaExceededError')).toBe(true);
    t.ui.toast()?.action?.();
    expect(t.userData.toggleVerseBookmark).toHaveBeenCalledTimes(2);
  });

  it('blocked database: own message with reload action', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    t.fail(new StorageUnavailableError(DB_BLOCKED_MESSAGE, 'blocked'));
    await p;
    expect(t.svc.isVerseBookmarked(ref)).toBe(false);
    expect(t.ui.toast()?.message).toBe('Tutup tab Mushaf Digital lain lalu muat ulang.');
    expect(t.ui.toast()?.actionLabel).toBe('Muat ulang');
  });

  it('outdated database: new-version message with reload action', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    t.fail(new StorageUnavailableError('x', 'outdated'));
    await p;
    expect(t.ui.toast()?.message).toBe(OUTDATED_TOAST);
    expect(t.ui.toast()?.actionLabel).toBe('Muat ulang');
  });

  it('releases the tap guard after the give-up window but keeps waiting for the write', async () => {
    const t = setup();
    const p = t.svc.toggleVerse(ref, 3);
    await vi.advanceTimersByTimeAsync(SAVE_GIVE_UP_MS + 10);
    expect(t.svc.isVerseBookmarked(ref)).toBe(false);
    t.release('added');
    await p;
    expect(t.svc.isVerseBookmarked(ref)).toBe(true);
  });

  it('page toggle uses page wording', async () => {
    const t = setup();
    await t.svc.togglePage(7);
    expect(t.ui.toast()?.message).toBe('Halaman 7 ditandai');
  });
});

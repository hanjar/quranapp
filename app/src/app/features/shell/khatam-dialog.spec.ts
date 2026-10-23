import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDataApi } from '../../core/contracts';
import { KhatamService, khatamFolderName } from '../../core/khatam.service';
import { MushafDb } from '../../core/storage/db';
import { MUSHAF_DB } from '../../core/storage/db-token';
import { installFakeIndexedDb } from '../../core/storage/testing';
import { UserDataService } from '../../core/storage/user-data.service';
import { ProgressService } from '../../core/progress/progress.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { KhatamDialog } from './khatam-dialog';

installFakeIndexedDb();

describe('KhatamDialog + KhatamService', () => {
  let db: MushafDb;
  let data: UserDataService;
  let khatam: KhatamService;
  let ui: ReaderUiService;
  const enabled = signal(true);
  const round = signal<{ n: number } | null>({ n: 3 });
  const startNextRound = vi.fn(async () => ({ n: 4 }));

  beforeEach(async () => {
    enabled.set(true);
    round.set({ n: 3 });
    startNextRound.mockClear();
    db = new MushafDb('test-' + Math.random());
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MUSHAF_DB, useValue: db },
        { provide: UserDataApi, useExisting: UserDataService },
        { provide: ProgressService, useValue: { enabled, currentRound: round, startNextRound } },
      ],
    });
    data = TestBed.inject(UserDataService);
    await data.init();
    khatam = TestBed.inject(KhatamService);
    ui = TestBed.inject(ReaderUiService);
  });

  function mount() {
    const f = TestBed.createComponent(KhatamDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return {
      f,
      el,
      btn: (id: string) => el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`),
      text: () => el.textContent!.replace(/\s+/g, ' ').trim(),
    };
  }

  it('names the folder "Khatam ke-N · Mon yyyy"', () => {
    expect(khatamFolderName(2, new Date(2026, 9, 23))).toBe('Khatam ke-2 · Okt 2026');
  });

  it('is closed until opened', () => {
    expect(mount().el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the title with N from the open progress round and the bookmark count', async () => {
    await data.togglePageBookmark(5);
    await data.toggleVerseBookmark({ surah: 1, ayah: 2 }, 1);
    khatam.open();
    const m = mount();
    m.f.detectChanges();
    expect(m.text()).toContain('Alhamdulillah, khatam ke-3');
    expect(m.text()).toMatch(
      /Arsipkan 2 penanda putaran ini ke folder 'Khatam ke-3 · \w{3} \d{4}' dan mulai putaran baru\?/,
    );
    expect(m.btn('khatam-confirm')!.textContent!.trim()).toBe('Arsipkan & mulai baru');
    expect(m.btn('khatam-doa')!.textContent!.trim()).toBe('Baca doa khatam');
    expect(m.btn('khatam-later')!.textContent!.trim()).toBe('Nanti');
  });

  it('without progress tracking, N is the number of archived khatam folders + 1', async () => {
    enabled.set(false);
    await data.togglePageBookmark(5);
    await data.archiveCurrentBookmarks('Khatam ke-1 · Sep 2026');
    await data.togglePageBookmark(6);
    await data.archiveCurrentBookmarks('Khatam ke-2 · Okt 2026');
    await data.archiveCurrentBookmarks('Arsip lain'); // nothing to archive: no folder
    expect(khatam.nextNumber()).toBe(3);
  });

  it('Arsipkan & mulai baru archives, starts the next round and offers Urungkan', async () => {
    await data.togglePageBookmark(5);
    await data.toggleVerseBookmark({ surah: 1, ayah: 2 }, 1);
    await data.toggleFavorite({ surah: 1, ayah: 2 }, 1);
    khatam.open();
    const m = mount();
    m.btn('khatam-confirm')!.click();
    await vi.waitFor(() => expect(khatam.dialog()).toBeNull());
    expect(startNextRound).toHaveBeenCalledTimes(1);
    expect(data.bookmarks()).toHaveLength(0);
    expect(data.archivedBookmarks()).toHaveLength(2);
    expect(data.favorites()).toHaveLength(1);
    expect(data.archivedFolders()[0].name).toMatch(/^Khatam ke-3 · /);
    const toast = ui.toast()!;
    expect(toast.message).toBe('2 penanda diarsipkan');
    expect(toast.actionLabel).toBe('Urungkan');
    toast.action!();
    await data.idle();
    expect(data.bookmarks()).toHaveLength(2);
    expect(data.archivedFolders()).toHaveLength(0);
  });

  it('does not touch the progress round when tracking is off', async () => {
    enabled.set(false);
    await data.togglePageBookmark(5);
    khatam.open();
    const m = mount();
    m.btn('khatam-confirm')!.click();
    await vi.waitFor(() => expect(khatam.dialog()).toBeNull());
    expect(startNextRound).not.toHaveBeenCalled();
    expect(data.archivedBookmarks()).toHaveLength(1);
  });

  it('with no bookmarks it only starts the new round', async () => {
    khatam.open();
    const m = mount();
    expect(m.text()).toContain('Tidak ada penanda untuk diarsipkan');
    m.btn('khatam-confirm')!.click();
    await vi.waitFor(() => expect(khatam.dialog()).toBeNull());
    expect(startNextRound).toHaveBeenCalledTimes(1);
    expect(data.archivedFolders()).toHaveLength(0);
    expect(ui.toast()!.message).toBe('Alhamdulillah, khatam ke-3');
  });

  it('Baca doa khatam goes to /doa-khatam; Nanti just closes', () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    khatam.open();
    const m = mount();
    m.btn('khatam-later')!.click();
    expect(khatam.dialog()).toBeNull();
    expect(nav).not.toHaveBeenCalled();
    khatam.open();
    m.f.detectChanges();
    m.btn('khatam-doa')!.click();
    expect(nav).toHaveBeenCalledWith('/doa-khatam', expect.anything());
    expect(khatam.dialog()).toBeNull();
  });

  it('hides Baca doa khatam when the doa is turned off', async () => {
    await data.setPrefs({ showDoaKhatam: false });
    khatam.open();
    const m = mount();
    expect(m.btn('khatam-doa')).toBeNull();
    expect(m.btn('khatam-confirm')).not.toBeNull();
  });
});

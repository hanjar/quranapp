import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionConflict, SyncApi } from '../contracts';
import { ReadingPosition } from '../models';
import { ReaderUiService } from '../reader-ui.service';
import { ResumeFollowService } from './resume-follow.service';

const pos = (page: number): ReadingPosition => ({ page } as unknown as ReadingPosition);

describe('ResumeFollowService', () => {
  const remotePosition = signal<ReadingPosition | null>(null);
  const conflict = signal<PositionConflict | null>(null);
  const resolveConflict = vi.fn(async () => undefined);
  const signedInAt = signal<number | null>(null);
  let url = '/hal/10';
  let ui: ReaderUiService;
  let go: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncApi, useValue: { remotePosition, conflict, resolveConflict, signedInAt } },
        { provide: Router, useValue: { get url() { return url; } } },
      ],
    });
    ui = TestBed.inject(ReaderUiService);
    ui.currentPage.set(10);
    ui.visiblePages.set([10]);
    go = vi.spyOn(ui, 'goToPage').mockImplementation(() => {}) as never;
    toast = vi.spyOn(ui, 'showToast').mockImplementation(() => {}) as never;
    const svc = TestBed.inject(ResumeFollowService);
    svc.markOpened();
    TestBed.tick();
    return svc;
  }

  beforeEach(() => {
    remotePosition.set(null);
    conflict.set(null);
    resolveConflict.mockClear();
    signedInAt.set(null);
    url = '/hal/10';
  });

  it('follows a newer position when nothing was turned here since opening', () => {
    setup();
    remotePosition.set(pos(250));
    TestBed.tick();
    expect(go).toHaveBeenCalledWith(250, { replaceUrl: true });
    expect(toast.mock.calls[0]![0]).toMatchObject({ message: 'Lanjut dari perangkat lain · hal. 250', actionLabel: 'Kembali ke hal. 10' });
  });

  it('only offers the other position while reading here', () => {
    setup();
    ui.currentPage.set(11);
    ui.visiblePages.set([11]);
    remotePosition.set(pos(250));
    TestBed.tick();
    expect(go).not.toHaveBeenCalled();
    expect(toast.mock.calls[0]![0]).toMatchObject({ message: 'Perangkat lain terakhir di hal. 250', actionLabel: 'Buka' });
  });

  it('resolves a launch conflict: cloud when fresh, nothing shown when already on that page', () => {
    setup();
    conflict.set({ device: pos(10), cloud: pos(250) } as PositionConflict);
    TestBed.tick();
    expect(resolveConflict).toHaveBeenCalledWith('cloud');
    conflict.set(null);
    TestBed.tick();
    resolveConflict.mockClear();
    toast.mockClear();
    conflict.set({ device: pos(9), cloud: pos(10) } as PositionConflict);
    TestBed.tick();
    expect(resolveConflict).toHaveBeenCalledWith('device');
    expect(toast).not.toHaveBeenCalled();
  });

  it('right after signing in it offers the last page of the account instead of jumping', () => {
    setup();
    signedInAt.set(Date.now());
    conflict.set({ device: pos(10), cloud: pos(250) } as PositionConflict);
    TestBed.tick();
    expect(go).not.toHaveBeenCalled();
    expect(resolveConflict).toHaveBeenCalledWith('device');
    expect(toast.mock.calls[0]![0]).toMatchObject({ message: 'Terakhir dibaca di akun ini: hal. 250', actionLabel: 'Buka' });
    toast.mock.calls[0]![0].action();
    expect(go).toHaveBeenCalledWith(250);
  });

  it('outside the reader it just takes the newer position', () => {
    url = '/tafsir/2';
    setup();
    remotePosition.set(pos(250));
    TestBed.tick();
    expect(go).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

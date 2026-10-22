import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineApi, SyncApi } from '../../core/contracts';
import { InstallService } from '../../core/install.service';
import { Account, SyncStatus } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { UpdateService } from '../../core/update.service';
import { MenuSheet } from './menu-sheet';

describe('MenuSheet', () => {
  const account = signal<Account | null>(null);
  const status = signal<SyncStatus>('off');
  const offline = signal({ state: 'idle' });
  const update = signal(false);
  const install = signal('manual');
  let syncAvailable = true;
  const openModal = vi.fn();

  function mount() {
    const f = TestBed.createComponent(MenuSheet);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return {
      f,
      el,
      tile: (n: string) => el.querySelector<HTMLElement>(`[data-tile="${n}"]`),
      tiles: () => Array.from(el.querySelectorAll('[data-tile]')).map((t) => t.getAttribute('data-tile')),
    };
  }

  beforeEach(() => {
    account.set(null);
    status.set('off');
    offline.set({ state: 'idle' });
    update.set(false);
    install.set('manual');
    syncAvailable = true;
    openModal.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SyncApi,
          useValue: {
            get available() {
              return syncAvailable;
            },
            status,
            account,
            lastSuccessAt: signal(null),
          },
        },
        { provide: OfflineApi, useValue: { status: offline } },
        { provide: UpdateService, useValue: { available: update } },
        { provide: InstallService, useValue: { state: install, openModal } },
      ],
    });
  });

  it('lists the tiles in order', () => {
    expect(mount().tiles()).toEqual([
      'bookmarks',
      'progress',
      'doa',
      'offline',
      'settings',
      'account',
      'fullscreen',
      'install',
      'feedback',
      'about',
    ]);
  });

  it('hides Pasang when installed and Akun when sync is unavailable', () => {
    install.set('installed');
    syncAvailable = false;
    const { tiles } = mount();
    expect(tiles()).not.toContain('install');
    expect(tiles()).not.toContain('account');
  });

  it('account tile shows Masuk, then the initial and name when signed in', () => {
    const m = mount();
    expect(m.tile('account')!.textContent).toContain('Masuk');
    account.set({ id: '1', email: 'a@b.c', name: 'Budi' });
    m.f.detectChanges();
    expect(m.tile('account')!.textContent).toContain('Budi');
    expect(m.tile('account')!.querySelector('.avatar')!.textContent).toContain('B');
  });

  it('each tile opens its sheet', () => {
    const ui = TestBed.inject(ReaderUiService);
    const m = mount();
    for (const [tile, sheet] of [
      ['bookmarks', 'bookmarks'],
      ['progress', 'progress'],
      ['offline', 'offline'],
      ['settings', 'settings'],
      ['account', 'account'],
      ['feedback', 'feedback'],
      ['about', 'about'],
    ] as const) {
      m.tile(tile)!.click();
      expect(ui.sheet()).toBe(sheet);
    }
  });

  it('Doa khatam tile closes the sheet and opens /doa-khatam', () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const ui = TestBed.inject(ReaderUiService);
    const m = mount();
    ui.openSheet('menu');
    m.tile('doa')!.click();
    expect(ui.sheet()).toBeNull();
    expect(nav).toHaveBeenCalledWith('/doa-khatam', { replaceUrl: false });
  });

  it('Layar penuh closes the sheet and hides the bars; Pasang opens the install modal', () => {
    const ui = TestBed.inject(ReaderUiService);
    const m = mount();
    ui.chromeVisible.set(true);
    ui.openSheet('menu');
    m.tile('fullscreen')!.click();
    expect(ui.sheet()).toBeNull();
    expect(ui.chromeVisible()).toBe(false);
    ui.openSheet('menu');
    m.tile('install')!.click();
    expect(ui.sheet()).toBeNull();
    expect(openModal).toHaveBeenCalled();
  });

  it('shows Versi baru on Tentang and attention dots on Akun / Offline', () => {
    const m = mount();
    expect(m.tile('about')!.textContent).not.toContain('Versi baru');
    expect(m.el.querySelectorAll('.dot')).toHaveLength(0);
    update.set(true);
    status.set('error');
    offline.set({ state: 'paused' });
    m.f.detectChanges();
    expect(m.tile('about')!.textContent).toContain('Versi baru');
    expect(m.tile('account')!.querySelector('.dot')).not.toBeNull();
    expect(m.tile('offline')!.querySelector('.dot')).not.toBeNull();
  });
});

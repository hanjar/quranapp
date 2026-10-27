import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentApi, OfflineApi, SyncApi, UserDataApi } from '../../core/contracts';
import { DEFAULT_PREFERENCES } from '../../core/models';
import { ProgressService } from '../../core/progress/progress.service';
import { ThemeService } from '../../core/theme.service';
import { UpdateService } from '../../core/update.service';
import { ChromeTop } from './chrome-top';

describe('ChromeTop today badge', () => {
  const enabled = signal(true);
  const todayCount = signal(2);
  const dailyTarget = signal(5);

  beforeEach(() => {
    enabled.set(true);
    todayCount.set(2);
    dailyTarget.set(5);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ProgressService,
          useValue: { enabled, todayCount, dailyTarget },
        },
        {
          provide: SyncApi,
          useValue: { available: false, status: signal('off'), lastSuccessAt: signal(null) },
        },
        { provide: OfflineApi, useValue: { status: signal({ state: 'idle' }) } },
        { provide: UserDataApi, useValue: { prefs: signal({ ...DEFAULT_PREFERENCES }) } },
        { provide: UpdateService, useValue: { available: signal(false) } },
        { provide: ThemeService, useValue: { nightActive: signal(false) } },
        {
          provide: ContentApi,
          useValue: { index: signal(null), pageMeta: () => ({ juz: 1, surahs: [] }) },
        },
      ],
    });
  });

  function mount() {
    const f = TestBed.createComponent(ChromeTop);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return {
      f,
      badge: () => el.querySelector<HTMLButtonElement>('[data-testid="today-badge"]'),
    };
  }

  it('shows today/target', () => {
    const m = mount();
    expect(m.badge()?.textContent).toContain('2/5');
    expect(m.badge()?.classList.contains('is-done')).toBe(false);
  });

  it('marks the badge done at the target', () => {
    todayCount.set(5);
    const m = mount();
    expect(m.badge()?.classList.contains('is-done')).toBe(true);
    expect(m.badge()?.textContent).toContain('target tercapai');
  });

  it('is hidden when progress tracking is off', () => {
    enabled.set(false);
    const m = mount();
    expect(m.badge()).toBeNull();
  });
});

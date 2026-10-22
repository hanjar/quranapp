import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './update.service';

describe('UpdateService', () => {
  let events: Subject<VersionEvent>;
  let sw: {
    isEnabled: boolean;
    versionUpdates: Subject<VersionEvent>;
    unrecoverable: Subject<unknown>;
    checkForUpdate: ReturnType<typeof vi.fn>;
    activateUpdate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    events = new Subject();
    sw = {
      isEnabled: true,
      versionUpdates: events,
      unrecoverable: new Subject(),
      checkForUpdate: vi.fn().mockResolvedValue(false),
      activateUpdate: vi.fn().mockResolvedValue(true),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: sw }] });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('checks automatically after start and periodically', async () => {
    TestBed.inject(UpdateService);
    await vi.advanceTimersByTimeAsync(8000);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('marks a downloaded version as available and stops checking', async () => {
    const s = TestBed.inject(UpdateService);
    events.next({ type: 'VERSION_READY' } as VersionEvent);
    expect(s.available()).toBe(true);
    expect(await s.check(true)).toBe(true);
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
  });

  it('never rejects when the check fails', async () => {
    sw.checkForUpdate.mockRejectedValue(new Error('offline'));
    const s = TestBed.inject(UpdateService);
    await expect(s.check(true)).resolves.toBe(false);
  });
});

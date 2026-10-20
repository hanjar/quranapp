import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioService } from './audio/audio.service';
import { ReaderUiService } from './reader-ui.service';
import { WakeLockService, idleMs } from './wake-lock.service';

@Component({ template: '' })
class Stub {}

class FakeSentinel {
  released = false;
  private cbs: (() => void)[] = [];
  release(): Promise<void> {
    this.released = true;
    this.cbs.forEach((c) => c());
    return Promise.resolve();
  }
  addEventListener(_t: 'release', cb: () => void): void {
    this.cbs.push(cb);
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
};

describe('idleMs', () => {
  it('maps modes', () => {
    expect(idleMs('10')).toBe(600_000);
    expect(idleMs('30')).toBe(1_800_000);
    expect(idleMs('off')).toBeNull();
    expect(idleMs('reading')).toBeNull();
  });
});

describe('WakeLockService', () => {
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;
  const audioState = signal<string>('idle');

  async function setup(url = '/hal/1', stored?: string): Promise<WakeLockService> {
    if (stored) localStorage.setItem('mf-wake', stored);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'hal/:page', component: Stub },
          { path: '**', component: Stub },
        ]),
        { provide: AudioService, useValue: { state: audioState } },
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const svc = TestBed.inject(WakeLockService);
    await flush();
    return svc;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    audioState.set('idle');
    sentinels = [];
    request = vi.fn(() => {
      const s = new FakeSentinel();
      sentinels.push(s);
      return Promise.resolve(s);
    });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (navigator as unknown as Record<string, unknown>)['wakeLock'];
    vi.useRealTimers();
  });

  it('defaults to 10 minutes and acquires on the reader route', async () => {
    const svc = await setup();
    expect(svc.mode()).toBe('10');
    expect(request).toHaveBeenCalledWith('screen');
    expect(svc.held()).toBe(true);
  });

  it('does not acquire outside the reader', async () => {
    const svc = await setup('/lain');
    expect(request).not.toHaveBeenCalled();
    expect(svc.held()).toBe(false);
  });

  it('releases after the idle timeout and re-arms on interaction', async () => {
    const svc = await setup();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await flush();
    expect(svc.held()).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await flush();
    expect(svc.held()).toBe(false);
    expect(sentinels[0].released).toBe(true);
    window.dispatchEvent(new Event('keydown'));
    await flush();
    expect(svc.held()).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('page change re-arms', async () => {
    const svc = await setup();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    TestBed.inject(ReaderUiService).currentPage.set(5);
    await flush();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await flush();
    expect(svc.held()).toBe(true);
  });

  it('stays on while audio plays and does not time out', async () => {
    const svc = await setup();
    audioState.set('playing');
    await flush();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await flush();
    expect(svc.held()).toBe(true);
  });

  it('reading mode never times out; off mode releases', async () => {
    const svc = await setup('/hal/1', 'reading');
    await vi.advanceTimersByTimeAsync(120 * 60_000);
    await flush();
    expect(svc.held()).toBe(true);
    svc.setMode('off');
    await flush();
    expect(svc.held()).toBe(false);
    expect(localStorage.getItem('mf-wake')).toBe('off');
  });

  it('releases when leaving the reader', async () => {
    const svc = await setup();
    await TestBed.inject(Router).navigateByUrl('/lain');
    await flush();
    expect(svc.held()).toBe(false);
  });

  it('re-acquires when the tab becomes visible again', async () => {
    const svc = await setup();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(svc.held()).toBe(false);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(svc.held()).toBe(true);
    hidden.mockRestore();
  });

  it('survives request errors and reports unsupported', async () => {
    request.mockRejectedValue(new Error('denied'));
    const svc = await setup();
    expect(svc.held()).toBe(false);
    TestBed.resetTestingModule();
    delete (navigator as unknown as Record<string, unknown>)['wakeLock'];
    const svc2 = await setup();
    expect(svc2.supported).toBe(false);
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioService } from './audio/audio.service';
import { PageTurnSoundService } from './page-turn-sound';

class FakeCtx {
  static starts = 0;
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = () => Promise.resolve();
  decodeAudioData = () => Promise.resolve({} as AudioBuffer);
  createGain() {
    const gain = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} };
    return { gain, connect: (d: unknown) => d };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: (g: unknown) => g,
      start: () => FakeCtx.starts++,
      stop() {},
    };
  }
}

describe('PageTurnSoundService', () => {
  let now = 1000;
  const audioState = signal('idle');

  beforeEach(async () => {
    FakeCtx.starts = 0;
    localStorage.removeItem('mf-page-sound');
    vi.stubGlobal('AudioContext', FakeCtx);
    vi.stubGlobal('fetch', () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }));
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    TestBed.configureTestingModule({ providers: [{ provide: AudioService, useValue: { state: audioState } }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    audioState.set('idle');
  });

  async function warm(s: PageTurnSoundService) {
    s.play(); // creates the context and loads
    await new Promise((r) => setTimeout(r, 0));
    now += 1000;
  }

  it('plays on a turn once loaded', async () => {
    const s = TestBed.inject(PageTurnSoundService);
    await warm(s);
    s.play();
    expect(FakeCtx.starts).toBe(1);
  });

  it('collapses turns closer than 120 ms into one sound', async () => {
    const s = TestBed.inject(PageTurnSoundService);
    await warm(s);
    s.play();
    now += 50;
    s.play();
    now += 50;
    s.play();
    expect(FakeCtx.starts).toBe(1);
    now += 200;
    s.play();
    expect(FakeCtx.starts).toBe(2);
  });

  it('stays silent when switched off or while a recitation plays', async () => {
    const s = TestBed.inject(PageTurnSoundService);
    await warm(s);
    audioState.set('playing');
    s.play();
    expect(FakeCtx.starts).toBe(0);
    audioState.set('idle');
    s.set(false);
    now += 1000;
    s.play();
    expect(FakeCtx.starts).toBe(0);
    expect(localStorage.getItem('mf-page-sound')).toBe('off');
  });
});

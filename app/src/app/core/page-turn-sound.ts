import { Injectable, inject, signal } from '@angular/core';
import { AudioService } from './audio/audio.service';

/**
 * A short paper sound when the reader turns a page (Kenney "RPG Audio", CC0; silence
 * trimmed, see public/sfx). Per-device setting, on by default, quiet, and never over a
 * recitation. Rapid page turns stay calm: taps closer than MIN_GAP_MS share one sound,
 * at most two sounds overlap (the older one fades out), and the variants rotate.
 */
const KEY = 'mf-page-sound';
const FILES = ['/sfx/flip1.wav', '/sfx/flip2.wav', '/sfx/flip3.wav'];
const VOLUME = 0.35;
/** Turns faster than this play no new sound. */
const MIN_GAP_MS = 120;
/** Within this window turns count as a burst and get quieter. */
const BURST_MS = 400;
const MAX_VOICES = 2;
const FADE_S = 0.03;
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

@Injectable({ providedIn: 'root' })
export class PageTurnSoundService {
  private readonly audio = inject(AudioService);

  readonly enabled = signal(readEnabled());

  private ctx: AudioContext | null = null;
  private buffers: AudioBuffer[] = [];
  private loading: Promise<void> | null = null;
  private voices: Voice[] = [];
  private last = 0;
  private next = 0;

  constructor() {
    // Browsers only start audio from a tap, click or key press, and a swipe does not
    // count. So the first tap anywhere unlocks and preloads the sounds; page turns by
    // swipe can then play. Listeners stay until the context is actually running.
    if (typeof document === 'undefined') return;
    const unlock = () => {
      if (!this.enabled()) return;
      const ctx = this.context();
      if (!ctx) return;
      void ctx
        .resume()
        .then(() => {
          if (ctx.state === 'running') for (const t of UNLOCK_EVENTS) document.removeEventListener(t, unlock, true);
        })
        .catch(() => undefined);
    };
    for (const t of UNLOCK_EVENTS) document.addEventListener(t, unlock, { capture: true, passive: true });
  }

  set(on: boolean): void {
    this.enabled.set(on);
    try {
      if (on) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, 'off');
    } catch {
      /* storage blocked: lasts for this page load */
    }
    if (on) this.play();
  }

  /** Called on a user page turn (not on the first load or a jump from a list). */
  play(): void {
    if (!this.enabled() || this.audio.state() === 'playing') return;
    const now = performance.now();
    const gap = now - this.last;
    if (gap < MIN_GAP_MS) return;
    this.last = now;
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (!this.buffers.length) {
      // First turn only warms up; sounds are ready from the next one.
      void this.load(ctx);
      return;
    }
    while (this.voices.length >= MAX_VOICES) this.stop(this.voices.shift()!, ctx);
    const buffer = this.buffers[this.next++ % this.buffers.length]!;
    const gain = ctx.createGain();
    gain.gain.value = gap < BURST_MS ? VOLUME * 0.6 : VOLUME;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    const voice = { src, gain };
    src.onended = () => (this.voices = this.voices.filter((v) => v !== voice));
    this.voices.push(voice);
    src.start();
  }

  private stop(v: Voice, ctx: AudioContext): void {
    const t = ctx.currentTime;
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    try {
      v.src.stop(t + FADE_S);
    } catch {
      /* already stopped */
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    void this.load(this.ctx);
    return this.ctx;
  }

  private load(ctx: AudioContext): Promise<void> {
    this.loading ??= Promise.all(
      FILES.map((f) =>
        fetch(f)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b)),
      ),
    )
      .then((b) => void (this.buffers = b))
      .catch(() => void (this.loading = null));
    return this.loading;
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

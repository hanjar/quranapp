import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioService } from './audio/audio.service';

/**
 * A paper sound when the reader turns a page. Two choices (Freesound, silence trimmed,
 * see public/sfx and NOTICE.md): "Kertas" = "Aggressively turning paper pages #5" by Vvix
 * (CC0), "Ambil kertas" = "Paper Grab" by Geoff Bremner (CC BY-NC 4.0). Per-device
 * setting, "Ambil kertas" by default, quiet, and never over a recitation. Rapid page turns
 * stay calm: taps closer than MIN_GAP_MS share one sound, at most two sounds overlap
 * (the older one fades out), and turns in a burst use the short cut of the sound.
 */
export type PageSoundChoice = 'off' | 'paper' | 'grab';
const KEY = 'mf-page-sound';
/** [normal turn, burst turn] per sound. */
const FILES: Record<Exclude<PageSoundChoice, 'off'>, string[]> = {
  paper: ['/sfx/paper.wav', '/sfx/paper-short.wav'],
  grab: ['/sfx/grab.wav', '/sfx/grab-short.wav'],
};
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

  readonly choice = signal<PageSoundChoice>(readChoice());
  readonly enabled = computed(() => this.choice() !== 'off');

  private ctx: AudioContext | null = null;
  private buffers = new Map<PageSoundChoice, AudioBuffer[]>();
  private loading = new Map<PageSoundChoice, Promise<void>>();
  private voices: Voice[] = [];
  private last = 0;

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
    this.choose(on ? 'paper' : 'off');
  }

  /** Picks the sound (or off) and plays a sample so the choice can be heard. */
  choose(choice: PageSoundChoice): void {
    this.choice.set(choice);
    try {
      if (choice === 'paper') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* storage blocked: lasts for this page load */
    }
    if (choice === 'off') return;
    this.last = 0;
    const ctx = this.context();
    if (ctx) void this.load(ctx).then(() => this.play());
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
    const buffers = this.buffers.get(this.choice());
    if (!buffers?.length) {
      // First turn only warms up; sounds are ready from the next one.
      void this.load(ctx);
      return;
    }
    while (this.voices.length >= MAX_VOICES) this.stop(this.voices.shift()!, ctx);
    const burst = gap < BURST_MS;
    const buffer = buffers[burst ? 1 : 0] ?? buffers[0]!;
    const gain = ctx.createGain();
    gain.gain.value = burst ? VOLUME * 0.6 : VOLUME;
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
    const choice = this.choice();
    if (choice === 'off') return Promise.resolve();
    let p = this.loading.get(choice);
    if (!p) {
      p = Promise.all(
        FILES[choice].map((f) =>
          fetch(f)
            .then((r) => r.arrayBuffer())
            .then((b) => ctx.decodeAudioData(b)),
        ),
      )
        .then((b) => void this.buffers.set(choice, b))
        .catch(() => void this.loading.delete(choice));
      this.loading.set(choice, p);
    }
    return p;
  }
}

function readChoice(): PageSoundChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'off' || v === 'paper' ? v : 'grab';
  } catch {
    return 'grab';
  }
}

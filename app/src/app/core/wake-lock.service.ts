import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AudioService } from './audio/audio.service';
import { ReaderUiService } from './reader-ui.service';

export type WakeMode = 'off' | '10' | '30' | 'reading';

export const WAKE_OPTIONS: { id: WakeMode; label: string }[] = [
  { id: 'off', label: 'Mati' },
  { id: '10', label: '10 menit' },
  { id: '30', label: '30 menit' },
  { id: 'reading', label: 'Selama membaca' },
];

const KEY = 'mf-wake';
const DEFAULT_MODE: WakeMode = '10';
const SCROLL_THROTTLE_MS = 1000;

/** Idle timeout in ms for a mode, or null when it never times out / is off. */
export function idleMs(mode: WakeMode): number | null {
  if (mode === '10') return 10 * 60_000;
  if (mode === '30') return 30 * 60_000;
  return null;
}

function readMode(): WakeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'off' || v === '10' || v === '30' || v === 'reading') return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_MODE;
}

/** Minimal shape of the Screen Wake Lock API we rely on. */
interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

/**
 * Keeps the screen on while reading (`/hal/` routes, tab visible) until the chosen idle time
 * passes without interaction. Always on while audio plays. Starts itself when injected.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  private readonly router = inject(Router);
  private readonly ui = inject(ReaderUiService);
  private readonly audio = inject(AudioService);

  readonly supported =
    typeof navigator !== 'undefined' && !!(navigator as { wakeLock?: unknown }).wakeLock;
  readonly mode = signal<WakeMode>(readMode());
  /** True while a wake lock is actually held. */
  readonly held = signal(false);

  private readonly onReader = signal(isReaderUrl(this.router.url));
  private readonly idle = signal(false);
  private readonly visible = signal(typeof document === 'undefined' || !document.hidden);
  private sentinel: Sentinel | null = null;
  private acquiring = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScroll = 0;
  private destroyed = false;

  constructor() {
    const ac = new AbortController();
    const opts = { signal: ac.signal, capture: true, passive: true } as const;
    const touch = () => this.touch();
    const throttled = () => {
      const now = Date.now();
      if (now - this.lastScroll >= SCROLL_THROTTLE_MS) {
        this.lastScroll = now;
        this.touch();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', touch, opts);
      window.addEventListener('keydown', touch, opts);
      window.addEventListener('wheel', throttled, opts);
      window.addEventListener('scroll', throttled, opts);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => {
          this.visible.set(!document.hidden);
          if (!document.hidden) this.touch();
        },
        { signal: ac.signal },
      );
    }
    const navSub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.onReader.set(isReaderUrl(e.urlAfterRedirects));
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ac.abort();
      navSub.unsubscribe();
      this.clearTimer();
      void this.release();
    });

    // Page change counts as interaction.
    effect(() => {
      this.ui.currentPage();
      untracked(() => this.touch());
    });

    // Reconcile desired state whenever any input changes.
    effect(() => {
      const mode = this.mode();
      const playing = this.audio.state() === 'playing';
      const reader = this.onReader();
      const idle = this.idle();
      const visible = this.visible();
      const want =
        this.supported &&
        mode !== 'off' &&
        reader &&
        visible &&
        (playing || mode === 'reading' || !idle);
      if (mode === 'off' || !reader || playing || mode === 'reading') this.clearTimer();
      else if (!idle && this.idleTimer === null) this.armTimer(mode);
      if (want) void this.acquire();
      else void this.release();
    });
  }

  setMode(mode: WakeMode): void {
    this.mode.set(mode);
    this.idle.set(false);
    this.clearTimer();
    this.armTimer(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* storage unavailable */
    }
  }

  /** Register interaction: leave idle state and restart the countdown. */
  private touch(): void {
    if (this.destroyed) return;
    if (this.idle()) this.idle.set(false);
    if (this.audio.state() !== 'playing') this.armTimer(this.mode());
  }

  private armTimer(mode: WakeMode): void {
    this.clearTimer();
    const ms = idleMs(mode);
    if (ms === null || !this.onReader()) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.audio.state() !== 'playing') this.idle.set(true);
    }, ms);
  }

  private clearTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private wanted(): boolean {
    const mode = this.mode();
    return (
      mode !== 'off' &&
      this.onReader() &&
      this.visible() &&
      (this.audio.state() === 'playing' || mode === 'reading' || !this.idle())
    );
  }

  private async acquire(): Promise<void> {
    if (this.sentinel || this.acquiring || this.destroyed) return;
    const api = (navigator as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;
    this.acquiring = true;
    try {
      const s = await api.request('screen');
      if (this.destroyed || !this.wanted()) {
        await s.release().catch(() => undefined);
        return;
      }
      this.sentinel = s;
      this.held.set(true);
      s.addEventListener('release', () => {
        if (this.sentinel === s) {
          this.sentinel = null;
          this.held.set(false);
        }
      });
    } catch {
      /* denied (battery saver, hidden tab, ...) - never surface */
    } finally {
      this.acquiring = false;
    }
  }

  private async release(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    this.held.set(false);
    if (!s) return;
    try {
      await s.release();
    } catch {
      /* already released */
    }
  }
}

function isReaderUrl(url: string): boolean {
  return url.split(/[?#]/)[0].startsWith('/hal/');
}

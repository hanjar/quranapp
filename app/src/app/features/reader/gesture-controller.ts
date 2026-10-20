import { AyahRef } from '../../core/models';

/**
 * Pointer-gesture arbitration for the reader stage. Pure TS (no Angular/DOM) so
 * it is unit-testable with a fake clock. The caller resolves what is under the
 * pointer (verse polygon or blank) and passes it in on pointer-down.
 *
 * Exactly one outcome per gesture: tap | double-tap | long-press | swipe | pan | pinch.
 */

export type GestureIntent =
  | { type: 'tap-verse'; ref: AyahRef; page: number }
  | { type: 'tap-blank' }
  | { type: 'double-tap'; x: number; y: number }
  | { type: 'long-press-verse'; ref: AyahRef; page: number; x: number; y: number }
  | { type: 'swipe'; dir: 'next' | 'prev' }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'pinch'; scale: number; cx: number; cy: number; start: boolean };

export interface GestureClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const realClock: GestureClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface VerseHit {
  ref: AyahRef;
  page: number;
}

export interface GesturePointer {
  id: number;
  x: number;
  y: number;
  /** Verse under the pointer at pointer-down, if any. */
  verse?: VerseHit | null;
  /** Mouse buttons other than primary are ignored. */
  button?: number;
}

export interface GestureTuning {
  tapDelayMs: number;
  doubleTapMs: number;
  doubleTapDist: number;
  longPressMs: number;
  moveTolerance: number;
  swipeDist: number;
}

export const DEFAULT_TUNING: GestureTuning = {
  tapDelayMs: 260,
  doubleTapMs: 280,
  doubleTapDist: 30,
  longPressMs: 500,
  moveTolerance: 10,
  swipeDist: 50,
};

export interface GestureHost {
  emit(intent: GestureIntent): void;
  isZoomed(): boolean;
  isBlocked(): boolean;
}

interface Track {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  verse: VerseHit | null;
  moved: boolean;
  long: boolean;
  zoomed: boolean;
}

export class GestureController {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private track: Track | null = null;
  private pinching = false;
  /** After a pinch (or abort) ignore pointers until all are lifted. */
  private muted = false;
  private pinchStartDist = 1;
  private pinchStarted = false;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private tapTimer: unknown = null;
  private pendingTap: (() => void) | null = null;
  private longTimer: unknown = null;

  constructor(
    private readonly host: GestureHost,
    private readonly clock: GestureClock = realClock,
    private readonly tuning: GestureTuning = DEFAULT_TUNING,
  ) {}

  pointerDown(p: GesturePointer): void {
    if (p.button !== undefined && p.button > 0) return;
    if (this.host.isBlocked()) {
      this.abort();
      return;
    }
    this.pointers.set(p.id, { x: p.x, y: p.y });

    if (this.pointers.size >= 2) {
      this.startPinch();
      return;
    }
    if (this.muted) return;

    this.track = {
      id: p.id,
      x0: p.x,
      y0: p.y,
      x: p.x,
      y: p.y,
      verse: p.verse ?? null,
      moved: false,
      long: false,
      zoomed: this.host.isZoomed(),
    };
    this.clearLong();
    // Also armed on blank areas: a long hold there is swallowed (no tap on release).
    this.longTimer = this.clock.setTimeout(() => this.onLongPress(), this.tuning.longPressMs);
  }

  pointerMove(p: { id: number; x: number; y: number }): void {
    const known = this.pointers.get(p.id);
    if (!known) return;
    if (this.host.isBlocked()) {
      this.abort();
      return;
    }
    known.x = p.x;
    known.y = p.y;

    if (this.pinching) {
      this.updatePinch();
      return;
    }
    const t = this.track;
    if (!t || t.id !== p.id || this.muted) return;

    if (!t.moved && Math.hypot(p.x - t.x0, p.y - t.y0) > this.tuning.moveTolerance) {
      t.moved = true;
      this.clearLong();
    }
    if (t.moved && t.zoomed && !t.long) {
      this.host.emit({ type: 'pan', dx: p.x - t.x, dy: p.y - t.y });
    }
    t.x = p.x;
    t.y = p.y;
  }

  pointerUp(p: { id: number; x: number; y: number }): void {
    if (!this.pointers.has(p.id)) return;
    this.pointers.delete(p.id);
    const wasPinching = this.pinching;
    if (wasPinching) {
      if (this.pointers.size < 2) this.pinching = false;
      this.muted = true; // the remaining finger must not pan/tap
    }
    if (this.pointers.size === 0) {
      const t = this.track;
      const mutedNow = this.muted;
      this.track = null;
      this.muted = false;
      this.clearLong();
      if (!t || mutedNow || wasPinching) return;
      this.finish(t, p.x, p.y);
    }
  }

  pointerCancel(p?: { id: number }): void {
    if (p) this.pointers.delete(p.id);
    this.abort();
  }

  /** Cancels any pending timers (call on destroy / page change). */
  dispose(): void {
    this.abort();
    this.clearTap();
    this.lastTap = null;
  }

  // -------------------------------------------------------------------------
  private finish(t: Track, x: number, y: number): void {
    if (t.long) return;
    if (t.moved) {
      const dx = x - t.x0;
      const dy = y - t.y0;
      if (!t.zoomed && Math.abs(dx) > this.tuning.swipeDist && Math.abs(dx) > Math.abs(dy)) {
        this.host.emit({ type: 'swipe', dir: dx > 0 ? 'next' : 'prev' });
      }
      return;
    }
    const now = this.clock.now();
    const lt = this.lastTap;
    if (
      lt &&
      now - lt.t < this.tuning.doubleTapMs &&
      Math.hypot(x - lt.x, y - lt.y) < this.tuning.doubleTapDist
    ) {
      this.clearTap();
      this.lastTap = null;
      this.host.emit({ type: 'double-tap', x, y });
      return;
    }
    // A previous tap that did not pair up is definitely a single tap: flush it now.
    this.flushPendingTap();
    this.lastTap = { t: now, x, y };
    const verse = t.verse;
    const fire = (): void => {
      this.tapTimer = null;
      this.pendingTap = null;
      this.lastTap = null;
      if (this.host.isBlocked()) return;
      if (verse) this.host.emit({ type: 'tap-verse', ref: verse.ref, page: verse.page });
      else this.host.emit({ type: 'tap-blank' });
    };
    this.pendingTap = fire;
    this.tapTimer = this.clock.setTimeout(fire, this.tuning.tapDelayMs);
  }

  private flushPendingTap(): void {
    const fire = this.pendingTap;
    this.clearTap();
    fire?.();
  }

  private onLongPress(): void {
    this.longTimer = null;
    const t = this.track;
    if (!t || t.moved || t.long || this.pinching || this.host.isBlocked()) return;
    t.long = true;
    if (!t.verse) return; // long press on blank: nothing
    // A long press supersedes any tap still waiting for a possible double tap.
    this.clearTap();
    this.lastTap = null;
    this.host.emit({
      type: 'long-press-verse',
      ref: t.verse.ref,
      page: t.verse.page,
      x: t.x,
      y: t.y,
    });
  }

  private startPinch(): void {
    this.clearLong();
    this.clearTap();
    this.lastTap = null;
    this.track = null;
    this.muted = true;
    this.pinching = true;
    this.pinchStarted = false;
    const [a, b] = this.firstTwo();
    this.pinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  private updatePinch(): void {
    if (this.pointers.size < 2) return;
    const [a, b] = this.firstTwo();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    this.host.emit({
      type: 'pinch',
      scale: dist / this.pinchStartDist,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      start: !this.pinchStarted,
    });
    this.pinchStarted = true;
  }

  private firstTwo(): [{ x: number; y: number }, { x: number; y: number }] {
    const it = [...this.pointers.values()];
    return [it[0], it[1]];
  }

  private abort(): void {
    this.clearLong();
    this.track = null;
    this.pinching = false;
    this.muted = this.pointers.size > 0;
  }

  private clearLong(): void {
    if (this.longTimer !== null) this.clock.clearTimeout(this.longTimer);
    this.longTimer = null;
  }

  private clearTap(): void {
    if (this.tapTimer !== null) this.clock.clearTimeout(this.tapTimer);
    this.tapTimer = null;
    this.pendingTap = null;
  }
}

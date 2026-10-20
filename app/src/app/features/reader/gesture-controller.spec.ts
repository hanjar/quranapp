import { describe, expect, it, beforeEach } from 'vitest';
import {
  GestureClock,
  GestureController,
  GestureIntent,
  VerseHit,
} from './gesture-controller';

class FakeClock implements GestureClock {
  t = 1000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, v]) => v.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = target;
  }
  get pending(): number {
    return this.timers.size;
  }
}

const VERSE: VerseHit = { ref: { surah: 2, ayah: 6 }, page: 3 };

describe('GestureController', () => {
  let clock: FakeClock;
  let intents: GestureIntent[];
  let zoomed: boolean;
  let blocked: boolean;
  let g: GestureController;

  beforeEach(() => {
    clock = new FakeClock();
    intents = [];
    zoomed = false;
    blocked = false;
    g = new GestureController(
      { emit: (i) => intents.push(i), isZoomed: () => zoomed, isBlocked: () => blocked },
      clock,
    );
  });

  const down = (id: number, x: number, y: number, verse: VerseHit | null = null) =>
    g.pointerDown({ id, x, y, verse });
  const move = (id: number, x: number, y: number) => g.pointerMove({ id, x, y });
  const up = (id: number, x: number, y: number) => g.pointerUp({ id, x, y });
  const tap = (x: number, y: number, verse: VerseHit | null = null) => {
    down(1, x, y, verse);
    up(1, x, y);
  };
  const types = () => intents.map((i) => i.type);

  it('single tap on a verse fires after 260 ms, not before', () => {
    tap(100, 100, VERSE);
    clock.advance(259);
    expect(intents).toEqual([]);
    clock.advance(2);
    expect(intents).toEqual([{ type: 'tap-verse', ref: VERSE.ref, page: 3 }]);
  });

  it('single tap on blank fires tap-blank', () => {
    tap(100, 100);
    clock.advance(300);
    expect(intents).toEqual([{ type: 'tap-blank' }]);
  });

  it('double tap fires only double-tap (no tap)', () => {
    tap(100, 100, VERSE);
    clock.advance(150);
    tap(105, 102, VERSE);
    clock.advance(1000);
    expect(intents).toEqual([{ type: 'double-tap', x: 105, y: 102 }]);
  });

  it('two taps too far apart are two single taps', () => {
    tap(100, 100);
    clock.advance(100);
    tap(200, 200);
    clock.advance(1000);
    expect(types()).toEqual(['tap-blank', 'tap-blank']);
  });

  it('two taps too slow are two single taps', () => {
    tap(100, 100);
    clock.advance(300);
    tap(100, 100);
    clock.advance(300);
    expect(types()).toEqual(['tap-blank', 'tap-blank']);
  });

  it('long press on a verse fires once at 500 ms and never also taps', () => {
    down(1, 50, 50, VERSE);
    clock.advance(499);
    expect(intents).toEqual([]);
    clock.advance(2);
    expect(types()).toEqual(['long-press-verse']);
    up(1, 50, 50);
    clock.advance(1000);
    expect(types()).toEqual(['long-press-verse']);
  });

  it('long press on blank does nothing', () => {
    down(1, 50, 50);
    clock.advance(800);
    up(1, 50, 50);
    clock.advance(800);
    expect(intents).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('movement over 10 px cancels the long press', () => {
    down(1, 50, 50, VERSE);
    clock.advance(200);
    move(1, 50, 62);
    clock.advance(600);
    expect(intents).toEqual([]);
  });

  it('movement under 10 px keeps the long press', () => {
    down(1, 50, 50, VERSE);
    move(1, 54, 54);
    clock.advance(600);
    expect(types()).toEqual(['long-press-verse']);
  });

  it('small jitter still counts as a tap', () => {
    down(1, 50, 50);
    move(1, 53, 52);
    up(1, 53, 52);
    clock.advance(300);
    expect(types()).toEqual(['tap-blank']);
  });

  it('horizontal swipe left-to-right > 50 px = next, unzoomed', () => {
    down(1, 100, 300, VERSE);
    move(1, 140, 305);
    move(1, 180, 305);
    up(1, 180, 305);
    clock.advance(1000);
    expect(intents).toEqual([{ type: 'swipe', dir: 'next' }]);
  });

  it('swipe right-to-left = prev', () => {
    down(1, 200, 300);
    move(1, 120, 300);
    up(1, 120, 300);
    expect(intents).toEqual([{ type: 'swipe', dir: 'prev' }]);
  });

  it('short drag (<= 50 px) or mostly vertical drag is not a swipe', () => {
    down(1, 100, 300);
    move(1, 140, 300);
    up(1, 140, 300);
    down(1, 100, 300);
    move(1, 140, 420);
    up(1, 140, 420);
    clock.advance(1000);
    expect(intents).toEqual([]);
  });

  it('while zoomed a drag pans and never swipes', () => {
    zoomed = true;
    down(1, 100, 300);
    move(1, 105, 300); // within tolerance: no pan yet
    move(1, 130, 310);
    move(1, 180, 310);
    up(1, 180, 310);
    clock.advance(1000);
    expect(intents).toEqual([
      { type: 'pan', dx: 25, dy: 10 },
      { type: 'pan', dx: 50, dy: 0 },
    ]);
  });

  it('a drag starting on a verse never selects it', () => {
    down(1, 100, 300, VERSE);
    move(1, 160, 300);
    up(1, 160, 300);
    clock.advance(1000);
    expect(types()).toEqual(['swipe']);
  });

  it('pinch emits scale relative to the start distance and suppresses tap/swipe', () => {
    down(1, 100, 300, VERSE);
    down(2, 200, 300);
    move(2, 300, 300);
    move(2, 400, 300);
    up(2, 400, 300);
    up(1, 100, 300);
    clock.advance(1000);
    expect(intents).toEqual([
      { type: 'pinch', scale: 2, cx: 200, cy: 300, start: true },
      { type: 'pinch', scale: 3, cx: 250, cy: 300, start: false },
    ]);
  });

  it('a second finger cancels a pending long press and tap', () => {
    tap(100, 100);
    down(1, 100, 100, VERSE);
    down(2, 200, 100);
    clock.advance(2000);
    expect(intents).toEqual([]);
  });

  it('after a pinch the remaining finger does not tap or pan', () => {
    zoomed = true;
    down(1, 100, 300);
    down(2, 200, 300);
    up(2, 200, 300);
    move(1, 150, 350);
    up(1, 150, 350);
    clock.advance(1000);
    expect(intents).toEqual([]);
    // and a fresh gesture works again
    tap(10, 10);
    clock.advance(300);
    expect(types()).toEqual(['tap-blank']);
  });

  it('ignores gestures while blocked and drops pending tap on block', () => {
    blocked = true;
    tap(100, 100, VERSE);
    clock.advance(1000);
    expect(intents).toEqual([]);

    blocked = false;
    tap(100, 100, VERSE);
    blocked = true;
    clock.advance(1000);
    expect(intents).toEqual([]);
  });

  it('becoming blocked mid long-press aborts it', () => {
    down(1, 10, 10, VERSE);
    blocked = true;
    move(1, 11, 11);
    clock.advance(1000);
    expect(intents).toEqual([]);
  });

  it('ignores non-primary mouse buttons', () => {
    g.pointerDown({ id: 1, x: 1, y: 1, verse: VERSE, button: 2 });
    g.pointerUp({ id: 1, x: 1, y: 1 });
    clock.advance(1000);
    expect(intents).toEqual([]);
  });

  it('pointercancel clears everything', () => {
    down(1, 10, 10, VERSE);
    g.pointerCancel({ id: 1 });
    clock.advance(1000);
    expect(intents).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('dispose cancels a pending single tap', () => {
    tap(10, 10);
    g.dispose();
    clock.advance(1000);
    expect(intents).toEqual([]);
  });

  it('triple tap = double tap then a fresh single tap', () => {
    tap(100, 100);
    clock.advance(100);
    tap(100, 100);
    clock.advance(100);
    tap(100, 100);
    clock.advance(1000);
    expect(types()).toEqual(['double-tap', 'tap-blank']);
  });
});

import { READ_FULL_MS, READ_MIN_MS } from './progress-logic';

export interface PageDwellOptions {
  /** Called once per page per stay when it counts as read. `ms` = foreground dwell so far. */
  onRead: (page: number, ms: number) => void;
  now?: () => number;
  minMs?: number;
  fullMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Stay {
  since: number;
  counted: boolean;
  timer: unknown;
}

/**
 * Decides which visible pages count as "read". Pure (no Angular, no DOM): the reader calls
 *  - `visible(pages)` whenever the set of on-screen pages changes (page turn, spread, mode switch);
 *  - `hidden()` when the app goes to the background, `resume()` when it returns;
 *  - `stop()` (or `dispose()`) when the reader closes.
 * A page counts after `fullMs` (20 s) of continuous foreground, or on leaving after `minMs` (8 s).
 * Each stay reports a page at most once.
 */
export class PageDwellTracker {
  private readonly now: () => number;
  private readonly minMs: number;
  private readonly fullMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly stays = new Map<number, Stay>();
  /** Pages the reader wants tracked; survives hidden() so resume() can restart them. */
  private wanted: readonly number[] = [];
  private paused = false;

  constructor(private readonly opts: PageDwellOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.minMs = opts.minMs ?? READ_MIN_MS;
    this.fullMs = opts.fullMs ?? READ_FULL_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  visible(pages: readonly number[]): void {
    this.wanted = [...new Set(pages)];
    if (this.paused) return;
    const next = new Set(this.wanted);
    for (const page of [...this.stays.keys()]) {
      if (!next.has(page)) this.close(page);
    }
    for (const page of next) {
      if (!this.stays.has(page)) this.open(page);
    }
  }

  /** App/tab went to the background: finish current stays (they count if >= minMs) and pause. */
  hidden(): void {
    this.closeAll();
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.visible(this.wanted);
  }

  /** Reader closed: finish stays and forget the pages. */
  stop(): void {
    this.closeAll();
    this.wanted = [];
    this.paused = false;
  }

  dispose(): void {
    this.stop();
  }

  private open(page: number): void {
    const stay: Stay = { since: this.now(), counted: false, timer: null };
    stay.timer = this.setTimer(() => {
      stay.timer = null;
      if (this.stays.get(page) !== stay || stay.counted) return;
      stay.counted = true;
      this.opts.onRead(page, this.now() - stay.since);
    }, this.fullMs);
    this.stays.set(page, stay);
  }

  private close(page: number): void {
    const stay = this.stays.get(page);
    if (!stay) return;
    this.stays.delete(page);
    if (stay.timer !== null) this.clearTimer(stay.timer);
    const ms = this.now() - stay.since;
    if (!stay.counted && ms >= this.minMs) this.opts.onRead(page, ms);
  }

  private closeAll(): void {
    for (const page of [...this.stays.keys()]) this.close(page);
  }
}

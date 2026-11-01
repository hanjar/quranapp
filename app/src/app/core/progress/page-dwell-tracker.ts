import { READ_DWELL_MS, READ_TURN_MS } from './progress-logic';

export interface PageDwellOptions {
  /** Called once per page per stay when it counts as read. `ms` = foreground dwell so far. */
  onRead: (page: number, ms: number) => void;
  now?: () => number;
  /** Foreground time needed on one page (default READ_DWELL_MS = 3 min). */
  dwellMs?: number;
  /** Time on a page after which turning forward to the next page counts it (default READ_TURN_MS = 1 min). */
  turnMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Stay {
  /** Start of the current foreground stretch; null while paused. */
  since: number | null;
  /** Foreground time from earlier stretches (before the app was hidden). */
  acc: number;
  /** Foreground time needed: dwellMs, doubled for a spread. */
  need: number;
  counted: boolean;
  timer: unknown;
}

/**
 * Decides which visible pages count as "read". Pure (no Angular, no DOM): the reader calls
 *  - `visible(pages)` whenever the set of on-screen pages changes (page turn, spread, mode switch);
 *  - `hidden()` when the app goes to the background, `resume()` when it returns;
 *  - `stop()` (or `dispose()`) when the reader closes.
 * A page counts after `dwellMs` (3 min) of continuous foreground on it (a two-page spread: twice
 * that, then both count), or when the reader turns forward to the very next page after `turnMs`
 * (1 min; spread: twice that). Only foreground time counts: hiding the app (or the screen turning
 * off) pauses a stay and resume() continues it. Leaving otherwise or closing the reader counts
 * nothing. Each stay reports a page at most once.
 */
export class PageDwellTracker {
  private readonly now: () => number;
  private readonly dwellMs: number;
  private readonly turnMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly stays = new Map<number, Stay>();
  /** Pages the reader wants tracked; survives hidden() so resume() can restart them. */
  private wanted: readonly number[] = [];
  private paused = false;

  constructor(private readonly opts: PageDwellOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.dwellMs = opts.dwellMs ?? READ_DWELL_MS;
    this.turnMs = opts.turnMs ?? READ_TURN_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  visible(pages: readonly number[]): void {
    this.wanted = [...new Set(pages)];
    if (this.paused) return;
    const next = new Set(this.wanted);
    const prev = [...this.stays.keys()];
    // Sequential reading: the new view starts right after the old one (page 7 -> 8, spread 6-7 -> 8-9).
    const forward = prev.length > 0 && Math.min(...next) === Math.max(...prev) + 1;
    const minMs = this.turnMs * prev.length;
    for (const page of prev) {
      if (next.has(page)) continue;
      const stay = this.stays.get(page);
      if (forward && stay && !stay.counted && this.elapsed(stay) >= minMs) {
        stay.counted = true;
        this.opts.onRead(page, this.elapsed(stay));
      }
      this.close(page);
    }
    for (const page of next) {
      const stay = this.stays.get(page);
      if (!stay) this.open(page);
      else if (stay.since === null) this.start(page, stay);
    }
  }

  /**
   * App/tab went to the background (or the screen turned off): pause the stays, keeping the
   * foreground time so far. Background time never counts; the same pages continue on resume().
   */
  hidden(): void {
    if (this.paused) return;
    this.paused = true;
    const now = this.now();
    for (const stay of this.stays.values()) {
      if (stay.since !== null) stay.acc += now - stay.since;
      stay.since = null;
      if (stay.timer !== null) this.clearTimer(stay.timer);
      stay.timer = null;
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.visible(this.wanted);
  }

  /**
   * Counts every stay whose foreground time is already enough, by the clock. Timers can fire late
   * when the OS throttles the page (battery saver), so the app also calls this on user input.
   */
  check(): void {
    for (const [page, stay] of this.stays) {
      if (stay.counted || stay.since === null || this.elapsed(stay) < stay.need) continue;
      stay.counted = true;
      if (stay.timer !== null) this.clearTimer(stay.timer);
      stay.timer = null;
      this.opts.onRead(page, this.elapsed(stay));
    }
  }

  /** Reader closed: drop stays and forget the pages. */
  stop(): void {
    this.closeAll();
    this.wanted = [];
    this.paused = false;
  }

  dispose(): void {
    this.stop();
  }

  private open(page: number): void {
    const need = this.wanted.length > 1 ? this.dwellMs * 2 : this.dwellMs;
    const stay: Stay = { since: null, acc: 0, need, counted: false, timer: null };
    this.stays.set(page, stay);
    this.start(page, stay);
  }

  private start(page: number, stay: Stay): void {
    stay.since = this.now();
    if (stay.counted) return;
    stay.timer = this.setTimer(
      () => {
        stay.timer = null;
        if (this.stays.get(page) !== stay || stay.counted) return;
        stay.counted = true;
        this.opts.onRead(page, this.elapsed(stay));
      },
      Math.max(0, stay.need - stay.acc),
    );
  }

  private elapsed(stay: Stay): number {
    return stay.acc + (stay.since === null ? 0 : this.now() - stay.since);
  }

  private close(page: number): void {
    const stay = this.stays.get(page);
    if (!stay) return;
    this.stays.delete(page);
    if (stay.timer !== null) this.clearTimer(stay.timer);
  }

  private closeAll(): void {
    for (const page of [...this.stays.keys()]) this.close(page);
  }
}

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
  since: number;
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
 * (1 min; spread: twice that). Leaving otherwise, going to the background or closing the reader
 * counts nothing. Each stay reports a page at most once.
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
      if (forward && stay && !stay.counted && this.now() - stay.since >= minMs) {
        stay.counted = true;
        this.opts.onRead(page, this.now() - stay.since);
      }
      this.close(page);
    }
    for (const page of next) {
      if (!this.stays.has(page)) this.open(page);
    }
  }

  /** App/tab went to the background: drop current stays (uncounted) and pause. */
  hidden(): void {
    this.closeAll();
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.visible(this.wanted);
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
    const stay: Stay = { since: this.now(), counted: false, timer: null };
    stay.timer = this.setTimer(
      () => {
        stay.timer = null;
        if (this.stays.get(page) !== stay || stay.counted) return;
        stay.counted = true;
        this.opts.onRead(page, this.now() - stay.since);
      },
      this.wanted.length > 1 ? this.dwellMs * 2 : this.dwellMs,
    );
    this.stays.set(page, stay);
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

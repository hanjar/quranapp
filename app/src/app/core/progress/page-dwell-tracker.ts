import { READ_DWELL_MS } from './progress-logic';

export interface PageDwellOptions {
  /** Called once per page per stay when it counts as read. `ms` = foreground dwell so far. */
  onRead: (page: number, ms: number) => void;
  now?: () => number;
  /** Foreground time needed on one page (default READ_DWELL_MS = 30 s). */
  dwellMs?: number;
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
 * A page counts only after `dwellMs` (30 s) of continuous foreground on it; leaving earlier, going
 * to the background or closing the reader counts nothing. Each stay reports a page at most once.
 */
export class PageDwellTracker {
  private readonly now: () => number;
  private readonly dwellMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly stays = new Map<number, Stay>();
  /** Pages the reader wants tracked; survives hidden() so resume() can restart them. */
  private wanted: readonly number[] = [];
  private paused = false;

  constructor(private readonly opts: PageDwellOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.dwellMs = opts.dwellMs ?? READ_DWELL_MS;
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
    stay.timer = this.setTimer(() => {
      stay.timer = null;
      if (this.stays.get(page) !== stay || stay.counted) return;
      stay.counted = true;
      this.opts.onRead(page, this.now() - stay.since);
    }, this.dwellMs);
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

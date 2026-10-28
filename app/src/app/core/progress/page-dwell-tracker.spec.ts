import { PageDwellTracker } from './page-dwell-tracker';
import { READ_DWELL_MS } from './progress-logic';

describe('PageDwellTracker', () => {
  let reads: [number, number][];
  let tracker: PageDwellTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    reads = [];
    tracker = new PageDwellTracker({ onRead: (p, ms) => reads.push([p, ms]) });
  });
  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });

  it('dwell is 3 min', () => {
    expect(READ_DWELL_MS).toBe(180_000);
  });

  it('counts a page after 3 min of continuous foreground, once per stay', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(READ_DWELL_MS - 1);
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reads).toEqual([[5, READ_DWELL_MS]]);
    vi.advanceTimersByTime(READ_DWELL_MS);
    tracker.visible([6]); // leaving a counted page reports nothing more
    expect(reads).toHaveLength(1);
  });

  it('leaving before 3 min counts nothing (flipping through pages while searching)', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(READ_DWELL_MS - 1_000);
    tracker.visible([6]);
    vi.advanceTimersByTime(READ_DWELL_MS - 1_000);
    tracker.visible([7]);
    vi.advanceTimersByTime(READ_DWELL_MS);
    expect(reads).toEqual([[7, READ_DWELL_MS]]);
  });

  it('a two-page spread needs 6 min (2 x READ_DWELL_MS), then both pages count', () => {
    tracker.visible([4, 5]);
    vi.advanceTimersByTime(2 * READ_DWELL_MS - 1);
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reads).toEqual([
      [4, 2 * READ_DWELL_MS],
      [5, 2 * READ_DWELL_MS],
    ]);
  });

  it('turning to the next spread before 6 min counts nothing', () => {
    tracker.visible([4, 5]);
    vi.advanceTimersByTime(READ_DWELL_MS); // a single page would have counted by now
    tracker.visible([6, 7]);
    vi.advanceTimersByTime(READ_DWELL_MS);
    expect(reads).toEqual([]);
  });

  it('hidden() drops stays and pauses; resume() restarts the wanted pages from zero', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(READ_DWELL_MS - 1_000);
    tracker.hidden();
    vi.advanceTimersByTime(2 * READ_DWELL_MS); // background time never counts
    expect(reads).toEqual([]);
    tracker.visible([6]); // page turn while hidden is remembered, not started
    vi.advanceTimersByTime(READ_DWELL_MS);
    expect(reads).toEqual([]);
    tracker.resume();
    vi.advanceTimersByTime(READ_DWELL_MS);
    expect(reads).toEqual([[6, READ_DWELL_MS]]);
  });

  it('stop() drops stays, forgets pages and cancels timers', () => {
    tracker.visible([5, 6]);
    vi.advanceTimersByTime(20_000);
    tracker.stop();
    vi.advanceTimersByTime(2 * READ_DWELL_MS);
    expect(reads).toEqual([]);
    tracker.resume(); // nothing wanted: no-op
    vi.advanceTimersByTime(2 * READ_DWELL_MS);
    expect(reads).toEqual([]);
  });

  it('ignores duplicate page numbers and repeated visible() with the same set', () => {
    tracker.visible([5, 5]);
    vi.advanceTimersByTime(READ_DWELL_MS / 2);
    tracker.visible([5]);
    vi.advanceTimersByTime(READ_DWELL_MS / 2);
    expect(reads).toEqual([[5, READ_DWELL_MS]]);
  });
});

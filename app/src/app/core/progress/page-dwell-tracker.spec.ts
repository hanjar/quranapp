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

  it('dwell is 30 s', () => {
    expect(READ_DWELL_MS).toBe(30_000);
  });

  it('counts a page after 30 s of continuous foreground, once per stay', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(29_999);
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reads).toEqual([[5, 30_000]]);
    vi.advanceTimersByTime(60_000);
    tracker.visible([6]); // leaving a counted page reports nothing more
    expect(reads).toHaveLength(1);
  });

  it('leaving before 30 s counts nothing (flipping through pages while searching)', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(29_000);
    tracker.visible([6]);
    vi.advanceTimersByTime(29_000);
    tracker.visible([7]);
    vi.advanceTimersByTime(60_000);
    expect(reads).toEqual([[7, 30_000]]);
  });

  it('tracks both pages of a spread independently and keeps staying pages running', () => {
    tracker.visible([4, 5]);
    vi.advanceTimersByTime(20_000);
    tracker.visible([5, 6]); // 4 left uncounted, 5 stays
    vi.advanceTimersByTime(10_000); // 5 reaches 30 s
    expect(reads).toEqual([[5, 30_000]]);
    vi.advanceTimersByTime(20_000); // 6 reaches 30 s
    expect(reads).toEqual([[5, 30_000], [6, 30_000]]);
  });

  it('hidden() drops stays and pauses; resume() restarts the wanted pages from zero', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(29_000);
    tracker.hidden();
    vi.advanceTimersByTime(120_000); // background time never counts
    expect(reads).toEqual([]);
    tracker.visible([6]); // page turn while hidden is remembered, not started
    vi.advanceTimersByTime(60_000);
    expect(reads).toEqual([]);
    tracker.resume();
    vi.advanceTimersByTime(30_000);
    expect(reads).toEqual([[6, 30_000]]);
  });

  it('stop() drops stays, forgets pages and cancels timers', () => {
    tracker.visible([5, 6]);
    vi.advanceTimersByTime(20_000);
    tracker.stop();
    vi.advanceTimersByTime(120_000);
    expect(reads).toEqual([]);
    tracker.resume(); // nothing wanted: no-op
    vi.advanceTimersByTime(120_000);
    expect(reads).toEqual([]);
  });

  it('ignores duplicate page numbers and repeated visible() with the same set', () => {
    tracker.visible([5, 5]);
    vi.advanceTimersByTime(15_000);
    tracker.visible([5]);
    vi.advanceTimersByTime(15_000);
    expect(reads).toEqual([[5, 30_000]]);
  });
});

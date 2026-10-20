import { PageDwellTracker } from './page-dwell-tracker';

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

  it('counts a page after 20 s of continuous foreground, once per stay', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(19_999);
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reads).toEqual([[5, 20_000]]);
    vi.advanceTimersByTime(60_000);
    tracker.visible([6]); // leaving a counted page reports nothing more
    expect(reads).toHaveLength(1);
  });

  it('counts a page left after >= 8 s but not before', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(7_999);
    tracker.visible([6]);
    expect(reads).toEqual([]);
    vi.advanceTimersByTime(8_000);
    tracker.visible([7]);
    expect(reads).toEqual([[6, 8_000]]);
  });

  it('tracks both pages of a spread independently and keeps staying pages running', () => {
    tracker.visible([4, 5]);
    vi.advanceTimersByTime(10_000);
    tracker.visible([5, 6]); // 4 left after 10 s, 5 stays
    expect(reads).toEqual([[4, 10_000]]);
    vi.advanceTimersByTime(10_000); // 5 reaches 20 s
    expect(reads).toEqual([[4, 10_000], [5, 20_000]]);
  });

  it('hidden() finishes stays and pauses; resume() restarts the wanted pages from zero', () => {
    tracker.visible([5]);
    vi.advanceTimersByTime(9_000);
    tracker.hidden();
    expect(reads).toEqual([[5, 9_000]]);
    vi.advanceTimersByTime(120_000); // background time never counts
    expect(reads).toHaveLength(1);
    tracker.visible([6]); // page turn while hidden is remembered, not started
    vi.advanceTimersByTime(30_000);
    expect(reads).toHaveLength(1);
    tracker.resume();
    vi.advanceTimersByTime(20_000);
    expect(reads).toEqual([[5, 9_000], [6, 20_000]]);
  });

  it('stop() finishes stays, forgets pages and cancels timers', () => {
    tracker.visible([5, 6]);
    vi.advanceTimersByTime(8_000);
    tracker.stop();
    expect(reads).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(reads).toHaveLength(2);
    tracker.resume(); // nothing wanted: no-op
    vi.advanceTimersByTime(60_000);
    expect(reads).toHaveLength(2);
  });

  it('ignores duplicate page numbers and repeated visible() with the same set', () => {
    tracker.visible([5, 5]);
    vi.advanceTimersByTime(10_000);
    tracker.visible([5]);
    vi.advanceTimersByTime(10_000);
    expect(reads).toEqual([[5, 20_000]]);
  });
});

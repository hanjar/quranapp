import { KhatamRound, ReadDay } from '../models';
import {
  JUZ_START_PAGES,
  addDays,
  averagePerDay,
  daysBetween,
  etaDate,
  firstUnreadPage,
  juzProgress,
  juzRange,
  lastDays,
  localDay,
  pickCurrentRound,
  readInRound,
  recentPages,
} from './progress-logic';

const day = (d: string, pages: Record<string, [number, number]>): ReadDay => ({
  day: d,
  pages,
  updatedAt: 0,
  rev: null,
});
const round = (n: number, startedAt: number, finishedAt: number | null = null): KhatamRound => ({
  id: `r${n}`,
  n,
  startedAt,
  finishedAt,
  updatedAt: 0,
  rev: null,
});

describe('progress logic', () => {
  it('juz ranges tile the mushaf with 30 juz', () => {
    expect(JUZ_START_PAGES).toHaveLength(30);
    expect(juzRange(1)).toEqual([1, 21]);
    expect(juzRange(2)).toEqual([22, 41]);
    expect(juzRange(30)).toEqual([582, 604]);
    let total = 0;
    for (let n = 1; n <= 30; n++) {
      const [a, b] = juzRange(n);
      total += b - a + 1;
    }
    expect(total).toBe(604);
  });

  it('day helpers use the local calendar', () => {
    const ms = new Date(2026, 9, 20, 23, 59).getTime();
    expect(localDay(ms)).toBe('2026-10-20');
    expect(localDay(ms + 2 * 60_000)).toBe('2026-10-21');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-14', '2026-10-20')).toBe(6);
  });

  it('current round is the highest-numbered unfinished one', () => {
    expect(pickCurrentRound([])).toBeNull();
    expect(pickCurrentRound([round(1, 0, 5)])).toBeNull();
    expect(pickCurrentRound([round(1, 0, 5), round(2, 6), round(3, 9)])?.n).toBe(3);
  });

  it('pages in a round are those read at/after its start', () => {
    const days = [
      day('2026-10-01', { '1': [10, 20], '2': [10, 20] }),
      day('2026-10-02', { '2': [100, 130], '3': [100, 110] }),
    ];
    expect([...readInRound(days, round(1, 0))].sort()).toEqual([1, 2, 3]);
    expect([...readInRound(days, round(2, 50))].sort()).toEqual([2, 3]);
    expect(readInRound(days, null).size).toBe(0);
  });

  it('juzProgress counts per juz; first unread honours ranges', () => {
    const read = new Set<number>([1, 2, 3, 22, 23]);
    const jp = juzProgress(read);
    expect(jp).toHaveLength(30);
    expect(jp[0]).toEqual({ juz: 1, read: 3, total: 21 });
    expect(jp[1]).toEqual({ juz: 2, read: 2, total: 20 });
    expect(firstUnreadPage(read)).toBe(4);
    expect(firstUnreadPage(read, 22, 41)).toBe(24);
    expect(firstUnreadPage(new Set([1, 2]), 1, 2)).toBeNull();
  });

  it('recent: distinct pages, newest first, latest read wins', () => {
    const days = [
      day('2026-10-01', { '5': [1, 10], '6': [1, 30] }),
      day('2026-10-02', { '5': [1, 50], '7': [1, 40] }),
    ];
    const r = recentPages(days, 2);
    expect(r.map((x) => x.page)).toEqual([5, 7]);
    expect(r[0]).toMatchObject({ lastAt: 50, day: '2026-10-02' });
    expect(recentPages(days, 0)).toEqual([]);
  });

  it('lastDays includes zero days; average shortens its window for new readers', () => {
    const days = [
      day('2026-10-19', { '1': [1, 1], '2': [1, 1] }),
      day('2026-10-20', { '3': [1, 1], '4': [1, 1], '5': [1, 1], '6': [1, 1] }),
    ];
    const l7 = lastDays(days, '2026-10-20');
    expect(l7).toHaveLength(7);
    expect(l7[0]).toEqual({ day: '2026-10-14', count: 0 });
    expect(l7[6]).toEqual({ day: '2026-10-20', count: 4 });
    expect(averagePerDay(days, '2026-10-20')).toBe(3); // 6 pages over 2 days since the first read
    expect(averagePerDay([day('2026-09-01', { '1': [1, 1] })], '2026-10-20')).toBeCloseTo(0);
    expect(averagePerDay([], '2026-10-20')).toBe(0);
  });

  it('eta needs a pace and something left', () => {
    const now = new Date(2026, 9, 20, 8).getTime();
    expect(etaDate(0, 5, now)).toBeNull();
    expect(etaDate(100, 0, now)).toBeNull();
    const d = etaDate(100, 5, now) as Date;
    expect(localDay(d.getTime())).toBe('2026-11-09'); // 20 days later
    expect(localDay((etaDate(11, 5, now) as Date).getTime())).toBe('2026-10-23'); // ceil(2.2)=3
  });
});

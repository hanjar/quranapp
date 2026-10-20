import { KhatamRound, PAGE_COUNT, PageReadSpan, ReadDay } from '../models';

/** Counts as read: >= READ_FULL_MS in the foreground, or left after >= READ_MIN_MS. */
export const READ_MIN_MS = 8_000;
export const READ_FULL_MS = 20_000;

/**
 * First page of each juz in the Madinah (KFQC, 604-page) mushaf; index 0 = juz 1.
 * Static on purpose: progress must not wait for content metadata, and the app ships one edition.
 */
export const JUZ_START_PAGES: readonly number[] = [
  1, 22, 42, 62, 82, 102, 122, 142, 162, 182, 202, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402,
  422, 442, 462, 482, 502, 522, 542, 562, 582,
];

export interface JuzProgress {
  juz: number;
  read: number;
  total: number;
}

export interface RecentPage {
  page: number;
  /** Epoch ms of the most recent read of this page (any day). */
  lastAt: number;
  day: string;
}

export interface DayCount {
  day: string;
  count: number;
}

/** Inclusive `[first, last]` page range of juz `n` (1-30). */
export function juzRange(n: number): [number, number] {
  const start = JUZ_START_PAGES[n - 1] ?? 1;
  const next = JUZ_START_PAGES[n];
  return [start, next === undefined ? PAGE_COUNT : next - 1];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Device-local calendar day, 'YYYY-MM-DD'. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day string shifted by whole calendar days (DST-safe: works on the local date, not on ms). */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + delta, 12).getTime());
}

/** Whole calendar days from `a` to `b` (b later gives a positive number). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number) as [number, number, number];
  const [yb, mb, db] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** The open round: the unfinished round with the highest number. */
export function pickCurrentRound(rounds: readonly KhatamRound[]): KhatamRound | null {
  let best: KhatamRound | null = null;
  for (const r of rounds) {
    if (r.finishedAt == null && (!best || r.n > best.n)) best = r;
  }
  return best;
}

/** Pages with any read at/after the round start (empty when there is no open round). */
export function readInRound(days: readonly ReadDay[], round: KhatamRound | null): Set<number> {
  const out = new Set<number>();
  if (!round) return out;
  for (const d of days) {
    for (const [k, span] of Object.entries(d.pages)) {
      if (span[1] >= round.startedAt) out.add(Number(k));
    }
  }
  return out;
}

export function juzProgress(read: ReadonlySet<number>): JuzProgress[] {
  return JUZ_START_PAGES.map((_, i) => {
    const [a, b] = juzRange(i + 1);
    let n = 0;
    for (let p = a; p <= b; p++) if (read.has(p)) n++;
    return { juz: i + 1, read: n, total: b - a + 1 };
  });
}

export function firstUnreadPage(
  read: ReadonlySet<number>,
  from = 1,
  to = PAGE_COUNT,
): number | null {
  for (let p = from; p <= to; p++) if (!read.has(p)) return p;
  return null;
}

/** Distinct pages, most recently read first. */
export function recentPages(days: readonly ReadDay[], n: number): RecentPage[] {
  const best = new Map<number, RecentPage>();
  for (const d of days) {
    for (const [k, span] of Object.entries(d.pages)) {
      const page = Number(k);
      const cur = best.get(page);
      if (!cur || span[1] > cur.lastAt) best.set(page, { page, lastAt: span[1], day: d.day });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.lastAt - a.lastAt || a.page - b.page)
    .slice(0, Math.max(0, n));
}

/** Pages read per day for the `count` days ending `today` (oldest first, zeros included). */
export function lastDays(days: readonly ReadDay[], today: string, count = 7): DayCount[] {
  const byDay = new Map(days.map((d) => [d.day, Object.keys(d.pages).length]));
  const out: DayCount[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

/**
 * Average pages/day over the last 7 days. The divisor is shortened to the days since the
 * first logged day so a new reader is not under-estimated.
 */
export function averagePerDay(days: readonly ReadDay[], today: string): number {
  if (!days.length) return 0;
  const first = days.reduce((m, d) => (d.day < m ? d.day : m), days[0]!.day);
  const span = Math.min(7, Math.max(1, daysBetween(first, today) + 1));
  const total = lastDays(days, today, 7).reduce((s, d) => s + d.count, 0);
  return total / span;
}

/** Expected finish date for the open round at the recent pace; null without a pace or nothing left. */
export function etaDate(remaining: number, perDay: number, now: number): Date | null {
  if (remaining <= 0 || perDay <= 0) return null;
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Math.ceil(remaining / perDay));
  return d;
}

/** Merges `[firstAt,lastAt]` of one view into an existing span. */
export function mergeSpan(
  cur: PageReadSpan | undefined,
  first: number,
  last: number,
): PageReadSpan {
  return cur ? [Math.min(cur[0], first), Math.max(cur[1], last)] : [first, last];
}

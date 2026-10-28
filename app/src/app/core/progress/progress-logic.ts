import { KhatamRound, PAGE_COUNT, PageReadSpan, ReadDay, spanActive } from '../models';

/** A page counts as read after this much continuous foreground time on it (leaving earlier counts nothing). */
export const READ_DWELL_MS = 180_000;

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

/** How many days back a day can be picked for a manual mark. */
export const MARK_BACK_DAYS = 30;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day 'YYYY-MM-DD'. */
export function isDayString(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DAY_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** 12:00 local time of `day`: the timestamp given to pages marked on a chosen day. */
export function dayNoon(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getTime();
}

/** Why `day` cannot receive a manual mark (null = allowed): any local day from 30 days ago to today. */
export function markDayError(day: unknown, nowMs: number): string | null {
  if (!isDayString(day)) return 'Tanggal tidak valid.';
  const today = localDay(nowMs);
  if (day > today) return 'Tanggal tidak boleh di masa depan.';
  if (day < addDays(today, -MARK_BACK_DAYS))
    return `Tanggal maksimal ${MARK_BACK_DAYS} hari ke belakang.`;
  return null;
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
      if (spanActive(span) && span[1] >= round.startedAt) out.add(Number(k));
    }
  }
  return out;
}

/** Pages manually marked as read that count for `round` (marked after it started, not unmarked since). */
export function markedInRound(
  marks: Record<string, [number, number]>,
  round: KhatamRound | null,
): Set<number> {
  const out = new Set<number>();
  if (!round) return out;
  for (const [k, [markedAt, unmarkedAt]] of Object.entries(marks)) {
    if (markedAt > unmarkedAt && markedAt >= round.startedAt) out.add(Number(k));
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
      if (!spanActive(span)) continue;
      const page = Number(k);
      const cur = best.get(page);
      if (!cur || span[1] > cur.lastAt) best.set(page, { page, lastAt: span[1], day: d.day });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.lastAt - a.lastAt || a.page - b.page)
    .slice(0, Math.max(0, n));
}

/** Pages that count on one day (removed pages excluded). */
export function dayCount(d: ReadDay): number {
  let n = 0;
  for (const v of Object.values(d.pages)) if (spanActive(v)) n++;
  return n;
}

/** Compact page ranges, e.g. [519..536, 540] -> "519–536, 540". */
export function pageRangesText(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Pages read per day for the `count` days ending `today` (oldest first, zeros included). */
export function lastDays(days: readonly ReadDay[], today: string, count = 7): DayCount[] {
  const byDay = new Map(days.map((d) => [d.day, dayCount(d)]));
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
  if (!cur) return [first, last];
  const f = Math.min(cur[0], first);
  const l = Math.max(cur[1], last);
  return cur[2] === undefined ? [f, l] : [f, l, cur[2]];
}

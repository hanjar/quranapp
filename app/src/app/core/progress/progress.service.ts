import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { liveQuery } from 'dexie';
import { ContentApi, UserDataApi } from '../contracts';
import {
  Bookmark,
  KhatamRound,
  PAGE_COUNT,
  PageReadSpan,
  ReadDay,
  ReadMarks,
  clampDailyTarget,
  isValidPage,
  mergeReadMarks,
  mergeReadPages,
  activePageNumbers,
  spanActive,
  uuid,
} from '../models';
import { MushafDb } from '../storage/db';
import { MUSHAF_DB } from '../storage/db-token';
import { activeSyncAccount, enqueueOutbox } from '../storage/outbox';
import { readDayPayload, readMarksPayload, roundPayload } from '../sync/outbox';
import { PageDwellTracker } from './page-dwell-tracker';
import {
  DayCount,
  JuzProgress,
  READ_DWELL_MS,
  RecentPage,
  averagePerDay,
  dayCount,
  dayNoon,
  isDayString,
  markDayError,
  etaDate,
  firstUnreadPage,
  juzProgress,
  juzRange,
  lastDays,
  localDay,
  markedInRound,
  mergeSpan,
  pickCurrentRound,
  readInRound,
  recentPages,
} from './progress-logic';

export interface MarkResult {
  /** Number of pages newly added. */
  added: number;
  pages: number[];
  undo: () => Promise<boolean>;
  /** Indonesian reason when the mark was refused (bad day, before the round started). */
  error?: string;
}

export interface UnmarkDayResult {
  removed: number;
  pages: number[];
  undo: () => Promise<boolean>;
}

export interface MoveResult {
  moved: number;
  pages: number[];
  undo: () => Promise<boolean>;
  error?: string;
}

class MarkError extends Error {}

/** Window in which the undo returned by clearHistory() / markRead() is honoured. */
export const CLEAR_UNDO_WINDOW_MS = 8000;

/**
 * Automatic reading progress. Local-first (Dexie `readDays` + `rounds`); when signed in every
 * write also lands in the sync outbox (coalesced per day / round). The server merges days by
 * union, so two devices reading the same day both count. See docs/progress.md.
 */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private readonly db: MushafDb = inject(MUSHAF_DB);
  private readonly data = inject(UserDataApi);
  /** Only needed to recognise end-of-page verse bookmarks; absent in lean test setups. */
  private readonly content = inject(ContentApi, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  /** Aborts document listeners and stops trackers when the injector is destroyed. */
  private readonly listeners = new AbortController();
  private readonly trackers = new Set<PageDwellTracker>();

  private readonly _days = signal<ReadDay[]>([]);
  private readonly _rounds = signal<KhatamRound[]>([]);
  private readonly _marks = signal<Record<string, [number, number]>>({});
  private readonly _ready = signal(false);
  private readonly _now = signal(Date.now());

  /** True after the first read from IndexedDB. */
  readonly ready = this._ready.asReadonly();
  /** Reading days, oldest first. Each page maps to `[firstAt, lastAt, removedAt?]`. */
  readonly days = this._days.asReadonly();
  /** All khatam rounds, ascending by number. */
  readonly rounds = this._rounds.asReadonly();
  /** Open round (latest unfinished), or null before the first recorded read. */
  readonly currentRound = computed(() => pickCurrentRound(this._rounds()));
  /** Pages manually marked "sudah dibaca" that count for the open round (subset of readInRound). */
  readonly markedPages = computed<ReadonlySet<number>>(() =>
    markedInRound(this._marks(), this.currentRound()),
  );
  /**
   * Pages read in the open round: tracked reads plus manual marks. Marks never feed todayCount,
   * last7, the ETA pace or the daily target.
   */
  readonly readInRound = computed<ReadonlySet<number>>(() => {
    const out = readInRound(this._days(), this.currentRound());
    for (const p of this.markedPages()) out.add(p);
    return out;
  });
  /** Open-round completion, 0-100 with one decimal. */
  readonly percent = computed(() => Math.round((this.readInRound().size / PAGE_COUNT) * 1000) / 10);
  /** True when every page of the open round has been read (UI offers startNextRound()). */
  readonly roundComplete = computed(() => this.readInRound().size >= PAGE_COUNT);
  /** Distinct pages read today (device-local day). */
  readonly todayCount = computed(() => {
    const today = localDay(this._now());
    const row = this._days().find((d) => d.day === today);
    return row ? dayCount(row) : 0;
  });
  /** Pages per day for the last 7 days, oldest first, today last, zeros included. */
  readonly last7 = computed<DayCount[]>(() => lastDays(this._days(), localDay(this._now()), 7));
  /** 30 entries (juz 1-30): pages read in the open round vs. total pages of that juz. */
  readonly juzProgress = computed<JuzProgress[]>(() => juzProgress(this.readInRound()));
  /** First unread page of the open round (1-604), null when all 604 are read. */
  readonly firstUnread = computed(() => firstUnreadPage(this.readInRound()));
  /** Expected finish date of the open round at the 7-day pace, or null (no pace / already done). */
  readonly eta = computed<Date | null>(() =>
    etaDate(
      PAGE_COUNT - this.readInRound().size,
      averagePerDay(this._days(), localDay(this._now())),
      this._now(),
    ),
  );
  /** "Catat progres membaca" (synced preference, default on). */
  readonly enabled = computed(() => this.data.prefs().trackProgress);
  /** Daily goal in pages (1-40, synced preference). */
  readonly dailyTarget = computed(() => this.data.prefs().dailyTarget);

  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    const sub = liveQuery(async () => ({
      days: await this.db.readDays.orderBy('day').toArray(),
      rounds: await this.db.rounds.orderBy('n').toArray(),
      marks: (await this.db.readMarks.get('marks'))?.marks ?? {},
    })).subscribe({
      next: ({ days, rounds, marks }) => {
        this._marks.set(marks);
        this._days.set(days);
        this._rounds.set(rounds);
        this._ready.set(true);
      },
      error: () => this._ready.set(true),
    });
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      this.listeners.abort();
      for (const t of this.trackers) t.dispose();
      this.trackers.clear();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'visible') this.refreshToday();
        },
        { signal: this.listeners.signal },
      );
    }
  }

  /** Serializes writes so read-modify-write sequences never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private get tables() {
    return [this.db.readDays, this.db.rounds, this.db.readMarks, this.db.outbox, this.db.sync];
  }

  /** Re-reads the clock (day rollover). Called on tab focus and after every recorded view. */
  refreshToday(): void {
    this._now.set(Date.now());
  }

  /** Resolves when all queued writes finished (tests / teardown). */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  // ---- queries -------------------------------------------------------------

  /** First unread page inside juz `n` (1-30) for the open round; null when the juz is complete. */
  firstUnreadInJuz(n: number): number | null {
    if (!Number.isInteger(n) || n < 1 || n > 30) return null;
    const [a, b] = juzRange(n);
    return firstUnreadPage(this.readInRound(), a, b);
  }

  /** Distinct pages by most recent read (any round), newest first. */
  recent(n: number): RecentPage[] {
    return recentPages(this._days(), n);
  }

  // ---- recording -----------------------------------------------------------

  /**
   * Records that `page` was read: visible for `ms` of foreground time, ending at `at`.
   * No-op when tracking is off, the page is invalid or `ms` < READ_DWELL_MS (3 min).
   * Creates khatam round 1 on the very first read. Never rejects on storage errors.
   */
  recordView(page: number, ms: number, at: number = Date.now()): Promise<void> {
    if (!(ms >= READ_DWELL_MS)) return Promise.resolve();
    return this.recordSpan(page, ms, at);
  }

  /**
   * Records a page heard in full from the murottal: same as recordView, but with no dwell minimum
   * (the listen itself is the proof of reading). ms is clamped to at least 1.
   */
  recordListened(page: number, ms: number, at: number = Date.now()): Promise<void> {
    return this.recordSpan(page, Math.max(1, ms || 0), at);
  }

  private recordSpan(page: number, ms: number, at: number): Promise<void> {
    if (!this.enabled() || !isValidPage(page)) return Promise.resolve();
    return this.serial(async () => {
      if (!this.enabled()) return;
      const first = at - Math.min(ms, 6 * 3_600_000);
      const day = localDay(at);
      await this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const cur = await this.db.readDays.get(day);
        const key = String(page);
        const row: ReadDay = {
          day,
          pages: { ...(cur?.pages ?? {}), [key]: mergeSpan(cur?.pages[key], first, at) },
          updatedAt: at,
          rev: cur?.rev ?? null,
        };
        await this.db.readDays.put(row);
        if (account) {
          await enqueueOutbox(
            this.db,
            account,
            'readday',
            day,
            'upsert',
            readDayPayload(row),
            row.rev,
          );
        }
        const rounds = await this.db.rounds.toArray();
        if (!pickCurrentRound(rounds)) {
          const created: KhatamRound = {
            id: uuid(),
            n: rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1,
            startedAt: first,
            finishedAt: null,
            updatedAt: at,
            rev: null,
          };
          await this.db.rounds.add(created);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'khatam',
              created.id,
              'upsert',
              roundPayload(created),
              null,
            );
          }
        }
      });
    })
      .catch(() => undefined)
      .finally(() => this.refreshToday());
  }

  /**
   * Creates a tracker wired to recordView(). It pauses on tab hide and resumes on show, and is
   * stopped automatically when the app injector is destroyed. The reader owns it: call
   * `tracker.visible([...pages])` on every page/spread/mode change and `tracker.stop()` on leave.
   */
  createTracker(): PageDwellTracker {
    const tracker = new PageDwellTracker({ onRead: (page, ms) => void this.recordView(page, ms) });
    this.trackers.add(tracker);
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => (document.visibilityState === 'hidden' ? tracker.hidden() : tracker.resume()),
        { signal: this.listeners.signal },
      );
    }
    return tracker;
  }

  // ---- khatam rounds -------------------------------------------------------

  /**
   * Finishes the open round (finishedAt = now) and starts round n+1. Returns the new round, or null
   * when there is no open round. Not automatic: the UI offers it once all 604 pages are read.
   */
  startNextRound(): Promise<KhatamRound | null> {
    return this.serial(async () => {
      const now = Date.now();
      return this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const rounds = await this.db.rounds.toArray();
        const cur = pickCurrentRound(rounds);
        if (!cur) return null;
        const done: KhatamRound = { ...cur, finishedAt: now, updatedAt: now };
        await this.db.rounds.put(done);
        const next: KhatamRound = {
          id: uuid(),
          n: rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1,
          startedAt: now,
          finishedAt: null,
          updatedAt: now,
          rev: null,
        };
        await this.db.rounds.add(next);
        if (account) {
          await enqueueOutbox(
            this.db,
            account,
            'khatam',
            done.id,
            'upsert',
            roundPayload(done),
            done.rev,
          );
          await enqueueOutbox(
            this.db,
            account,
            'khatam',
            next.id,
            'upsert',
            roundPayload(next),
            null,
          );
        }
        return next;
      });
    });
  }

  // ---- manual marks ("sudah dibaca") -------------------------------------

  /**
   * Marks pages as read for the open round (creating a round if none exists).
   *  - `when: 'today'`: pages read today. They go into today's reading day like normal views, so they
   *    count for todayCount / last7 / eta pace AND the round. Pages already counted that day are skipped.
   *  - `when: 'day'` + `day: 'YYYY-MM-DD'`: same, for a chosen local day from 30 days ago to today
   *    (timestamp = that day 12:00; today = now). A day before the open round's start moves round 1's
   *    start back; for a later round it is refused (`error` set, nothing written).
   *  - `when: 'before'` (default): earlier reading. Counts for the round only (readInRound, percent,
   *    juzProgress, firstUnread, roundComplete), never for daily stats. Pages already read or marked
   *    in the round are skipped.
   * Works regardless of the "Catat progres" setting (explicit user action). Resolves with the pages
   * newly added and an `undo` (valid CLEAR_UNDO_WINDOW_MS): for 'before' it removes the marks; for
   * day marks it removes those pages again but returns false once the day's op was already sent
   * (use unmarkDay() then).
   */
  markRead(
    pages: readonly number[] | { from: number; to: number },
    opts: { when?: 'today' | 'day' | 'before'; day?: string } = {},
  ): Promise<MarkResult> {
    const list = expandPages(pages);
    const when = opts.when ?? 'before';
    const none: MarkResult = { added: 0, pages: [], undo: () => Promise.resolve(false) };
    if (!list.length) return Promise.resolve(none);
    if (when === 'day') {
      const err = markDayError(opts.day, Date.now());
      if (err) return Promise.resolve({ ...none, error: err });
    }
    return this.serial(async () => {
      const now = Date.now();
      const day = when === 'day' ? (opts.day as string) : localDay(now);
      const stamp = day === localDay(now) ? now : dayNoon(day);
      const added = await this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const rounds = await this.db.rounds.toArray();
        let round = pickCurrentRound(rounds);
        let createdRound: KhatamRound | null = null;
        if (round && when !== 'before' && stamp < round.startedAt) {
          if (round.n !== 1) {
            throw new MarkError(
              `Tanggal itu sebelum khatam ke-${round.n} dimulai (${localDay(round.startedAt)}). Pilih tanggal yang lebih baru.`,
            );
          }
          round = { ...round, startedAt: stamp, updatedAt: now };
          await this.db.rounds.put(round);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'khatam',
              round.id,
              'upsert',
              roundPayload(round),
              round.rev,
            );
          }
        }
        if (!round) {
          round = createdRound = {
            id: uuid(),
            n: rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1,
            startedAt: when === 'before' ? now : Math.min(now, stamp),
            finishedAt: null,
            updatedAt: now,
            rev: null,
          };
          await this.db.rounds.add(round);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'khatam',
              round.id,
              'upsert',
              roundPayload(round),
              null,
            );
          }
        }
        const done: number[] = [];
        const prev: Record<string, PageReadSpan | undefined> = {};
        const stamped: Record<string, PageReadSpan> = {};
        if (when !== 'before') {
          const cur = await this.db.readDays.get(day);
          const mine = { ...(cur?.pages ?? {}) };
          for (const p of list) {
            const k = String(p);
            const old = mine[k];
            if (old && spanActive(old)) continue;
            // A removed page is re-added with lastAt just past its removal so it counts again.
            const span: PageReadSpan = old
              ? [Math.min(old[0], stamp), Math.max(stamp, (old[2] ?? 0) + 1), old[2] as number]
              : [stamp, stamp];
            prev[k] = old;
            stamped[k] = span;
            mine[k] = span;
            done.push(p);
          }
          if (done.length) {
            const row: ReadDay = { day, pages: mine, updatedAt: now, rev: cur?.rev ?? null };
            await this.db.readDays.put(row);
            if (account) {
              await enqueueOutbox(
                this.db,
                account,
                'readday',
                day,
                'upsert',
                readDayPayload(row),
                row.rev,
              );
            }
          }
        } else {
          const cur = await this.db.readMarks.get('marks');
          const marks = { ...(cur?.marks ?? {}) };
          const already = this.readInRoundFrom(await this.db.readDays.toArray(), marks, round);
          for (const p of list) {
            if (already.has(p)) continue;
            const old = marks[String(p)];
            marks[String(p)] = [Math.max(now, (old?.[1] ?? 0) + 1), old?.[1] ?? 0];
            done.push(p);
          }
          if (done.length) await this.putMarks(cur, marks, now, account);
        }
        return { pages: done, createdRound, prev, stamped };
      });
      const undo = async (): Promise<boolean> => {
        if (!added.pages.length) return false;
        if (when === 'before') return (await this.unmarkRead(added.pages)) > 0;
        return this.serial(async () => {
          if (Date.now() - now > CLEAR_UNDO_WINDOW_MS) return false;
          return this.db.transaction('rw', this.tables, async () => {
            const account = await activeSyncAccount(this.db);
            if (account) {
              const pending = await this.db.outbox
                .where('accountId')
                .equals(account)
                .filter((o) => o.entity === 'readday' && o.entityId === day)
                .count();
              if (!pending) return false; // already sent
            }
            const cur = await this.db.readDays.get(day);
            if (!cur) return false;
            const pagesLeft = { ...cur.pages };
            for (const p of added.pages) {
              const k = String(p);
              const span = pagesLeft[k];
              const mine = added.stamped[k];
              if (!span || !mine || span.join() !== mine.join()) continue;
              const before = added.prev[k];
              if (before) pagesLeft[k] = before;
              else delete pagesLeft[k];
            }
            const outboxDay = this.db.outbox
              .where('accountId')
              .equals(account ?? '')
              .filter((o) => o.entity === 'readday' && o.entityId === day);
            if (!Object.keys(pagesLeft).length && cur.rev == null) {
              await this.db.readDays.delete(day);
              if (account) await outboxDay.delete();
            } else {
              const row: ReadDay = { ...cur, pages: pagesLeft };
              await this.db.readDays.put(row);
              if (account) {
                await enqueueOutbox(
                  this.db,
                  account,
                  'readday',
                  day,
                  'upsert',
                  readDayPayload(row),
                  row.rev,
                );
              }
            }
            const rc = added.createdRound;
            if (rc) {
              const r = await this.db.rounds.get(rc.id);
              const anyRead =
                Object.keys(pagesLeft).length > 0 || (await this.db.readDays.count()) > 0;
              if (r && r.rev == null && !anyRead) {
                await this.db.rounds.delete(rc.id);
                if (account) {
                  await this.db.outbox
                    .where('accountId')
                    .equals(account)
                    .filter((o) => o.entity === 'khatam' && o.entityId === rc.id)
                    .delete();
                }
              }
            }
            return true;
          });
        }).catch(() => false);
      };
      return { added: added.pages.length, pages: added.pages, undo } satisfies MarkResult;
    }).catch((e: unknown) => (e instanceof MarkError ? { ...none, error: e.message } : none));
  }

  /**
   * Corrects a day: removes `pages` from the log of `day` (any past or present day). Stored as a
   * removal timestamp on the page entry, so it syncs and survives merging with other devices; a later
   * real read of the page re-adds it. Resolves with the pages actually removed (those that counted on
   * that day) and an `undo` valid for CLEAR_UNDO_WINDOW_MS.
   */
  unmarkDay(
    day: string,
    pages: readonly number[] | { from: number; to: number },
  ): Promise<UnmarkDayResult> {
    const list = expandPages(pages);
    const none: UnmarkDayResult = { removed: 0, pages: [], undo: () => Promise.resolve(false) };
    if (!list.length || !isDayString(day)) return Promise.resolve(none);
    return this.serial(async () => {
      const now = Date.now();
      const removedAt: Record<string, number> = {};
      const gone = await this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const cur = await this.db.readDays.get(day);
        if (!cur) return [] as number[];
        const mine = { ...cur.pages };
        const out: number[] = [];
        for (const p of list) {
          const k = String(p);
          const span = mine[k];
          if (!span || !spanActive(span)) continue;
          const at = Math.max(now, span[1]);
          mine[k] = [span[0], span[1], at];
          removedAt[k] = at;
          out.push(p);
        }
        if (out.length) {
          const row: ReadDay = { day, pages: mine, updatedAt: now, rev: cur.rev };
          await this.db.readDays.put(row);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'readday',
              day,
              'upsert',
              readDayPayload(row),
              row.rev,
            );
          }
        }
        return out;
      });
      const undo = (): Promise<boolean> =>
        this.serial(async () => {
          if (!gone.length || Date.now() - now > CLEAR_UNDO_WINDOW_MS) return false;
          return this.db.transaction('rw', this.tables, async () => {
            const account = await activeSyncAccount(this.db);
            const cur = await this.db.readDays.get(day);
            if (!cur) return false;
            const mine = { ...cur.pages };
            let n = 0;
            for (const p of gone) {
              const k = String(p);
              const span = mine[k];
              const r = removedAt[k];
              if (!span || r === undefined || span[2] !== r) continue; // changed since
              mine[k] = [span[0], Math.max(span[1], r + 1), r];
              n++;
            }
            if (!n) return false;
            const row: ReadDay = { day, pages: mine, updatedAt: Date.now(), rev: cur.rev };
            await this.db.readDays.put(row);
            if (account) {
              await enqueueOutbox(
                this.db,
                account,
                'readday',
                day,
                'upsert',
                readDayPayload(row),
                row.rev,
              );
            }
            return true;
          });
        }).catch(() => false);
      return { removed: gone.length, pages: gone, undo } satisfies UnmarkDayResult;
    }).catch(() => none);
  }

  /**
   * Moves pages from day `from` to day `to` (mark on B, then remove from A). Only pages that count
   * on `from` move. `to` follows the markRead day rules (30 days back, not in the future, round
   * start). Nothing is removed from `from` when the mark on `to` is refused (`error` set).
   */
  async moveDay(
    from: string,
    to: string,
    pages: readonly number[] | { from: number; to: number },
  ): Promise<MoveResult> {
    const none: MoveResult = { moved: 0, pages: [], undo: () => Promise.resolve(false) };
    if (!isDayString(from) || !isDayString(to)) return { ...none, error: 'Tanggal tidak valid.' };
    if (from === to) return { ...none, error: 'Pilih tanggal yang berbeda.' };
    const row = await this.db.readDays.get(from);
    const here = new Set(activePageNumbers(row?.pages ?? {}));
    const list = expandPages(pages).filter((p) => here.has(p));
    if (!list.length) return none;
    const marked = await this.markRead(list, { when: 'day', day: to });
    if (marked.error) return { ...none, error: marked.error };
    const removed = await this.unmarkDay(from, list);
    return {
      moved: removed.removed,
      pages: removed.pages,
      undo: async () => {
        const a = (await marked.undo()) || (await this.unmarkDay(to, marked.pages)).removed > 0;
        const b = await removed.undo();
        return a || b;
      },
    };
  }

  /** Removes manual marks (not tracked reads). Resolves with the number of marks removed. */
  unmarkRead(pages: readonly number[] | { from: number; to: number }): Promise<number> {
    const list = expandPages(pages);
    if (!list.length) return Promise.resolve(0);
    return this.serial(async () => {
      const now = Date.now();
      return this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const cur = await this.db.readMarks.get('marks');
        if (!cur) return 0;
        const marks = { ...cur.marks };
        let removed = 0;
        for (const p of list) {
          const old = marks[String(p)];
          if (!old || old[0] <= old[1]) continue;
          marks[String(p)] = [old[0], Math.max(now, old[0] + 1)];
          removed++;
        }
        if (removed) await this.putMarks(cur, marks, now, account);
        return removed;
      });
    }).catch(() => 0);
  }

  private readInRoundFrom(
    days: ReadDay[],
    marks: Record<string, [number, number]>,
    round: KhatamRound,
  ) {
    const out = readInRound(days, round);
    for (const p of markedInRound(marks, round)) out.add(p);
    return out;
  }

  private async putMarks(
    cur: ReadMarks | undefined,
    marks: Record<string, [number, number]>,
    now: number,
    account: string | null,
  ): Promise<void> {
    const row: ReadMarks = { key: 'marks', marks, updatedAt: now, rev: cur?.rev ?? null };
    await this.db.readMarks.put(row);
    if (account) {
      await enqueueOutbox(
        this.db,
        account,
        'readmark',
        'marks',
        'upsert',
        readMarksPayload(row),
        row.rev,
      );
    }
  }

  /**
   * Offers to mark pages 1..N as read, where N is the highest page the user's own bookmarks say
   * they finished: a page bookmark, or a verse bookmark on the last ayah of its page (the
   * "Akhir hal." badge). In round 1 every bookmark counts (bookmarks predate tracking); in later
   * rounds only bookmarks created since the round started. Null when there is nothing unread
   * below N.
   */
  suggestFromBookmarks(): { upTo: number; source: Bookmark; unread: number } | null {
    const round = this.currentRound();
    const read = this.readInRound();
    let best: Bookmark | null = null;
    for (const b of this.data.bookmarks()) {
      if (b.deletedAt != null || !isValidPage(b.page)) continue;
      if (round && round.n > 1 && b.createdAt < round.startedAt) continue;
      if (b.kind === 'verse' && !this.isPageEnd(b)) continue;
      if (!best || b.page > best.page) best = b;
    }
    if (!best) return null;
    let unread = 0;
    for (let p = 1; p <= best.page; p++) if (!read.has(p)) unread++;
    return unread ? { upTo: best.page, source: best, unread } : null;
  }

  private isPageEnd(b: Bookmark): boolean {
    if (b.surah == null || b.ayah == null || !this.content) return false;
    try {
      const last = this.content.pageMeta(b.page).last;
      return last.surah === b.surah && last.ayah === b.ayah;
    } catch {
      return false;
    }
  }

  // ---- settings ------------------------------------------------------------

  setEnabled(on: boolean): Promise<void> {
    return this.data.setPrefs({ trackProgress: on });
  }

  setDailyTarget(pages: number): Promise<void> {
    return this.data.setPrefs({ dailyTarget: clampDailyTarget(pages) });
  }

  // ---- clear history -------------------------------------------------------

  /**
   * "Hapus riwayat baca": removes the whole day log and all khatam rounds locally and (when signed
   * in) queues one `readday/all` delete that tombstones them in the cloud. Resolves with an undo
   * valid for CLEAR_UNDO_WINDOW_MS; it returns false when it is too late or the cloud clear was
   * already sent (then nothing is restored).
   */
  clearHistory(): Promise<() => Promise<boolean>> {
    return this.serial(async () => {
      const at = Date.now();
      const snap = await this.db.transaction('rw', this.tables, async () => {
        const days = await this.db.readDays.toArray();
        const rounds = await this.db.rounds.toArray();
        const marks = (await this.db.readMarks.get('marks')) ?? null;
        await this.db.readDays.clear();
        await this.db.rounds.clear();
        await this.db.readMarks.clear();
        const account = await activeSyncAccount(this.db);
        let opId: string | null = null;
        if (account) {
          const stale = await this.db.outbox
            .where('accountId')
            .equals(account)
            .filter(
              (o) => o.entity === 'readday' || o.entity === 'khatam' || o.entity === 'readmark',
            )
            .primaryKeys();
          await this.db.outbox.bulkDelete(stale);
          await enqueueOutbox(this.db, account, 'readday', 'all', 'delete', null, null);
          const op = await this.db.outbox
            .where('accountId')
            .equals(account)
            .filter((o) => o.entity === 'readday' && o.entityId === 'all')
            .first();
          opId = op?.opId ?? null;
        }
        return { days, rounds, marks, opId, account };
      });
      return () =>
        this.serial(async () => {
          if (Date.now() - at > CLEAR_UNDO_WINDOW_MS) return false;
          return this.db.transaction('rw', this.tables, async () => {
            if (snap.opId) {
              if (!(await this.db.outbox.get(snap.opId))) return false; // already sent
              await this.db.outbox.delete(snap.opId);
            }
            const account = snap.account ? await activeSyncAccount(this.db) : null;
            // Reads made since the clear stay; the restored history is merged underneath.
            const keepRoundIds = new Set(snap.rounds.map((r) => r.id));
            for (const r of await this.db.rounds.toArray()) {
              if (!keepRoundIds.has(r.id)) {
                await this.db.rounds.delete(r.id);
                if (account)
                  await this.db.outbox
                    .where('accountId')
                    .equals(account)
                    .filter((o) => o.entity === 'khatam' && o.entityId === r.id)
                    .delete();
              }
            }
            for (const r of snap.rounds) {
              await this.db.rounds.put(r);
              if (account)
                await enqueueOutbox(
                  this.db,
                  account,
                  'khatam',
                  r.id,
                  'upsert',
                  roundPayload(r),
                  r.rev,
                );
            }
            if (snap.marks) {
              const now = await this.db.readMarks.get('marks');
              const merged = mergeReadMarks(snap.marks.marks, now?.marks ?? {});
              const row: ReadMarks = { ...snap.marks, marks: merged, updatedAt: Date.now() };
              await this.db.readMarks.put(row);
              if (account) {
                await enqueueOutbox(
                  this.db,
                  account,
                  'readmark',
                  'marks',
                  'upsert',
                  readMarksPayload(row),
                  row.rev,
                );
              }
            }
            for (const d of snap.days) {
              const now = await this.db.readDays.get(d.day);
              const row: ReadDay = now
                ? {
                    ...d,
                    pages: mergeReadPages(d.pages, now.pages),
                    updatedAt: Math.max(d.updatedAt, now.updatedAt),
                  }
                : d;
              await this.db.readDays.put(row);
              if (account)
                await enqueueOutbox(
                  this.db,
                  account,
                  'readday',
                  d.day,
                  'upsert',
                  readDayPayload(row),
                  row.rev,
                );
            }
            return true;
          });
        }).catch(() => false);
    });
  }
}

function expandPages(pages: readonly number[] | { from: number; to: number }): number[] {
  const raw = Array.isArray(pages)
    ? (pages as number[])
    : (() => {
        const r = pages as { from: number; to: number };
        const out: number[] = [];
        for (let p = r.from; p <= r.to && out.length <= PAGE_COUNT; p++) out.push(p);
        return out;
      })();
  return [...new Set(raw)].filter(isValidPage);
}

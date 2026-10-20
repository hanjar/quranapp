import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { liveQuery } from 'dexie';
import { UserDataApi } from '../contracts';
import {
  KhatamRound,
  PAGE_COUNT,
  ReadDay,
  clampDailyTarget,
  isValidPage,
  mergeReadPages,
  uuid,
} from '../models';
import { MushafDb } from '../storage/db';
import { MUSHAF_DB } from '../storage/db-token';
import { activeSyncAccount, enqueueOutbox } from '../storage/outbox';
import { readDayPayload, roundPayload } from '../sync/outbox';
import { PageDwellTracker } from './page-dwell-tracker';
import {
  DayCount,
  JuzProgress,
  READ_MIN_MS,
  RecentPage,
  averagePerDay,
  etaDate,
  firstUnreadPage,
  juzProgress,
  juzRange,
  lastDays,
  localDay,
  mergeSpan,
  pickCurrentRound,
  readInRound,
  recentPages,
} from './progress-logic';

/** Window in which the undo returned by clearHistory() is honoured. */
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
  private readonly destroyRef = inject(DestroyRef);
  /** Aborts document listeners and stops trackers when the injector is destroyed. */
  private readonly listeners = new AbortController();
  private readonly trackers = new Set<PageDwellTracker>();

  private readonly _days = signal<ReadDay[]>([]);
  private readonly _rounds = signal<KhatamRound[]>([]);
  private readonly _ready = signal(false);
  private readonly _now = signal(Date.now());

  /** True after the first read from IndexedDB. */
  readonly ready = this._ready.asReadonly();
  /** Reading days, oldest first. Each page maps to `[firstAt, lastAt]`. */
  readonly days = this._days.asReadonly();
  /** All khatam rounds, ascending by number. */
  readonly rounds = this._rounds.asReadonly();
  /** Open round (latest unfinished), or null before the first recorded read. */
  readonly currentRound = computed(() => pickCurrentRound(this._rounds()));
  /** Pages read in the open round. */
  readonly readInRound = computed<ReadonlySet<number>>(() =>
    readInRound(this._days(), this.currentRound()),
  );
  /** Open-round completion, 0-100 with one decimal. */
  readonly percent = computed(() => Math.round((this.readInRound().size / PAGE_COUNT) * 1000) / 10);
  /** True when every page of the open round has been read (UI offers startNextRound()). */
  readonly roundComplete = computed(() => this.readInRound().size >= PAGE_COUNT);
  /** Distinct pages read today (device-local day). */
  readonly todayCount = computed(() => {
    const today = localDay(this._now());
    const row = this._days().find((d) => d.day === today);
    return row ? Object.keys(row.pages).length : 0;
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
    })).subscribe({
      next: ({ days, rounds }) => {
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
    return [this.db.readDays, this.db.rounds, this.db.outbox, this.db.sync];
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
   * No-op when tracking is off, the page is invalid or `ms` < READ_MIN_MS.
   * Creates khatam round 1 on the very first read. Never rejects on storage errors.
   */
  recordView(page: number, ms: number, at: number = Date.now()): Promise<void> {
    if (!this.enabled() || !isValidPage(page) || !(ms >= READ_MIN_MS)) return Promise.resolve();
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
        await this.db.readDays.clear();
        await this.db.rounds.clear();
        const account = await activeSyncAccount(this.db);
        let opId: string | null = null;
        if (account) {
          const stale = await this.db.outbox
            .where('accountId')
            .equals(account)
            .filter((o) => o.entity === 'readday' || o.entity === 'khatam')
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
        return { days, rounds, opId, account };
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

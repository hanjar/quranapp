import { TestBed } from '@angular/core/testing';
import { ContentApi, UserDataApi } from '../contracts';
import { PAGE_COUNT } from '../models';
import { MushafDb } from '../storage/db';
import { MUSHAF_DB } from '../storage/db-token';
import { installFakeIndexedDb } from '../storage/testing';
import { UserDataService } from '../storage/user-data.service';
import { addDays, dayNoon, localDay, READ_DWELL_MS } from './progress-logic';
import { ProgressService } from './progress.service';

installFakeIndexedDb();

const AT = new Date(2026, 9, 20, 10, 0, 0).getTime();

describe('ProgressService', () => {
  let db: MushafDb;
  let svc: ProgressService;
  let data: UserDataService;

  const create = async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MUSHAF_DB, useValue: db },
        { provide: UserDataApi, useExisting: UserDataService },
        {
          provide: ContentApi,
          useValue: { pageMeta: (page: number) => ({ last: { surah: 2, ayah: page } }) },
        },
      ],
    });
    data = TestBed.inject(UserDataService);
    await data.init();
    svc = TestBed.inject(ProgressService);
    await vi.waitFor(() => expect(svc.ready()).toBe(true));
  };
  const enableSync = () =>
    db.sync.put({
      key: 'state',
      enabled: true,
      accountId: 'acc1',
      cursor: 0,
      lastSuccessAt: null,
      status: 'idle',
      lastErrorCode: null,
    });
  const settle = async () => {
    await svc.idle();
    await vi.waitFor(async () => {
      // liveQuery caught up with Dexie
      expect(svc.days().length).toBe(await db.readDays.count());
      expect(svc.rounds().length).toBe(await db.rounds.count());
    });
  };

  beforeEach(async () => {
    db = new MushafDb('test-' + Math.random());
    await create();
  });
  afterEach(async () => {
    await svc.idle();
    await data.idle();
    vi.useRealTimers();
  });

  it('starts empty with 30 juz rows', () => {
    expect(svc.days()).toEqual([]);
    expect(svc.currentRound()).toBeNull();
    expect(svc.percent()).toBe(0);
    expect(svc.juzProgress()).toHaveLength(30);
    expect(svc.last7()).toHaveLength(7);
    expect(svc.eta()).toBeNull();
    expect(svc.enabled()).toBe(true);
    expect(svc.dailyTarget()).toBe(5);
    expect(svc.firstUnread()).toBe(1);
    expect(svc.recent(5)).toEqual([]);
  });

  it('records a view: day row, span, round 1 starting at the first view, derived signals', async () => {
    await svc.recordView(7, READ_DWELL_MS, AT);
    await settle();
    const row = svc.days()[0]!;
    expect(row.day).toBe(localDay(AT));
    expect(row.pages['7']).toEqual([AT - READ_DWELL_MS, AT]);
    expect(svc.currentRound()).toMatchObject({
      n: 1,
      startedAt: AT - READ_DWELL_MS,
      finishedAt: null,
    });
    expect([...svc.readInRound()]).toEqual([7]);
    expect(svc.percent()).toBeCloseTo((1 / PAGE_COUNT) * 100, 0);
    expect(svc.firstUnread()).toBe(1);
    expect(svc.firstUnreadInJuz(1)).toBe(1);
    expect(svc.firstUnreadInJuz(31)).toBeNull();
    expect(svc.recent(3)).toEqual([{ page: 7, lastAt: AT, day: localDay(AT) }]);
  });

  it('merging a repeat view of the same page widens its span and never duplicates the round', async () => {
    await svc.recordView(7, READ_DWELL_MS, AT);
    await svc.recordView(7, READ_DWELL_MS, AT + 60_000);
    await svc.recordView(8, READ_DWELL_MS, AT + 90_000);
    await settle();
    expect(svc.days()).toHaveLength(1);
    expect(svc.days()[0]!.pages['7']).toEqual([AT - READ_DWELL_MS, AT + 60_000]);
    expect(svc.rounds()).toHaveLength(1);
    expect(svc.recent(5).map((r) => r.page)).toEqual([8, 7]);
  });

  it('todayCount and last7 follow the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    svc.refreshToday();
    await svc.recordView(1, READ_DWELL_MS, AT);
    await svc.recordView(2, READ_DWELL_MS, AT);
    await svc.recordView(3, READ_DWELL_MS, AT - 86_400_000);
    await settle();
    expect(svc.todayCount()).toBe(2);
    const l7 = svc.last7();
    expect(l7[6]!.count).toBe(2);
    expect(l7[5]!.count).toBe(1);
    vi.setSystemTime(AT + 86_400_000);
    svc.refreshToday();
    expect(svc.todayCount()).toBe(0);
  });

  it('ignores short views, invalid pages, and everything when tracking is off', async () => {
    await svc.recordView(7, READ_DWELL_MS - 1, AT);
    await svc.recordView(0, READ_DWELL_MS, AT);
    await svc.recordView(605, READ_DWELL_MS, AT);
    await svc.recordView(1.5, READ_DWELL_MS, AT);
    await settle();
    expect(svc.days()).toEqual([]);
    await svc.setEnabled(false);
    expect(svc.enabled()).toBe(false);
    await svc.recordView(7, READ_DWELL_MS, AT);
    await settle();
    expect(svc.days()).toEqual([]);
    expect(svc.rounds()).toEqual([]);
  });

  it('setDailyTarget clamps to 1-40 and persists in synced prefs', async () => {
    await svc.setDailyTarget(12);
    expect(svc.dailyTarget()).toBe(12);
    await svc.setDailyTarget(500);
    expect(svc.dailyTarget()).toBe(40);
    await svc.setDailyTarget(-3);
    expect(svc.dailyTarget()).toBe(1);
    await enableSync();
    await svc.setDailyTarget(9);
    const op = (await db.outbox.toArray()).find((o) => o.entity === 'prefs');
    expect(op?.payload).toMatchObject({ dailyTarget: 9, trackProgress: true });
  });

  it('queues coalesced readday + khatam ops only when sync is enabled', async () => {
    await svc.recordView(7, READ_DWELL_MS, AT);
    await svc.idle();
    expect(await db.outbox.count()).toBe(0);
    await enableSync();
    await svc.recordView(8, READ_DWELL_MS, AT + 1000);
    await svc.recordView(9, READ_DWELL_MS, AT + 2000);
    await svc.idle();
    const ops = await db.outbox.toArray();
    expect(ops.filter((o) => o.entity === 'readday')).toHaveLength(1); // coalesced per day
    const payload = ops.find((o) => o.entity === 'readday')!.payload as {
      pages: Record<string, unknown>;
    };
    expect(Object.keys(payload.pages).sort()).toEqual(['7', '8', '9']); // full day, not just the delta
    expect(ops.filter((o) => o.entity === 'khatam')).toHaveLength(0); // round 1 already existed
    expect(ops.every((o) => o.accountId === 'acc1')).toBe(true);
  });

  it('first synced read enqueues round 1 too', async () => {
    await enableSync();
    await svc.recordView(7, READ_DWELL_MS, AT);
    await svc.idle();
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.entity).sort()).toEqual(['khatam', 'readday']);
    expect(ops.find((o) => o.entity === 'khatam')).toMatchObject({
      action: 'upsert',
      baseRev: null,
    });
  });

  it('startNextRound finishes the open round and a new one counts from zero', async () => {
    expect(await svc.startNextRound()).toBeNull();
    await svc.recordView(7, READ_DWELL_MS, AT);
    await settle();
    const next = await svc.startNextRound();
    expect(next).toMatchObject({ n: 2, finishedAt: null });
    await settle();
    expect(svc.rounds().map((r) => [r.n, r.finishedAt != null])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(svc.currentRound()?.n).toBe(2);
    expect(svc.readInRound().size).toBe(0);
    expect(svc.recent(5).map((r) => r.page)).toEqual([7]); // history is kept
    await svc.recordView(8, READ_DWELL_MS, Date.now() + 5000);
    await settle();
    expect([...svc.readInRound()]).toEqual([8]);
  });

  it('roundComplete once every page of the open round is read', async () => {
    const pages: Record<string, [number, number]> = {};
    for (let p = 1; p <= PAGE_COUNT; p++) pages[String(p)] = [AT, AT + 1];
    await db.readDays.put({ day: localDay(AT), pages, updatedAt: AT, rev: null });
    await db.rounds.put({
      id: 'r1',
      n: 1,
      startedAt: AT,
      finishedAt: null,
      updatedAt: AT,
      rev: null,
    });
    await settle();
    expect(svc.roundComplete()).toBe(true);
    expect(svc.percent()).toBe(100);
    expect(svc.firstUnread()).toBeNull();
    expect(svc.eta()).toBeNull();
  });

  describe('clearHistory', () => {
    it('wipes local data and (synced) replaces pending progress ops with one readday/all delete', async () => {
      await enableSync();
      await svc.recordView(7, READ_DWELL_MS, AT);
      await svc.clearHistory();
      await settle();
      expect(svc.days()).toEqual([]);
      expect(svc.rounds()).toEqual([]);
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ entity: 'readday', entityId: 'all', action: 'delete' });
      // a fresh read after clearing starts round 1 again
      await svc.recordView(9, READ_DWELL_MS, Date.now());
      await settle();
      expect(svc.currentRound()?.n).toBe(1);
    });

    it('undo restores everything and cancels the cloud clear while it is unsent', async () => {
      await enableSync();
      await svc.recordView(7, READ_DWELL_MS, AT);
      await svc.startNextRound();
      const undo = await svc.clearHistory();
      await settle();
      expect(await undo()).toBe(true);
      await settle();
      expect(svc.days()[0]!.pages['7']).toBeDefined();
      expect(svc.rounds().map((r) => r.n)).toEqual([1, 2]);
      const ops = await db.outbox.toArray();
      expect(ops.some((o) => o.entityId === 'all')).toBe(false);
      expect(ops.filter((o) => o.entity === 'khatam')).toHaveLength(2);
      expect(ops.some((o) => o.entity === 'readday' && o.entityId === localDay(AT))).toBe(true);
    });

    it('undo is refused once the clear op was sent', async () => {
      await enableSync();
      await svc.recordView(7, READ_DWELL_MS, AT);
      const undo = await svc.clearHistory();
      await db.outbox.clear(); // the sync cycle sent it
      expect(await undo()).toBe(false);
      await settle();
      expect(svc.days()).toEqual([]);
    });

    it('undo is refused after the window; guests can undo without any outbox', async () => {
      await svc.recordView(7, READ_DWELL_MS, AT);
      await settle();
      vi.useFakeTimers({ toFake: ['Date'] });
      const undo = await svc.clearHistory();
      vi.setSystemTime(Date.now() + 9000);
      expect(await undo()).toBe(false);
      vi.useRealTimers();
      await svc.recordView(7, READ_DWELL_MS, AT);
      const undo2 = await svc.clearHistory();
      expect(await undo2()).toBe(true);
      await settle();
      expect(svc.days()).toHaveLength(1);
      expect(await db.outbox.count()).toBe(0);
    });

    it('undo merges reads made after the clear into the restored history', async () => {
      await svc.recordView(7, READ_DWELL_MS, AT);
      const undo = await svc.clearHistory();
      await svc.recordView(8, READ_DWELL_MS, AT + 5000);
      expect(await undo()).toBe(true);
      await settle();
      expect(Object.keys(svc.days()[0]!.pages).sort()).toEqual(['7', '8']);
      expect(svc.rounds()).toHaveLength(1);
      expect(svc.rounds()[0]!.n).toBe(1);
    });
  });

  describe('manual marks', () => {
    it("'before' marks count for the round but not for daily stats, creating round 1 if needed", async () => {
      const r = await svc.markRead({ from: 533, to: 540 }, { when: 'before' });
      expect(r.added).toBe(8);
      await settle();
      expect(svc.currentRound()).toMatchObject({ n: 1 });
      expect(svc.readInRound().size).toBe(8);
      expect(svc.markedPages().size).toBe(8);
      expect(svc.percent()).toBeCloseTo((8 / PAGE_COUNT) * 100, 0);
      expect(svc.days()).toEqual([]);
      expect(svc.todayCount()).toBe(0);
      expect(svc.last7().every((d) => d.count === 0)).toBe(true);
      expect(svc.eta()).toBeNull();
      expect(svc.recent(5)).toEqual([]);
      expect(svc.juzProgress()[26]!.read).toBeGreaterThan(0);
      expect(svc.firstUnread()).toBe(1);
    });

    it('default is before; skips pages already read or marked; invalid pages ignored', async () => {
      await svc.recordView(534, READ_DWELL_MS, Date.now());
      await settle();
      expect((await svc.markRead([533, 534, 535, 535, 0, 700])).pages).toEqual([533, 535]);
      expect((await svc.markRead([533, 535])).added).toBe(0);
      expect((await svc.markRead([])).added).toBe(0);
    });

    it("'today' writes into today's day: counts for daily stats and the round", async () => {
      const r = await svc.markRead([519, 520, 521], { when: 'today' });
      expect(r.pages).toEqual([519, 520, 521]);
      await settle();
      expect(svc.todayCount()).toBe(3);
      expect(svc.last7()[6]!.count).toBe(3);
      expect(svc.readInRound().size).toBe(3);
      expect(svc.markedPages().size).toBe(0);
      expect((await svc.markRead([519, 522], { when: 'today' })).pages).toEqual([522]);
    });

    it("'today' also covers pages that were only marked before", async () => {
      await svc.markRead([10], { when: 'before' });
      expect((await svc.markRead([10], { when: 'today' })).added).toBe(1);
      await settle();
      expect(svc.todayCount()).toBe(1);
    });

    it('undo of before-marks and unmarkRead remove marks; a re-mark works afterwards', async () => {
      const r = await svc.markRead([1, 2, 3]);
      expect(await r.undo()).toBe(true);
      await settle();
      expect(svc.readInRound().size).toBe(0);
      await svc.markRead([4, 5]);
      expect(await svc.unmarkRead({ from: 4, to: 9 })).toBe(2);
      expect(await svc.unmarkRead([4])).toBe(0);
      expect((await svc.markRead([4])).added).toBe(1);
      await settle();
      expect([...svc.readInRound()]).toEqual([4]);
    });

    it('undo of today-marks removes only those pages, and the round it created', async () => {
      const r = await svc.markRead([519, 520], { when: 'today' });
      expect(await r.undo()).toBe(true);
      await settle();
      expect(svc.days()).toEqual([]);
      expect(svc.rounds()).toEqual([]);
    });

    it('undo of today-marks is refused after the day op was sent', async () => {
      await enableSync();
      const r = await svc.markRead([519], { when: 'today' });
      await db.outbox.clear();
      expect(await r.undo()).toBe(false);
    });

    describe('choose the day / correct a day', () => {
      const today = () => localDay(Date.now());
      const yesterday = () => addDays(today(), -1);

      it("'day' stamps the chosen day at 12:00 and counts for that bar, last7 and the round", async () => {
        await svc.recordView(1, READ_DWELL_MS, Date.now() - 5 * 86_400_000); // round 1 started 5 days ago
        const y = yesterday();
        const r = await svc.markRead({ from: 519, to: 521 }, { when: 'day', day: y });
        expect(r.error).toBeUndefined();
        expect(r.pages).toEqual([519, 520, 521]);
        await settle();
        expect((await db.readDays.get(y))?.pages['519']).toEqual([dayNoon(y), dayNoon(y)]);
        expect(svc.last7()[5]).toEqual({ day: y, count: 3 });
        expect(svc.todayCount()).toBe(0);
        expect(svc.readInRound().has(520)).toBe(true);
        // pages already counted that day are skipped
        expect((await svc.markRead([519, 522], { when: 'day', day: y })).pages).toEqual([522]);
      });

      it("'day' with today's date behaves like 'today' (timestamp = now)", async () => {
        const r = await svc.markRead([7], { when: 'day', day: today() });
        expect(r.added).toBe(1);
        const span = (await db.readDays.get(today()))?.pages['7'];
        expect(Math.abs(span![0] - Date.now())).toBeLessThan(5000);
      });

      it('rejects the future, more than 30 days back and malformed days without writing', async () => {
        for (const day of [
          addDays(today(), 1),
          addDays(today(), -31),
          '2026-02-30',
          'kemarin',
          undefined,
        ]) {
          const r = await svc.markRead([5], { when: 'day', day: day as string });
          expect(r.added).toBe(0);
          expect(r.error).toBeTruthy();
        }
        expect(await db.readDays.count()).toBe(0);
        expect(await db.rounds.count()).toBe(0);
        expect((await svc.markRead([5], { when: 'day', day: addDays(today(), -30) })).added).toBe(
          1,
        );
      });

      it('moves round 1 start back for an earlier day, refuses it for a later round', async () => {
        await svc.markRead([1], { when: 'today' });
        const d = addDays(today(), -3);
        const r = await svc.markRead([2], { when: 'day', day: d });
        expect(r.added).toBe(1);
        await settle();
        expect(svc.currentRound()?.startedAt).toBe(dayNoon(d));
        expect(svc.readInRound().has(2)).toBe(true);

        await svc.startNextRound();
        const bad = await svc.markRead([3], { when: 'day', day: d });
        expect(bad.added).toBe(0);
        expect(bad.error).toContain('khatam ke-2');
        expect((await db.readDays.get(d))?.pages['3']).toBeUndefined();
      });

      it('a first mark on an earlier day creates round 1 starting then', async () => {
        const d = addDays(today(), -2);
        await svc.markRead([4], { when: 'day', day: d });
        await settle();
        expect(svc.currentRound()?.startedAt).toBe(dayNoon(d));
        expect(svc.readInRound().has(4)).toBe(true);
      });

      it('unmarkDay removes pages from one day only, keeps the entry and updates stats', async () => {
        const y = yesterday();
        await svc.markRead({ from: 519, to: 536 }, { when: 'today' });
        await svc.markRead([519], { when: 'day', day: y });
        await settle();
        const r = await svc.unmarkDay(today(), { from: 519, to: 530 });
        expect(r.removed).toBe(12);
        await settle();
        expect(svc.todayCount()).toBe(6);
        expect(svc.last7()[5]!.count).toBe(1);
        expect(svc.readInRound().has(519)).toBe(true); // still read yesterday
        expect(svc.readInRound().has(520)).toBe(false);
        const span = (await db.readDays.get(today()))!.pages['520']!;
        expect(span).toHaveLength(3);
        expect(span[2]).toBeGreaterThanOrEqual(span[1]);
        expect((await svc.unmarkDay(today(), [520])).removed).toBe(0); // already removed
        expect(svc.recent(50).some((p) => p.page === 520)).toBe(false);
      });

      it('unmarkDay undo restores, and a later read or mark re-adds a removed page', async () => {
        await svc.markRead([10, 11], { when: 'today' });
        const r = await svc.unmarkDay(today(), [10, 11]);
        await settle();
        expect(svc.todayCount()).toBe(0);
        expect(await r.undo()).toBe(true);
        await settle();
        expect(svc.todayCount()).toBe(2);
        await svc.unmarkDay(today(), [10]);
        await svc.recordView(10, READ_DWELL_MS, Date.now() + 1000);
        await settle();
        expect(svc.todayCount()).toBe(2);
        await svc.unmarkDay(today(), [11]);
        expect((await svc.markRead([11], { when: 'today' })).pages).toEqual([11]);
        await settle();
        expect(svc.todayCount()).toBe(2);
      });

      it('remarking a removed page on a past day re-adds it even though noon < removedAt', async () => {
        const y = yesterday();
        await svc.markRead([30], { when: 'day', day: y });
        await svc.unmarkDay(y, [30]);
        await settle();
        expect(svc.last7()[5]!.count).toBe(0);
        expect((await svc.markRead([30], { when: 'day', day: y })).pages).toEqual([30]);
        await settle();
        expect(svc.last7()[5]!.count).toBe(1);
      });

      it('moveDay: owner case, pages marked today go to yesterday and stats follow', async () => {
        await svc.markRead({ from: 519, to: 536 }, { when: 'today' });
        const tue = yesterday();
        const r = await svc.moveDay(today(), tue, { from: 519, to: 536 });
        expect(r.error).toBeUndefined();
        expect(r.moved).toBe(18);
        await settle();
        expect(svc.todayCount()).toBe(0);
        expect(svc.last7()[5]!.count).toBe(18);
        expect(svc.readInRound().size).toBe(18);
        expect(await r.undo()).toBe(true);
        await settle();
        expect(svc.todayCount()).toBe(18);
        expect(svc.last7()[5]!.count).toBe(0);
      });

      it('moveDay refuses same day / bad target and leaves the source intact', async () => {
        await svc.markRead([40, 41], { when: 'today' });
        expect((await svc.moveDay(today(), today(), [40])).error).toBeTruthy();
        expect((await svc.moveDay(today(), addDays(today(), 1), [40])).error).toBeTruthy();
        expect((await svc.moveDay(today(), addDays(today(), -40), [40])).error).toBeTruthy();
        expect((await svc.moveDay(today(), yesterday(), [99])).moved).toBe(0); // not on that day
        await settle();
        expect(svc.todayCount()).toBe(2);
      });

      it('queues the day with removedAt and the moved-back round when synced', async () => {
        await enableSync();
        await svc.markRead([1], { when: 'today' });
        await db.outbox.clear();
        await svc.moveDay(today(), addDays(today(), -2), [1]);
        const ops = await db.outbox.toArray();
        expect(ops.filter((o) => o.entity === 'readday')).toHaveLength(2); // one per day (coalesced)
        expect(ops.some((o) => o.entity === 'khatam')).toBe(true);
        const src = ops.find((o) => o.entity === 'readday' && o.entityId === today())!;
        expect((src.payload as any).pages['1']).toHaveLength(3);
      });
    });

    it('queues one coalesced readmark op when synced, with the whole map', async () => {
      await enableSync();
      await svc.markRead([1, 2]);
      await svc.markRead([3]);
      const ops = (await db.outbox.toArray()).filter((o) => o.entity === 'readmark');
      expect(ops).toHaveLength(1);
      expect(Object.keys((ops[0]!.payload as { marks: object }).marks)).toEqual(['1', '2', '3']);
    });

    it('a new round ignores older marks', async () => {
      await svc.markRead([1, 2, 3]);
      await settle();
      await new Promise((r) => setTimeout(r, 5));
      await svc.startNextRound();
      await settle();
      expect(svc.readInRound().size).toBe(0);
    });

    it('clearHistory wipes marks and undo restores them', async () => {
      await enableSync();
      await svc.markRead([1, 2, 3]);
      const undo = await svc.clearHistory();
      await settle();
      expect(svc.markedPages().size).toBe(0);
      expect((await db.outbox.toArray()).map((o) => o.entity)).toEqual(['readday']);
      expect(await undo()).toBe(true);
      await settle();
      expect(svc.markedPages().size).toBe(3);
      expect((await db.outbox.toArray()).some((o) => o.entity === 'readmark')).toBe(true);
    });
  });

  describe('suggestFromBookmarks', () => {
    it('null without usable bookmarks', async () => {
      expect(svc.suggestFromBookmarks()).toBeNull();
      await data.toggleVerseBookmark({ surah: 2, ayah: 3 }, 50); // mid-page (last ayah of p50 is 50)
      expect(svc.suggestFromBookmarks()).toBeNull();
    });

    it('offers 1..N from the highest page bookmark or end-of-page verse bookmark', async () => {
      await data.togglePageBookmark(40);
      await data.toggleVerseBookmark({ surah: 2, ayah: 90 }, 90); // end of page 90
      await data.toggleVerseBookmark({ surah: 2, ayah: 1 }, 300); // mid-page: ignored
      const s = svc.suggestFromBookmarks();
      expect(s?.upTo).toBe(90);
      expect(s?.source.page).toBe(90);
      expect(s?.unread).toBe(90);
      await svc.markRead({ from: 1, to: 90 });
      await vi.waitFor(() => expect(svc.suggestFromBookmarks()).toBeNull());
    });

    it('counts only still-unread pages and, after round 1, only newer bookmarks', async () => {
      await data.togglePageBookmark(10);
      await svc.markRead({ from: 1, to: 4 });
      await vi.waitFor(() => expect(svc.suggestFromBookmarks()?.unread).toBe(6));
      await new Promise((r) => setTimeout(r, 5));
      await svc.startNextRound();
      await vi.waitFor(() => expect(svc.currentRound()?.n).toBe(2));
      expect(svc.suggestFromBookmarks()).toBeNull(); // bookmark predates round 2
      await new Promise((r) => setTimeout(r, 5));
      await data.togglePageBookmark(20);
      await vi.waitFor(() => expect(svc.suggestFromBookmarks()?.upTo).toBe(20));
    });
  });

  it('createTracker wires dwell reads into recordView', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(AT);
    const tracker = svc.createTracker();
    tracker.visible([12]);
    await vi.advanceTimersByTimeAsync(READ_DWELL_MS);
    vi.useRealTimers();
    await settle();
    expect(svc.days()[0]?.pages['12']).toBeDefined();
    tracker.dispose();
  });
});

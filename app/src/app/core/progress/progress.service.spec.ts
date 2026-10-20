import { TestBed } from '@angular/core/testing';
import { UserDataApi } from '../contracts';
import { PAGE_COUNT } from '../models';
import { MushafDb } from '../storage/db';
import { MUSHAF_DB } from '../storage/db-token';
import { installFakeIndexedDb } from '../storage/testing';
import { UserDataService } from '../storage/user-data.service';
import { localDay } from './progress-logic';
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
    await svc.recordView(7, 25_000, AT);
    await settle();
    const row = svc.days()[0]!;
    expect(row.day).toBe(localDay(AT));
    expect(row.pages['7']).toEqual([AT - 25_000, AT]);
    expect(svc.currentRound()).toMatchObject({ n: 1, startedAt: AT - 25_000, finishedAt: null });
    expect([...svc.readInRound()]).toEqual([7]);
    expect(svc.percent()).toBeCloseTo((1 / PAGE_COUNT) * 100, 0);
    expect(svc.firstUnread()).toBe(1);
    expect(svc.firstUnreadInJuz(1)).toBe(1);
    expect(svc.firstUnreadInJuz(31)).toBeNull();
    expect(svc.recent(3)).toEqual([{ page: 7, lastAt: AT, day: localDay(AT) }]);
  });

  it('merging a repeat view of the same page widens its span and never duplicates the round', async () => {
    await svc.recordView(7, 10_000, AT);
    await svc.recordView(7, 10_000, AT + 60_000);
    await svc.recordView(8, 10_000, AT + 90_000);
    await settle();
    expect(svc.days()).toHaveLength(1);
    expect(svc.days()[0]!.pages['7']).toEqual([AT - 10_000, AT + 60_000]);
    expect(svc.rounds()).toHaveLength(1);
    expect(svc.recent(5).map((r) => r.page)).toEqual([8, 7]);
  });

  it('todayCount and last7 follow the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    svc.refreshToday();
    await svc.recordView(1, 10_000, AT);
    await svc.recordView(2, 10_000, AT);
    await svc.recordView(3, 10_000, AT - 86_400_000);
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
    await svc.recordView(7, 7_999, AT);
    await svc.recordView(0, 20_000, AT);
    await svc.recordView(605, 20_000, AT);
    await svc.recordView(1.5, 20_000, AT);
    await settle();
    expect(svc.days()).toEqual([]);
    await svc.setEnabled(false);
    expect(svc.enabled()).toBe(false);
    await svc.recordView(7, 25_000, AT);
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
    await svc.recordView(7, 10_000, AT);
    await svc.idle();
    expect(await db.outbox.count()).toBe(0);
    await enableSync();
    await svc.recordView(8, 10_000, AT + 1000);
    await svc.recordView(9, 10_000, AT + 2000);
    await svc.idle();
    const ops = await db.outbox.toArray();
    expect(ops.filter((o) => o.entity === 'readday')).toHaveLength(1); // coalesced per day
    const payload = ops.find((o) => o.entity === 'readday')!.payload as { pages: Record<string, unknown> };
    expect(Object.keys(payload.pages).sort()).toEqual(['7', '8', '9']); // full day, not just the delta
    expect(ops.filter((o) => o.entity === 'khatam')).toHaveLength(0); // round 1 already existed
    expect(ops.every((o) => o.accountId === 'acc1')).toBe(true);
  });

  it('first synced read enqueues round 1 too', async () => {
    await enableSync();
    await svc.recordView(7, 10_000, AT);
    await svc.idle();
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.entity).sort()).toEqual(['khatam', 'readday']);
    expect(ops.find((o) => o.entity === 'khatam')).toMatchObject({ action: 'upsert', baseRev: null });
  });

  it('startNextRound finishes the open round and a new one counts from zero', async () => {
    expect(await svc.startNextRound()).toBeNull();
    await svc.recordView(7, 10_000, AT);
    await settle();
    const next = await svc.startNextRound();
    expect(next).toMatchObject({ n: 2, finishedAt: null });
    await settle();
    expect(svc.rounds().map((r) => [r.n, r.finishedAt != null])).toEqual([[1, true], [2, false]]);
    expect(svc.currentRound()?.n).toBe(2);
    expect(svc.readInRound().size).toBe(0);
    expect(svc.recent(5).map((r) => r.page)).toEqual([7]); // history is kept
    await svc.recordView(8, 10_000, Date.now() + 5000);
    await settle();
    expect([...svc.readInRound()]).toEqual([8]);
  });

  it('roundComplete once every page of the open round is read', async () => {
    const pages: Record<string, [number, number]> = {};
    for (let p = 1; p <= PAGE_COUNT; p++) pages[String(p)] = [AT, AT + 1];
    await db.readDays.put({ day: localDay(AT), pages, updatedAt: AT, rev: null });
    await db.rounds.put({ id: 'r1', n: 1, startedAt: AT, finishedAt: null, updatedAt: AT, rev: null });
    await settle();
    expect(svc.roundComplete()).toBe(true);
    expect(svc.percent()).toBe(100);
    expect(svc.firstUnread()).toBeNull();
    expect(svc.eta()).toBeNull();
  });

  describe('clearHistory', () => {
    it('wipes local data and (synced) replaces pending progress ops with one readday/all delete', async () => {
      await enableSync();
      await svc.recordView(7, 10_000, AT);
      await svc.clearHistory();
      await settle();
      expect(svc.days()).toEqual([]);
      expect(svc.rounds()).toEqual([]);
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ entity: 'readday', entityId: 'all', action: 'delete' });
      // a fresh read after clearing starts round 1 again
      await svc.recordView(9, 10_000, Date.now());
      await settle();
      expect(svc.currentRound()?.n).toBe(1);
    });

    it('undo restores everything and cancels the cloud clear while it is unsent', async () => {
      await enableSync();
      await svc.recordView(7, 10_000, AT);
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
      await svc.recordView(7, 10_000, AT);
      const undo = await svc.clearHistory();
      await db.outbox.clear(); // the sync cycle sent it
      expect(await undo()).toBe(false);
      await settle();
      expect(svc.days()).toEqual([]);
    });

    it('undo is refused after the window; guests can undo without any outbox', async () => {
      await svc.recordView(7, 10_000, AT);
      await settle();
      vi.useFakeTimers({ toFake: ['Date'] });
      const undo = await svc.clearHistory();
      vi.setSystemTime(Date.now() + 9000);
      expect(await undo()).toBe(false);
      vi.useRealTimers();
      await svc.recordView(7, 10_000, AT);
      const undo2 = await svc.clearHistory();
      expect(await undo2()).toBe(true);
      await settle();
      expect(svc.days()).toHaveLength(1);
      expect(await db.outbox.count()).toBe(0);
    });

    it('undo merges reads made after the clear into the restored history', async () => {
      await svc.recordView(7, 10_000, AT);
      const undo = await svc.clearHistory();
      await svc.recordView(8, 10_000, AT + 5000);
      expect(await undo()).toBe(true);
      await settle();
      expect(Object.keys(svc.days()[0]!.pages).sort()).toEqual(['7', '8']);
      expect(svc.rounds()).toHaveLength(1);
      expect(svc.rounds()[0]!.n).toBe(1);
    });
  });

  it('createTracker wires dwell reads into recordView', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(AT);
    const tracker = svc.createTracker();
    tracker.visible([12]);
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    await settle();
    expect(svc.days()[0]?.pages['12']).toBeDefined();
    tracker.dispose();
  });
});

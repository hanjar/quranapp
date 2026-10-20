import { installFakeIndexedDb } from '../storage/testing';
import { KhatamRound, ReadDay } from '../models';
import { MushafDb } from '../storage/db';
import { applyChanges, handleResults, reconcileReset } from './apply';
import { enqueueLocalSnapshot, makeOp, readDayPayload, roundPayload } from './outbox';
import { Change } from './sync-types';

installFakeIndexedDb();

const ACC = 'acc-1';
const opts = (o = {}) => ({ localDeviceId: 'dev', detectPositionConflict: false, ...o });

const day = (d: string, pages: ReadDay['pages'], over: Partial<ReadDay> = {}): ReadDay => ({
  day: d,
  pages,
  updatedAt: 1,
  rev: null,
  ...over,
});
const round = (id: string, n: number, over: Partial<KhatamRound> = {}): KhatamRound => ({
  id,
  n,
  startedAt: 100,
  finishedAt: null,
  updatedAt: 100,
  rev: null,
  ...over,
});
const dayChange = (d: string, rev: number, pages: Record<string, unknown>): Change => ({
  entity: 'readday',
  id: d,
  rev,
  deleted: false,
  data: { day: d, pages, updatedAt: 5 },
});
const dayTomb = (d: string, rev: number, clearedAt: number): Change => ({
  entity: 'readday',
  id: d,
  rev,
  deleted: true,
  data: { clearedAt },
});
const roundChange = (id: string, rev: number, data: Record<string, unknown> = {}): Change => ({
  entity: 'khatam',
  id,
  rev,
  deleted: false,
  data: { n: 1, startedAt: 100, finishedAt: null, updatedAt: 100, ...data },
});

describe('sync apply: reading progress', () => {
  let db: MushafDb;
  beforeEach(() => {
    db = new MushafDb('test-' + Math.random().toString(36).slice(2));
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  describe('readday (union merge)', () => {
    it('creates a day from a pull and ignores malformed pages', async () => {
      const res = await applyChanges(
        db,
        ACC,
        [dayChange('2026-10-20', 3, { '5': [10, 20], '0': [1, 2], '700': [1, 2], x: [1, 2], '6': [1] })],
        opts(),
      );
      expect(res.changed).toBe(true);
      expect(await db.readDays.get('2026-10-20')).toMatchObject({
        pages: { '5': [10, 20] },
        rev: 3,
      });
    });

    it('unions with the local copy: min(first), max(last) per page, local-only pages kept', async () => {
      await db.readDays.put(day('2026-10-20', { '5': [15, 60], '9': [1, 2] }, { rev: 1 }));
      await applyChanges(
        db,
        ACC,
        [dayChange('2026-10-20', 4, { '5': [10, 20], '6': [30, 40] })],
        opts(),
      );
      const row = await db.readDays.get('2026-10-20');
      expect(row?.pages).toEqual({ '5': [10, 60], '6': [30, 40], '9': [1, 2] });
      expect(row?.rev).toBe(4);
    });

    it('is order independent (commutative)', async () => {
      const a = dayChange('2026-10-20', 2, { '5': [10, 20] });
      const b = dayChange('2026-10-20', 3, { '5': [15, 90], '7': [1, 1] });
      await applyChanges(db, ACC, [a, b], opts());
      const first = (await db.readDays.get('2026-10-20'))?.pages;
      await db.readDays.clear();
      await applyChanges(db, ACC, [b, a], opts());
      expect((await db.readDays.get('2026-10-20'))?.pages).toEqual(first);
    });

    it('a pull never lowers a newer local rev and keeps pending ops', async () => {
      await db.readDays.put(day('2026-10-20', { '5': [10, 20] }, { rev: 9 }));
      await db.outbox.add(makeOp(ACC, 'readday', '2026-10-20', 'upsert', {}, 9));
      await applyChanges(db, ACC, [dayChange('2026-10-20', 4, { '6': [1, 2] })], opts());
      expect((await db.readDays.get('2026-10-20'))?.rev).toBe(9);
      expect(await db.outbox.count()).toBe(1);
    });

    it('tombstone with watermark drops older reads, keeps newer ones and refreshes the pending op', async () => {
      await db.readDays.put(day('2026-10-20', { '5': [10, 20], '6': [500, 600] }, { rev: 1 }));
      await db.outbox.add(
        makeOp(ACC, 'readday', '2026-10-20', 'upsert', { day: '2026-10-20', pages: {} }, 1),
      );
      await applyChanges(db, ACC, [dayTomb('2026-10-20', 5, 100)], opts());
      const row = await db.readDays.get('2026-10-20');
      expect(row?.pages).toEqual({ '6': [500, 600] });
      const op = (await db.outbox.toArray())[0];
      expect(op?.payload).toMatchObject({ pages: { '6': [500, 600] } });
    });

    it('tombstone that covers everything removes the row and its pending op', async () => {
      await db.readDays.put(day('2026-10-20', { '5': [10, 20] }, { rev: 1 }));
      await db.outbox.add(makeOp(ACC, 'readday', '2026-10-20', 'upsert', {}, 1));
      await applyChanges(db, ACC, [dayTomb('2026-10-20', 5, 100)], opts());
      expect(await db.readDays.get('2026-10-20')).toBeUndefined();
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('khatam rounds', () => {
    it('upserts by id, honours rev and keeps a pending local edit', async () => {
      await applyChanges(db, ACC, [roundChange('r1', 2)], opts());
      expect(await db.rounds.get('r1')).toMatchObject({ n: 1, rev: 2, finishedAt: null });
      await applyChanges(db, ACC, [roundChange('r1', 1, { finishedAt: 9 })], opts()); // stale
      expect((await db.rounds.get('r1'))?.finishedAt).toBeNull();
      await db.outbox.add(makeOp(ACC, 'khatam', 'r1', 'upsert', {}, 2));
      await applyChanges(db, ACC, [roundChange('r1', 3, { finishedAt: 50 })], opts());
      expect((await db.rounds.get('r1'))?.finishedAt).toBeNull(); // local edit in flight wins
      expect((await db.outbox.toArray())[0]?.baseRev).toBe(3);
    });

    it('tombstone deletes the round and its pending ops', async () => {
      await db.rounds.put(round('r1', 1, { rev: 1 }));
      await db.outbox.add(makeOp(ACC, 'khatam', 'r1', 'upsert', {}, 1));
      await applyChanges(
        db,
        ACC,
        [{ entity: 'khatam', id: 'r1', rev: 4, deleted: true, data: null }],
        opts(),
      );
      expect(await db.rounds.get('r1')).toBeUndefined();
      expect(await db.outbox.count()).toBe(0);
    });

    it('same number on two devices: server round wins, finish mark and earlier start survive', async () => {
      await db.rounds.put(round('mine', 1, { startedAt: 50, finishedAt: 900 }));
      await db.outbox.add(makeOp(ACC, 'khatam', 'mine', 'upsert', {}, null));
      await applyChanges(db, ACC, [roundChange('theirs', 7, { startedAt: 100 })], opts());
      expect(await db.rounds.get('mine')).toBeUndefined();
      expect(await db.rounds.get('theirs')).toMatchObject({ rev: 7, startedAt: 50, finishedAt: 900 });
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ entity: 'khatam', entityId: 'theirs', baseRev: 7 });
      expect(ops[0]?.payload).toMatchObject({ finishedAt: 900, startedAt: 50 });
    });
  });

  describe('push results', () => {
    it('applied sets revs; duplicate khatam merges into the server round', async () => {
      await db.readDays.put(day('2026-10-20', { '5': [1, 2] }));
      await db.rounds.put(round('mine', 1));
      const ops = [
        makeOp(ACC, 'readday', '2026-10-20', 'upsert', {}, null),
        makeOp(ACC, 'khatam', 'mine', 'upsert', {}, null),
      ];
      await db.outbox.bulkAdd(ops);
      const out = await handleResults(
        db,
        ACC,
        ops,
        [
          { opId: ops[0]!.opId, status: 'applied', rev: 8 },
          {
            opId: ops[1]!.opId,
            status: 'duplicate',
            current: roundChange('server', 9),
          },
        ],
        opts(),
      );
      expect(out.applied).toBe(1);
      expect(out.duplicates).toBe(1);
      expect((await db.readDays.get('2026-10-20'))?.rev).toBe(8);
      expect(await db.rounds.get('mine')).toBeUndefined();
      expect(await db.rounds.get('server')).toMatchObject({ rev: 9 });
      expect(await db.outbox.count()).toBe(0);
    });

    it('applied clear-all op (no local row) is harmless', async () => {
      const op = makeOp(ACC, 'readday', 'all', 'delete', null, null);
      await db.outbox.add(op);
      const out = await handleResults(db, ACC, [op], [{ opId: op.opId, status: 'applied', rev: 3 }], opts());
      expect(out.applied).toBe(1);
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('first link and reset', () => {
    it('enqueues days and rounds in the first-link snapshot', async () => {
      await db.readDays.put(day('2026-10-20', { '5': [1, 2] }));
      await db.rounds.put(round('r1', 1));
      expect(await enqueueLocalSnapshot(db, ACC)).toBe(2);
      const ops = await db.outbox.toArray();
      expect(ops.find((o) => o.entity === 'readday')?.payload).toEqual(
        readDayPayload(day('2026-10-20', { '5': [1, 2] })),
      );
      expect(ops.find((o) => o.entity === 'khatam')?.payload).toEqual(roundPayload(round('r1', 1)));
    });

    it('reset: removes synced rows missing remotely, keeps and re-sends unsynced ones', async () => {
      await db.readDays.bulkPut([
        day('2026-10-01', { '1': [1, 2] }, { rev: 2 }), // synced, cleared elsewhere
        day('2026-10-02', { '2': [1, 2] }, { rev: 3 }), // synced, present remotely
        day('2026-10-03', { '3': [1, 2] }), // unsynced
      ]);
      await db.rounds.bulkPut([round('gone', 1, { rev: 4 }), round('new', 2)]);
      await reconcileReset(db, ACC, [dayChange('2026-10-02', 3, { '2': [1, 2] })], opts());
      expect((await db.readDays.toArray()).map((d) => d.day).sort()).toEqual([
        '2026-10-02',
        '2026-10-03',
      ]);
      expect(await db.rounds.get('gone')).toBeUndefined();
      const ops = await db.outbox.toArray();
      expect(ops.map((o) => `${o.entity}:${o.entityId}`).sort()).toEqual([
        'khatam:new',
        'readday:2026-10-03',
      ]);
    });
  });
});

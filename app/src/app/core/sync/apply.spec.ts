import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { IDBKeyRange as FakeKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { Bookmark, BookmarkFolder, DEFAULT_PREFERENCES, ReadingPosition } from '../models';
import { MushafDb } from '../storage/db';
import { applyChanges, handleResults, reconcileReset } from './apply';
import { enqueueLocalSnapshot, makeOp } from './outbox';
import { BatchResult, Change } from './sync-types';

const ACC = 'acc-1';
const DEV = 'dev-local';
const opts = (o: Partial<Parameters<typeof applyChanges>[3]> = {}) => ({
  localDeviceId: DEV,
  detectPositionConflict: false,
  ...o,
});

function bm(id: string, over: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    kind: 'page',
    editionId: 'hafs-kfqc',
    page: 10,
    surah: null,
    ayah: null,
    key: 'hafs-kfqc|page|10',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    rev: null,
    folderId: null,
    note: null,
    ...over,
  };
}
function bmChange(
  id: string,
  rev: number,
  over: Partial<Change> = {},
  data: Record<string, unknown> = {},
): Change {
  return {
    entity: 'bookmark',
    id,
    rev,
    deleted: false,
    data: {
      kind: 'page',
      editionId: 'hafs-kfqc',
      page: 10,
      surah: null,
      ayah: null,
      key: 'hafs-kfqc|page|10',
      createdAt: 1,
      updatedAt: 2,
      ...data,
    },
    ...over,
  };
}
function pos(over: Partial<ReadingPosition> = {}): ReadingPosition {
  return {
    editionId: 'hafs-kfqc',
    page: 5,
    surah: null,
    ayah: null,
    updatedAt: 100,
    deviceId: DEV,
    rev: null,
    ...over,
  };
}
function posChange(rev: number, data: Record<string, unknown>): Change {
  return {
    entity: 'position',
    id: 'hafs-kfqc',
    rev,
    deleted: false,
    data: { editionId: 'hafs-kfqc', surah: null, ayah: null, ...data },
  };
}

// Bundled chunk order may load Dexie before the fake-indexeddb globals exist.
Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = FakeKeyRange;

describe('sync apply', () => {
  let db: MushafDb;
  beforeEach(() => {
    db = new MushafDb('test-' + Math.random().toString(36).slice(2));
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  describe('pull apply', () => {
    it('upserts bookmarks by id honoring rev', async () => {
      await db.bookmarks.put(bm('a', { rev: 5 }));
      await applyChanges(db, ACC, [bmChange('a', 3, {}, { page: 99 })], opts()); // stale
      expect((await db.bookmarks.get('a'))?.page).toBe(10);
      await applyChanges(db, ACC, [bmChange('a', 6, {}, { page: 11, key: 'k2' })], opts());
      const row = await db.bookmarks.get('a');
      expect(row).toMatchObject({ page: 11, rev: 6, deletedAt: null });
    });

    it('applies tombstones and drops stale pending upserts', async () => {
      await db.bookmarks.put(bm('a', { rev: 1 }));
      await db.outbox.add(makeOp(ACC, 'bookmark', 'a', 'upsert', {}, 1));
      await applyChanges(
        db,
        ACC,
        [{ entity: 'bookmark', id: 'a', rev: 2, deleted: true, data: null }],
        opts(),
      );
      expect((await db.bookmarks.get('a'))?.deletedAt).not.toBeNull();
      expect((await db.bookmarks.get('a'))?.rev).toBe(2);
      expect(await db.outbox.count()).toBe(0);
    });

    it('does not create rows for unknown tombstones', async () => {
      await applyChanges(
        db,
        ACC,
        [{ entity: 'bookmark', id: 'zz', rev: 2, deleted: true, data: null }],
        opts(),
      );
      expect(await db.bookmarks.count()).toBe(0);
    });

    it('does not resurrect a bookmark whose local delete is in flight', async () => {
      await db.bookmarks.put(bm('a', { rev: 1, deletedAt: 50 }));
      await db.outbox.add(makeOp(ACC, 'bookmark', 'a', 'delete', null, 1));
      await applyChanges(db, ACC, [bmChange('a', 2)], opts());
      expect((await db.bookmarks.get('a'))?.deletedAt).toBe(50);
    });

    it('dedupes by semantic key: server bookmark replaces unsynced local twin', async () => {
      await db.bookmarks.put(bm('local'));
      await db.outbox.add(makeOp(ACC, 'bookmark', 'local', 'upsert', {}, null));
      await applyChanges(db, ACC, [bmChange('remote', 4)], opts());
      expect(await db.bookmarks.get('local')).toBeUndefined();
      expect((await db.bookmarks.get('remote'))?.rev).toBe(4);
      expect(await db.outbox.count()).toBe(0);
    });

    it('applies prefs (server wins) but keeps onboardingDone; ignores invalid enums', async () => {
      await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs', onboardingDone: true, rev: 1 });
      await applyChanges(
        db,
        ACC,
        [
          {
            entity: 'prefs',
            id: 'prefs',
            rev: 2,
            deleted: false,
            data: { paperTheme: 'antique', uiTheme: 'bogus', highContrast: true, updatedAt: 9 },
          },
        ],
        opts(),
      );
      const p = await db.prefs.get('prefs');
      expect(p).toMatchObject({
        paperTheme: 'antique',
        uiTheme: 'segar',
        highContrast: true,
        onboardingDone: true,
        rev: 2,
        updatedAt: 9,
      });
    });

    it('keeps a pending local prefs edit and bumps its baseRev', async () => {
      await db.prefs.put({
        ...DEFAULT_PREFERENCES,
        key: 'prefs',
        paperTheme: 'photo',
        updatedAt: 50,
        rev: 1,
      });
      const op = makeOp(ACC, 'prefs', 'prefs', 'upsert', {}, 1);
      await db.outbox.add(op);
      await applyChanges(
        db,
        ACC,
        [
          {
            entity: 'prefs',
            id: 'prefs',
            rev: 4,
            deleted: false,
            data: { paperTheme: 'antique', updatedAt: 40 },
          },
        ],
        opts(),
      );
      expect((await db.prefs.get('prefs'))?.paperTheme).toBe('photo');
      expect((await db.outbox.get(op.opId))?.baseRev).toBe(4);
    });
  });

  describe('position conflict rules', () => {
    const remote = (over: Record<string, unknown> = {}) =>
      posChange(3, { page: 200, updatedAt: 500, deviceId: 'dev-other', ...over });

    it('cold start: newer remote page from another device => conflict, reader untouched', async () => {
      await db.positions.put(pos({ page: 5, updatedAt: 100 }));
      const r = await applyChanges(db, ACC, [remote()], opts({ detectPositionConflict: true }));
      expect(r.conflict?.cloud.page).toBe(200);
      expect(r.conflict?.device.page).toBe(5);
      expect((await db.positions.get('hafs-kfqc'))?.page).toBe(5);
    });

    it('conflict cancels a pending local position op', async () => {
      await db.positions.put(pos());
      await db.outbox.add(makeOp(ACC, 'position', 'hafs-kfqc', 'upsert', {}, null));
      await applyChanges(db, ACC, [remote()], opts({ detectPositionConflict: true }));
      expect(await db.outbox.count()).toBe(0);
    });

    it.each([
      ['same device', { deviceId: DEV }],
      ['same page', { page: 5 }],
      ['older remote', { updatedAt: 50 }],
    ])('no conflict: %s', async (_n, over) => {
      await db.positions.put(pos({ page: 5, updatedAt: 100 }));
      const r = await applyChanges(db, ACC, [remote(over)], opts({ detectPositionConflict: true }));
      expect(r.conflict).toBeNull();
    });

    it('active session: newer remote is stored silently, no conflict', async () => {
      await db.positions.put(pos({ page: 5, updatedAt: 100 }));
      const r = await applyChanges(db, ACC, [remote()], opts({ detectPositionConflict: false }));
      expect(r.conflict).toBeNull();
      expect(await db.positions.get('hafs-kfqc')).toMatchObject({ page: 200, rev: 3 });
    });

    it('holdPosition leaves the local position alone while a conflict is open', async () => {
      await db.positions.put(pos({ page: 5, updatedAt: 100 }));
      await applyChanges(db, ACC, [remote()], opts({ holdPosition: true }));
      expect((await db.positions.get('hafs-kfqc'))?.page).toBe(5);
    });

    it('stores remote position when none exists locally', async () => {
      await applyChanges(db, ACC, [remote()], opts({ detectPositionConflict: true }));
      expect((await db.positions.get('hafs-kfqc'))?.page).toBe(200);
    });

    it('records the rev of our own echo', async () => {
      await db.positions.put(pos({ page: 5, updatedAt: 100 }));
      await applyChanges(
        db,
        ACC,
        [posChange(8, { page: 5, updatedAt: 100, deviceId: DEV })],
        opts(),
      );
      expect((await db.positions.get('hafs-kfqc'))?.rev).toBe(8);
    });
  });

  describe('push result handling', () => {
    const res = (
      opId: string,
      status: BatchResult['status'],
      extra: Partial<BatchResult> = {},
    ): BatchResult => ({ opId, status, ...extra });

    it('applied: sets local rev, removes op, bumps baseRev of later ops', async () => {
      await db.bookmarks.put(bm('a'));
      const create = makeOp(ACC, 'bookmark', 'a', 'upsert', {}, null);
      const del = makeOp(ACC, 'bookmark', 'a', 'delete', null, null);
      await db.outbox.bulkAdd([create, del]);
      const out = await handleResults(
        db,
        ACC,
        [create],
        [res(create.opId, 'applied', { rev: 7 })],
        opts(),
      );
      expect(out.applied).toBe(1);
      expect((await db.bookmarks.get('a'))?.rev).toBe(7);
      expect(await db.outbox.get(create.opId)).toBeUndefined();
      expect((await db.outbox.get(del.opId))?.baseRev).toBe(7);
    });

    it('applied position / prefs set their revs', async () => {
      await db.positions.put(pos());
      await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs' });
      const a = makeOp(ACC, 'position', 'hafs-kfqc', 'upsert', {}, null);
      const b = makeOp(ACC, 'prefs', 'prefs', 'upsert', {}, null);
      await db.outbox.bulkAdd([a, b]);
      await handleResults(
        db,
        ACC,
        [a, b],
        [res(a.opId, 'applied', { rev: 2 }), res(b.opId, 'applied', { rev: 3 })],
        opts(),
      );
      expect((await db.positions.get('hafs-kfqc'))?.rev).toBe(2);
      expect((await db.prefs.get('prefs'))?.rev).toBe(3);
    });

    it('duplicate: replaces local bookmark id with the server one', async () => {
      await db.bookmarks.put(bm('local'));
      const op = makeOp(ACC, 'bookmark', 'local', 'upsert', {}, null);
      await db.outbox.add(op);
      const out = await handleResults(
        db,
        ACC,
        [op],
        [res(op.opId, 'duplicate', { current: bmChange('server', 9) })],
        opts(),
      );
      expect(out.duplicates).toBe(1);
      expect(await db.bookmarks.get('local')).toBeUndefined();
      expect(await db.bookmarks.get('server')).toMatchObject({ rev: 9, deletedAt: null });
      expect(await db.outbox.count()).toBe(0);
    });

    it('duplicate: a queued local delete is carried over to the server id', async () => {
      await db.bookmarks.put(bm('local', { deletedAt: 10 }));
      const up = makeOp(ACC, 'bookmark', 'local', 'upsert', {}, null);
      const del = makeOp(ACC, 'bookmark', 'local', 'delete', null, null);
      await db.outbox.bulkAdd([up, del]);
      await handleResults(
        db,
        ACC,
        [up],
        [res(up.opId, 'duplicate', { current: bmChange('server', 9) })],
        opts(),
      );
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        entity: 'bookmark',
        entityId: 'server',
        action: 'delete',
        baseRev: 9,
      });
      expect((await db.bookmarks.get('server'))?.deletedAt).not.toBeNull();
    });

    it('conflict: server value wins for prefs', async () => {
      await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs', paperTheme: 'photo', rev: 1 });
      const op = makeOp(ACC, 'prefs', 'prefs', 'upsert', {}, 1);
      await db.outbox.add(op);
      const cur: Change = {
        entity: 'prefs',
        id: 'prefs',
        rev: 5,
        deleted: false,
        data: { paperTheme: 'antique', updatedAt: 30 },
      };
      const out = await handleResults(
        db,
        ACC,
        [op],
        [res(op.opId, 'conflict', { current: cur })],
        opts(),
      );
      expect(out.conflicts).toBe(1);
      expect(await db.prefs.get('prefs')).toMatchObject({ paperTheme: 'antique', rev: 5 });
      expect(await db.outbox.count()).toBe(0);
    });

    it('conflict: tombstone beats a stale local edit', async () => {
      await db.bookmarks.put(bm('a', { rev: 1 }));
      const op = makeOp(ACC, 'bookmark', 'a', 'upsert', {}, 1);
      await db.outbox.add(op);
      const cur: Change = { entity: 'bookmark', id: 'a', rev: 3, deleted: true, data: null };
      await handleResults(db, ACC, [op], [res(op.opId, 'conflict', { current: cur })], opts());
      expect((await db.bookmarks.get('a'))?.deletedAt).not.toBeNull();
    });

    it('rejected: drops the op and reports the error, keeps local data', async () => {
      await db.bookmarks.put(bm('a'));
      const op = makeOp(ACC, 'bookmark', 'a', 'upsert', {}, null);
      await db.outbox.add(op);
      const out = await handleResults(
        db,
        ACC,
        [op],
        [res(op.opId, 'rejected', { error: 'invalid_payload' })],
        opts(),
      );
      expect(out.rejected[0]).toMatchObject({ opId: op.opId, error: 'invalid_payload' });
      expect(await db.outbox.count()).toBe(0);
      expect(await db.bookmarks.get('a')).toBeDefined();
    });

    it('ops without a result are reported missing and stay queued', async () => {
      const op = makeOp(ACC, 'prefs', 'prefs', 'upsert', {}, null);
      await db.outbox.add(op);
      const out = await handleResults(db, ACC, [op], [], opts());
      expect(out.missing).toHaveLength(1);
      expect(await db.outbox.count()).toBe(1);
    });
  });

  describe('full reconciliation (reset)', () => {
    it('deletes synced rows missing remotely, keeps + re-enqueues unsynced ones', async () => {
      await db.bookmarks.bulkPut([
        bm('gone', { rev: 2, key: 'k-gone' }),
        bm('kept', { rev: 3, key: 'k-kept' }),
        bm('fresh', { rev: null, key: 'k-fresh' }),
      ]);
      await db.outbox.add(makeOp(ACC, 'bookmark', 'gone', 'delete', null, 2));
      const r = await reconcileReset(db, ACC, [bmChange('kept', 4, {}, { key: 'k-kept' })], opts());
      expect(r.changed).toBe(true);
      expect(await db.bookmarks.get('gone')).toBeUndefined();
      expect((await db.bookmarks.get('kept'))?.rev).toBe(4);
      expect(await db.bookmarks.get('fresh')).toBeDefined();
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ entityId: 'fresh', action: 'upsert' });
    });

    it('does not revive a bookmark whose tombstone expired on the server', async () => {
      await db.bookmarks.put(bm('old', { rev: 2, deletedAt: 5 }));
      await reconcileReset(db, ACC, [], opts());
      expect(await db.bookmarks.get('old')).toBeUndefined();
      expect(await db.outbox.count()).toBe(0);
    });
  });

  describe('folders', () => {
    const fo = (id: string, name: string, over: Partial<BookmarkFolder> = {}): BookmarkFolder => ({
      id, name, createdAt: 1, updatedAt: 1, deletedAt: null, rev: null, ...over,
    });
    const foChange = (id: string, rev: number, name: string, deleted = false): Change => ({
      entity: 'folder', id, rev, deleted, data: deleted ? null : { name, createdAt: 1, updatedAt: 2 },
    });

    it('upserts folders honoring rev and applies tombstones', async () => {
      await db.folders.put(fo('f1', 'Lama', { rev: 5 }));
      await applyChanges(db, ACC, [foChange('f1', 3, 'Stale')], opts());
      expect((await db.folders.get('f1'))?.name).toBe('Lama');
      await applyChanges(db, ACC, [foChange('f1', 6, 'Baru')], opts());
      expect(await db.folders.get('f1')).toMatchObject({ name: 'Baru', rev: 6 });
      await applyChanges(db, ACC, [foChange('f1', 7, '', true)], opts());
      expect((await db.folders.get('f1'))?.deletedAt).not.toBeNull();
    });

    it('bookmark changes carry folderId/note; missing => null', async () => {
      await applyChanges(db, ACC, [bmChange('a', 1, {}, { folderId: 'f1', note: 'catatan' }), bmChange('b', 2, {}, { key: 'k2', page: 2 })], opts());
      expect(await db.bookmarks.get('a')).toMatchObject({ folderId: 'f1', note: 'catatan' });
      expect(await db.bookmarks.get('b')).toMatchObject({ folderId: null, note: null });
    });

    it('name collision with an unsynced local folder: server wins, bookmarks re-pointed, local twin tombstoned', async () => {
      await db.folders.put(fo('local', 'Khatam 1'));
      await db.bookmarks.bulkPut([
        bm('x', { folderId: 'local', key: 'kx' }),
        bm('y', { folderId: 'local', key: 'ky', rev: 4 }),
      ]);
      await db.outbox.bulkAdd([
        makeOp(ACC, 'folder', 'local', 'upsert', {}, null),
        makeOp(ACC, 'bookmark', 'x', 'upsert', { folderId: 'local' }, null),
      ]);
      await applyChanges(db, ACC, [foChange('srv', 9, 'khatam 1')], opts());
      expect((await db.folders.get('srv'))?.rev).toBe(9);
      expect((await db.folders.get('local'))?.deletedAt).not.toBeNull();
      expect((await db.bookmarks.get('x'))?.folderId).toBe('srv');
      expect((await db.bookmarks.get('y'))?.folderId).toBe('srv');
      const ops = await db.outbox.toArray();
      expect(ops.some((o) => o.entity === 'folder')).toBe(false);
      expect(ops.find((o) => o.entityId === 'x')?.payload).toMatchObject({ folderId: 'srv' });
      expect(ops.find((o) => o.entityId === 'y')).toMatchObject({ action: 'upsert', baseRev: 4 });
    });

    it('result handling: applied sets rev; duplicate/conflict adopt server; rejected drops', async () => {
      await db.folders.bulkPut([fo('a', 'A'), fo('b', 'B'), fo('c', 'C', { rev: 1 })]);
      const oa = makeOp(ACC, 'folder', 'a', 'upsert', {}, null);
      const ob = makeOp(ACC, 'folder', 'b', 'upsert', {}, null);
      const oc = makeOp(ACC, 'folder', 'c', 'upsert', {}, 1);
      const od = makeOp(ACC, 'folder', 'a', 'upsert', {}, null);
      await db.outbox.bulkAdd([oa, ob, oc, od]);
      const out = await handleResults(db, ACC, [oa, ob, oc, od], [
        { opId: oa.opId, status: 'applied', rev: 3 },
        { opId: ob.opId, status: 'duplicate', current: foChange('sb', 4, 'b') },
        { opId: oc.opId, status: 'conflict', current: foChange('c', 8, 'C2') },
        { opId: od.opId, status: 'rejected', error: 'folder_name_taken' },
      ], opts());
      expect((await db.folders.get('a'))?.rev).toBe(3);
      expect((await db.folders.get('b'))?.deletedAt).not.toBeNull();
      expect(await db.folders.get('sb')).toMatchObject({ rev: 4 });
      expect(await db.folders.get('c')).toMatchObject({ name: 'C2', rev: 8 });
      expect(out.rejected[0]?.error).toBe('folder_name_taken');
      expect(await db.outbox.count()).toBe(0);
    });

    it('reset reconciliation drops synced folders missing remotely, re-enqueues unsynced', async () => {
      await db.folders.bulkPut([fo('gone', 'G', { rev: 2 }), fo('new', 'N')]);
      await reconcileReset(db, ACC, [], opts());
      expect(await db.folders.get('gone')).toBeUndefined();
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ entity: 'folder', entityId: 'new' });
    });

    it('first-link merge enqueues active folders before bookmarks', async () => {
      await db.folders.bulkPut([fo('f', 'F'), fo('t', 'T', { deletedAt: 5 })]);
      await db.bookmarks.put(bm('a', { folderId: 'f' }));
      await enqueueLocalSnapshot(db, ACC);
      const ops = (await db.outbox.orderBy('createdAt').toArray());
      expect(ops.map((o) => o.entity)).toEqual(['folder', 'bookmark']);
      expect(ops[1]?.payload).toMatchObject({ folderId: 'f', note: null });
    });
  });

  describe('first-link merge enqueue', () => {
    it('enqueues active bookmarks, prefs (if edited) and position; skips tombstones/duplicates', async () => {
      await db.bookmarks.bulkPut([
        bm('a'),
        bm('b', { key: 'k2', page: 2 }),
        bm('t', { key: 'k3', deletedAt: 9 }),
      ]);
      await db.positions.put(pos());
      await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs', updatedAt: 5 });
      await db.outbox.add(makeOp(ACC, 'bookmark', 'a', 'upsert', {}, null));
      const n = await enqueueLocalSnapshot(db, ACC);
      expect(n).toBe(3); // b, position, prefs
      const ops = await db.outbox.toArray();
      expect(
        ops
          .filter((o) => o.entity === 'bookmark')
          .map((o) => o.entityId)
          .sort(),
      ).toEqual(['a', 'b']);
      expect(ops.find((o) => o.entity === 'position')?.payload).toMatchObject({
        page: 5,
        deviceId: DEV,
      });
      expect(ops.every((o) => o.accountId === ACC)).toBe(true);
    });

    it('does not enqueue never-edited default prefs', async () => {
      await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs' });
      expect(await enqueueLocalSnapshot(db, ACC)).toBe(0);
    });
  });
});

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { IDBKeyRange as FakeKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { MushafDb } from '../storage/db';
import { APPLY_CHUNK, applyChanges } from './apply';
import { Change } from './sync-types';

const changes = (n: number): Change[] =>
  Array.from({ length: n }, (_, i) => ({
    entity: 'bookmark' as const,
    id: 'b' + i,
    rev: 1,
    deleted: false,
    data: {
      kind: 'page',
      editionId: 'hafs-kfqc',
      page: (i % 600) + 1,
      surah: null,
      ayah: null,
      key: 'hafs-kfqc|page|' + ((i % 600) + 1),
      createdAt: 1,
      updatedAt: 2,
    },
  }));

describe('applyChanges batching', () => {
  let db: MushafDb;
  beforeEach(() => {
    Dexie.dependencies.indexedDB = fakeIndexedDB;
    Dexie.dependencies.IDBKeyRange = FakeKeyRange;
    db = new MushafDb('chunk-' + Math.random().toString(36).slice(2));
  });
  afterEach(() => db.close());

  it('applies a large pull completely', async () => {
    const n = APPLY_CHUNK * 3 + 7;
    const res = await applyChanges(db, 'a', changes(n), { localDeviceId: 'd', detectPositionConflict: false });
    expect(res.changed).toBe(true);
    expect(await db.bookmarks.count()).toBe(n);
  });

  it('lets a local bookmark write through before the whole pull has been applied', async () => {
    const order: string[] = [];
    const apply = applyChanges(db, 'a', changes(APPLY_CHUNK * 5), {
      localDeviceId: 'd',
      detectPositionConflict: false,
    }).then(() => order.push('apply-done'));
    const local = db
      .transaction('rw', db.bookmarks, async () => {
        await db.bookmarks.put({
          id: 'local',
          kind: 'verse',
          editionId: 'hafs-kfqc',
          page: 9,
          surah: 1,
          ayah: 1,
          key: 'hafs-kfqc|verse|1:1',
          createdAt: 5,
          updatedAt: 5,
          deletedAt: null,
          rev: null,
          folderId: null,
          note: null,
          archivedAt: null,
        });
      })
      .then(() => order.push('local-done'));
    await Promise.all([apply, local]);
    expect(order).toEqual(['local-done', 'apply-done']);
  });
});

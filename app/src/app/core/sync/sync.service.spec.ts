import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { IDBKeyRange as FakeKeyRange, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { UserDataApi } from '../contracts';
import { Bookmark, DEFAULT_PREFERENCES, ReadingPosition, SyncState } from '../models';
import { ReaderUiService } from '../reader-ui.service';
import { MushafDb } from '../storage/db';
import { makeOp } from './outbox';
import { SyncApiClient, SyncHttpError } from './sync-api-client';
import { SYNC_DB } from './sync-db';
import { BatchResult, Change, MeUser, WireOp } from './sync-types';
import { SyncService } from './sync.service';

const USER_A: MeUser = { id: 'A', email: 'a@x.id', name: 'A' };
const USER_B: MeUser = { id: 'B', email: 'b@x.id', name: 'B' };

function bm(id: string, over: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    kind: 'page',
    editionId: 'hafs-kfqc',
    page: 10,
    surah: null,
    ayah: null,
    key: `hafs-kfqc|page|${over.page ?? 10}`,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    rev: null,
    ...over,
  };
}
const pos = (over: Partial<ReadingPosition> = {}): ReadingPosition => ({
  editionId: 'hafs-kfqc',
  page: 5,
  surah: null,
  ayah: null,
  updatedAt: 100,
  deviceId: 'dev-local',
  rev: null,
  ...over,
});
const enabledState = (accountId: string, over: Partial<SyncState> = {}): SyncState => ({
  key: 'state',
  enabled: true,
  accountId,
  cursor: 0,
  lastSuccessAt: null,
  status: 'idle',
  lastErrorCode: null,
  ...over,
});

// Bundled chunk order may load Dexie before the fake-indexeddb globals exist.
Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = FakeKeyRange;

describe('SyncService', () => {
  let db: MushafDb;
  let svc: SyncService;
  let client: {
    me: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    pushBatch: ReturnType<typeof vi.fn>;
    devLogin: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    deleteMyData: ReturnType<typeof vi.fn>;
    startUrl: ReturnType<typeof vi.fn>;
  };
  let reload: ReturnType<typeof vi.fn>;
  let goToPage: ReturnType<typeof vi.fn>;
  let nextRev: number;

  const applyAll = (ops: WireOp[]): { results: BatchResult[]; cursor: number } => ({
    results: ops.map((o) => ({ opId: o.opId, status: 'applied' as const, rev: nextRev++ })),
    cursor: 1,
  });

  beforeEach(() => {
    db = new MushafDb('test-' + Math.random().toString(36).slice(2));
    nextRev = 1;
    reload = vi.fn().mockResolvedValue(undefined);
    goToPage = vi.fn();
    client = {
      me: vi.fn().mockResolvedValue(USER_A),
      pull: vi.fn().mockResolvedValue({ changes: [], cursor: 0, hasMore: false, reset: false }),
      pushBatch: vi.fn().mockImplementation(async (ops: WireOp[]) => applyAll(ops)),
      devLogin: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      deleteMyData: vi.fn().mockResolvedValue(undefined),
      startUrl: vi.fn(),
    };
    history.replaceState(null, '', '/hal/3');
    TestBed.configureTestingModule({
      providers: [
        { provide: SYNC_DB, useValue: db },
        { provide: SyncApiClient, useValue: client },
        { provide: UserDataApi, useValue: { deviceId: () => 'dev-local', reload } },
        { provide: ReaderUiService, useValue: { goToPage } },
      ],
    });
    svc = TestBed.inject(SyncService);
  });

  afterEach(async () => {
    (svc as unknown as { clearTimers(): void }).clearTimers();
    db.close();
    await db.delete();
    TestBed.resetTestingModule();
  });

  it('first link after ?sync=connected merges local data, strips the param and syncs', async () => {
    await db.bookmarks.bulkPut([bm('a'), bm('b', { page: 11 })]);
    await db.positions.put(pos());
    await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs', updatedAt: 5 });
    history.replaceState(null, '', '/hal/3?sync=connected');

    await svc.init();

    expect(location.search).toBe('');
    expect(svc.account()?.id).toBe('A');
    const state = await db.sync.get('state');
    expect(state).toMatchObject({ enabled: true, accountId: 'A' });
    const sent = (client.pushBatch.mock.calls as [WireOp[]][]).flatMap((c) => c[0]);
    expect(sent.map((o) => `${o.entity}:${o.entityId}`).sort()).toEqual(['bookmark:a', 'bookmark:b', 'position:hafs-kfqc', 'prefs:prefs']);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.bookmarks.get('a'))?.rev).not.toBeNull();
    expect(svc.status()).toBe('synced');
    expect(svc.lastSuccessAt()).not.toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it('batches pushes in groups of at most 100', async () => {
    await db.sync.put(enabledState('A'));
    const ops = Array.from({ length: 230 }, (_, i) => makeOp('A', 'bookmark', `b${i}`, 'upsert', {}, null, i));
    await db.outbox.bulkAdd(ops);
    await svc.init();
    const sizes = (client.pushBatch.mock.calls as [WireOp[]][]).map((c) => c[0].length);
    expect(sizes).toEqual([100, 100, 30]);
  });

  it('never sends another account\'s ops; a different session isolates and disables sync', async () => {
    await db.sync.put(enabledState('A'));
    await db.bookmarks.put(bm('a', { rev: 3 }));
    await db.outbox.add(makeOp('A', 'bookmark', 'a', 'upsert', {}, 3));
    client.me.mockResolvedValue(USER_B);

    await svc.init(); // no ?sync=connected -> no merge into B

    expect(client.pushBatch).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sync.get('state')).toMatchObject({ enabled: false, accountId: null, cursor: 0 });
    expect(svc.status()).toBe('off');
    expect(svc.account()).toBeNull();
    expect((await db.bookmarks.get('a'))?.rev).toBeNull(); // kept locally as anonymous data
  });

  it('only pushes ops of the current account', async () => {
    await db.sync.put(enabledState('A'));
    await db.outbox.bulkAdd([makeOp('A', 'prefs', 'prefs', 'upsert', {}, null), makeOp('B', 'prefs', 'prefs', 'upsert', {}, null)]);
    await svc.init();
    const sent = (client.pushBatch.mock.calls as [WireOp[]][]).flatMap((c) => c[0]);
    expect(sent).toHaveLength(1);
    expect(await db.outbox.where('accountId').equals('B').count()).toBe(1);
  });

  it('detects a position conflict on cold start without moving the reader or overwriting the cloud', async () => {
    await db.sync.put(enabledState('A'));
    await db.positions.put(pos({ page: 5, updatedAt: 100 }));
    await db.outbox.add(makeOp('A', 'position', 'hafs-kfqc', 'upsert', { page: 5 }, null));
    const remote: Change = {
      entity: 'position',
      id: 'hafs-kfqc',
      rev: 9,
      deleted: false,
      data: { editionId: 'hafs-kfqc', page: 300, surah: null, ayah: null, updatedAt: 500, deviceId: 'dev-other' },
    };
    client.pull.mockResolvedValueOnce({ changes: [remote], cursor: 9, hasMore: false, reset: false });

    await svc.init();

    expect(svc.status()).toBe('conflict');
    expect(svc.conflict()?.cloud.page).toBe(300);
    expect(svc.conflict()?.device.page).toBe(5);
    expect((await db.positions.get('hafs-kfqc'))?.page).toBe(5);
    expect(client.pushBatch).not.toHaveBeenCalled(); // device position op was cancelled
    expect(goToPage).not.toHaveBeenCalled();
  });

  it('resolveConflict(cloud) writes the cloud position and navigates', async () => {
    await db.sync.put(enabledState('A'));
    await db.positions.put(pos({ page: 5, updatedAt: 100 }));
    const remote: Change = {
      entity: 'position',
      id: 'hafs-kfqc',
      rev: 9,
      deleted: false,
      data: { editionId: 'hafs-kfqc', page: 300, surah: null, ayah: null, updatedAt: 500, deviceId: 'dev-other' },
    };
    client.pull.mockResolvedValueOnce({ changes: [remote], cursor: 9, hasMore: false, reset: false });
    await svc.init();

    await svc.resolveConflict('cloud');

    expect((await db.positions.get('hafs-kfqc'))?.page).toBe(300);
    expect(goToPage).toHaveBeenCalledWith(300);
    expect(svc.conflict()).toBeNull();
  });

  it('resolveConflict(device) enqueues the local position and pushes it', async () => {
    await db.sync.put(enabledState('A'));
    await db.positions.put(pos({ page: 5, updatedAt: 100 }));
    const remote: Change = {
      entity: 'position',
      id: 'hafs-kfqc',
      rev: 9,
      deleted: false,
      data: { editionId: 'hafs-kfqc', page: 300, surah: null, ayah: null, updatedAt: 500, deviceId: 'dev-other' },
    };
    client.pull.mockResolvedValueOnce({ changes: [remote], cursor: 9, hasMore: false, reset: false });
    await svc.init();

    await svc.resolveConflict('device');

    const sent = (client.pushBatch.mock.calls as [WireOp[]][]).flatMap((c) => c[0]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ entity: 'position', baseRev: 9, payload: { page: 5 } });
    expect(svc.conflict()).toBeNull();
    expect(goToPage).not.toHaveBeenCalled();
  });

  it('401 on push -> unauthorized and the outbox is kept untouched', async () => {
    await db.sync.put(enabledState('A'));
    const op = makeOp('A', 'prefs', 'prefs', 'upsert', {}, null);
    await db.outbox.add(op);
    client.pushBatch.mockRejectedValue(new SyncHttpError('unauthorized', 401));
    await svc.init();
    expect(svc.status()).toBe('unauthorized');
    expect(await db.outbox.get(op.opId)).toMatchObject({ retryCount: 0, nextAttemptAt: 0 });
  });

  it('network failure -> offline, ops get retryCount + future nextAttemptAt', async () => {
    await db.sync.put(enabledState('A'));
    const op = makeOp('A', 'prefs', 'prefs', 'upsert', {}, null);
    await db.outbox.add(op);
    client.pushBatch.mockRejectedValue(new SyncHttpError('network'));
    const before = Date.now();
    await svc.init();
    expect(svc.status()).toBe('offline');
    const row = await db.outbox.get(op.opId);
    expect(row?.retryCount).toBe(1);
    expect(row?.nextAttemptAt).toBeGreaterThanOrEqual(before);
    expect(row?.nextAttemptAt).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it('429 honours Retry-After as a floor for nextAttemptAt', async () => {
    await db.sync.put(enabledState('A'));
    const op = makeOp('A', 'prefs', 'prefs', 'upsert', {}, null);
    await db.outbox.add(op);
    client.pushBatch.mockRejectedValue(new SyncHttpError('rate-limited', 429, null, 60_000));
    await svc.init();
    const row = await db.outbox.get(op.opId);
    expect((row?.nextAttemptAt ?? 0) - Date.now()).toBeGreaterThan(55_000);
  });

  it('skips ops whose nextAttemptAt is in the future', async () => {
    await db.sync.put(enabledState('A'));
    await db.outbox.add({ ...makeOp('A', 'prefs', 'prefs', 'upsert', {}, null), nextAttemptAt: Date.now() + 60_000 });
    await svc.init();
    expect(client.pushBatch).not.toHaveBeenCalled();
    expect(svc.status()).toBe('pending');
  });

  it('reset:true triggers full reconciliation from cursor 0', async () => {
    await db.sync.put(enabledState('A', { cursor: 50 }));
    await db.bookmarks.put(bm('gone', { rev: 2 }));
    client.pull
      .mockResolvedValueOnce({ changes: [], cursor: 80, hasMore: false, reset: true }) // cold-start pull
      .mockResolvedValue({ changes: [], cursor: 80, hasMore: false, reset: false });
    await svc.init();
    expect(client.pull.mock.calls[0]?.[0]).toBe(50);
    expect(client.pull.mock.calls[1]?.[0]).toBe(0);
    expect(await db.bookmarks.get('gone')).toBeUndefined();
    expect((await db.sync.get('state'))?.cursor).toBe(80);
  });

  it('signOut(clearLocal) disables sync, drops the outbox and wipes local user data', async () => {
    await db.sync.put(enabledState('A'));
    await db.bookmarks.put(bm('a', { rev: 1 }));
    await db.positions.put(pos());
    await db.outbox.add(makeOp('A', 'bookmark', 'a', 'upsert', {}, 1));
    await svc.signOut({ clearLocal: true });
    expect(client.logout).toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.bookmarks.count()).toBe(0);
    expect(await db.positions.count()).toBe(0);
    expect((await db.sync.get('state'))?.enabled).toBe(false);
    expect(reload).toHaveBeenCalled();
  });

  it('signOut keeping local data leaves rows but they lose their revisions', async () => {
    await db.sync.put(enabledState('A'));
    await db.bookmarks.put(bm('a', { rev: 4 }));
    await svc.signOut({ clearLocal: false });
    expect((await db.bookmarks.get('a'))?.rev).toBeNull();
    expect(svc.status()).toBe('off');
  });

  it('deleteCloudData calls DELETE /me/data then purges outbox and disables sync', async () => {
    await db.sync.put(enabledState('A'));
    await db.bookmarks.put(bm('a', { rev: 4 }));
    await db.outbox.add(makeOp('A', 'bookmark', 'a', 'upsert', {}, 4));
    await svc.deleteCloudData();
    expect(client.deleteMyData).toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.bookmarks.count()).toBe(1);
    expect((await db.sync.get('state'))?.enabled).toBe(false);
  });
});

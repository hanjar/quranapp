import { installFakeIndexedDb } from '../storage/testing';
import { TestBed } from '@angular/core/testing';
import { OfflineService } from './offline.service';
import { MUSHAF_DB } from '../storage/db-token';
import { MushafDb } from '../storage/db';
import {
  buildFixture,
  FakeWeb,
  Fixture,
  installFakeWeb,
  setOnline,
  TEST_VERSION,
} from '../content/testing';
import { pageUrl } from '../content/page-cache';

installFakeIndexedDb();

describe('OfflineService', () => {
  let fixture: Fixture;
  let web: FakeWeb;
  let db: MushafDb;
  let svc: OfflineService;
  let persistCalls: number;

  beforeEach(async () => {
    fixture = await buildFixture();
    web = installFakeWeb(fixture);
    db = new MushafDb('test-' + Math.random());
    persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist: async () => {
          persistCalls++;
          return true;
        },
        persisted: async () => false,
      },
    });
    TestBed.configureTestingModule({ providers: [{ provide: MUSHAF_DB, useValue: db }] });
    svc = TestBed.inject(OfflineService);
  });

  afterEach(async () => {
    await svc.idle();
    web.restore();
    // DB is intentionally left open: each test uses a fresh random name in a fresh fake
    // IDBFactory, and closing it raced with pending Dexie work on CI (DatabaseClosedError).
  });

  it('downloads all 604 pages, verifies, pins and requests persistence', async () => {
    await svc.startFullDownload();
    const s = svc.status();
    expect(s.state).toBe('done');
    expect(s.cachedPages).toBe(604);
    expect(s.cachedBytes).toBe(fixture.manifest.totalBytes);
    expect(s.totalBytes).toBe(fixture.manifest.totalBytes);
    expect(s.failedPages).toEqual([]);
    expect(s.persisted).toBe(true);
    expect(persistCalls).toBe(1);
    expect(web.caches.cache().entries.size).toBe(604);
    const pkg = (await db.meta.get('offlinePackage'))!.value as {
      pinned: boolean;
      complete: boolean;
    };
    expect(pkg.pinned).toBe(true);
    expect(pkg.complete).toBe(true);
  });

  it('lists failed pages (integrity) and retries only failed/missing ones', async () => {
    web.tamper.set(10, 'tampered');
    web.status.set(20, 500);
    await svc.startFullDownload();
    expect(svc.status().state).toBe('error');
    expect(svc.status().failedPages).toEqual([10, 20]);
    expect(svc.status().cachedPages).toBe(602);

    web.tamper.clear();
    web.status.clear();
    web.requests.length = 0;
    await svc.retryFailed();
    expect(web.requests.filter((u) => u.includes('/svg/')).length).toBe(2);
    expect(svc.status().state).toBe('done');
    expect(svc.status().failedPages).toEqual([]);
    expect(svc.status().cachedPages).toBe(604);
  });

  it('pauses and resumes without re-downloading finished pages', async () => {
    const run = svc.startFullDownload();
    svc.pause();
    await run;
    expect(svc.status().state).toBe('paused');
    const partial = svc.status().cachedPages;
    expect(partial).toBeLessThan(604);
    web.requests.length = 0;
    await svc.resume();
    expect(svc.status().state).toBe('done');
    expect(web.requests.filter((u) => u.includes('/svg/')).length).toBe(604 - partial);
  });

  it('enters quota state on QuotaExceededError', async () => {
    const err = new DOMException('full', 'QuotaExceededError');
    web.caches.cache().putError = err;
    await svc.startFullDownload();
    expect(svc.status().state).toBe('quota');
    expect(svc.status().cachedPages).toBeLessThan(604);
  });

  it('pauses when the connection drops mid-download', async () => {
    setOnline(false);
    await svc.startFullDownload();
    expect(svc.status().state).toBe('paused');
    expect(svc.status().cachedPages).toBe(0);
    setOnline(true);
    await svc.resume();
    expect(svc.status().state).toBe('done');
  });

  it('tracks online/offline events', () => {
    window.dispatchEvent(new Event('offline'));
    expect(svc.status().online).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(svc.status().online).toBe(true);
  });

  it('refresh counts cached pages from Cache Storage', async () => {
    const cache = web.caches.cache();
    for (const p of [1, 2, 3]) {
      cache.entries.set(pageUrl(p, TEST_VERSION), {
        buf: new ArrayBuffer(1),
        headers: new Headers(),
      });
    }
    await svc.refresh();
    expect(svc.status().cachedPages).toBe(3);
    expect(svc.status().totalBytes).toBe(fixture.manifest.totalBytes);
    expect(svc.status().state).toBe('idle');
  });

  it('clearPages removes page caches and LRU/pin meta but never user data', async () => {
    await db.bookmarks.add({
      id: 'b1',
      kind: 'page',
      editionId: 'hafs-kfqc',
      page: 1,
      surah: null,
      ayah: null,
      key: 'hafs-kfqc|page|1',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      rev: null,
      folderId: null,
      note: null,
      archivedAt: null,
    });
    await db.meta.put({ key: 'pageLru', value: [1] });
    await svc.startFullDownload();
    await svc.clearPages();
    expect(await web.caches.keys()).toEqual([]);
    expect(await db.meta.get('pageLru')).toBeUndefined();
    expect(await db.meta.get('offlinePackage')).toBeUndefined();
    expect(await db.bookmarks.count()).toBe(1);
    expect(svc.status().cachedPages).toBe(0);
    expect(svc.status().state).toBe('idle');
  });
});

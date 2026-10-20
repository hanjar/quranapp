import { installFakeIndexedDb } from '../storage/testing';
import { TestBed } from '@angular/core/testing';
import { ContentService } from './content.service';
import { MUSHAF_DB } from '../storage/db-token';
import { MushafDb } from '../storage/db';
import { PageLoadError } from '../models';
import { buildFixture, FakeWeb, Fixture, installFakeWeb, setOnline, TEST_VERSION } from './testing';
import { pageUrl, sha256Hex } from './page-cache';

installFakeIndexedDb();

describe('ContentService', () => {
  let fixture: Fixture;
  let web: FakeWeb;
  let db: MushafDb;
  let svc: ContentService;

  const freshService = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: MUSHAF_DB, useValue: db }] });
    return TestBed.inject(ContentService);
  };

  beforeEach(async () => {
    fixture = await buildFixture();
    web = installFakeWeb(fixture);
    db = new MushafDb('test-' + Math.random());
    svc = freshService();
  });

  afterEach(() => {
    web.restore();
    db.close();
  });

  const kindOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return e instanceof PageLoadError ? e.kind : 'other';
    }
  };

  it('loads metadata and answers lookups', async () => {
    await svc.load();
    expect(svc.loadError()).toBeNull();
    expect(svc.index()?.pages.length).toBe(604);
    expect(svc.pageMeta(5).page).toBe(5);
    expect(svc.surahAt(1).number).toBe(1);
    expect(svc.juzAt(300).number).toBe(fixture.pages[299].juz);
    expect(svc.pageOf({ surah: 1, ayah: 1 })).toBe(1);
    expect(svc.pageOf({ surah: 114, ayah: 12 })).toBe(604);
    expect(svc.pageOf({ surah: 114, ayah: 13 })).toBeNull();
    expect(svc.pageOf({ surah: 0, ayah: 1 })).toBeNull();
    expect(svc.pageOf({ surah: 5, ayah: 0 })).toBeNull();
  });

  it('maps a verse spanning two pages to the first page', async () => {
    await svc.load();
    expect(svc.pageOf(fixture.pages[10].first)).toBe(10);
  });

  it('every ayah resolves to a page whose range contains it', async () => {
    await svc.load();
    for (const s of [1, 2, 57, 114]) {
      for (let a = 1; a <= 12; a++) {
        const m = svc.pageMeta(svc.pageOf({ surah: s, ayah: a })!);
        const k = s * 1000 + a;
        expect(m.first.surah * 1000 + m.first.ayah).toBeLessThanOrEqual(k);
        expect(m.last.surah * 1000 + m.last.ayah).toBeGreaterThanOrEqual(k);
      }
    }
  });

  it('sets an Indonesian loadError when metadata fails, then recovers on retry', async () => {
    web.failMetadata = true;
    await svc.load();
    expect(svc.index()).toBeNull();
    expect(svc.loadError()).toMatch(/gagal dimuat/i);
    web.failMetadata = false;
    await svc.load();
    expect(svc.index()).not.toBeNull();
    expect(svc.loadError()).toBeNull();
  });

  it('fetches, verifies, caches and returns a fresh clone each call', async () => {
    const a = await svc.getPage(3);
    const b = await svc.getPage(3);
    expect(a).not.toBe(b);
    expect(a.getAttribute('viewBox')).toBe('0 0 345 550');
    expect(a.ownerDocument).toBe(document);
    expect(web.requests.filter((u) => u.includes('svg/003.svg')).length).toBe(1);
    expect(await svc.isPageAvailableOffline(3)).toBe(true);
    expect(await svc.isPageAvailableOffline(4)).toBe(false);
    expect(web.requests.find((u) => u.includes('svg/003.svg'))).toBe(pageUrl(3, TEST_VERSION));
  });

  it('dedupes concurrent requests for the same page', async () => {
    await Promise.all([svc.getPage(7), svc.getPage(7), svc.getPage(7)]);
    expect(web.requests.filter((u) => u.includes('svg/007.svg')).length).toBe(1);
  });

  it('serves from Cache Storage without network in a new instance', async () => {
    await svc.getPage(9);
    await svc.settled();
    const svc2 = freshService();
    web.requests.length = 0;
    await svc2.getPage(9);
    expect(web.requests.some((u) => u.includes('svg/009.svg'))).toBe(false);
  });

  it('rejects a sha256 mismatch as integrity and does not cache it', async () => {
    web.tamper.set(5, fixture.svg.get(5)!.replace('M0 0Z', 'M1 1Z'));
    expect(await kindOf(svc.getPage(5))).toBe('integrity');
    expect(await svc.isPageAvailableOffline(5)).toBe(false);
  });

  it('heals a corrupted cache entry by refetching', async () => {
    await svc.load();
    web.caches.cache().entries.set(pageUrl(6, TEST_VERSION), {
      buf: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>').buffer as ArrayBuffer,
      headers: new Headers(),
    });
    const el = await svc.getPage(6);
    expect(el.querySelector('#p6')).not.toBeNull();
  });

  it('rejects svg with scripts, event handlers or foreignObject (integrity)', async () => {
    const bodies: [number, string][] = [
      [11, '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'],
      [12, '<svg xmlns="http://www.w3.org/2000/svg"><path onclick="x()"/></svg>'],
      [13, '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>'],
    ];
    for (const [page, body] of bodies) {
      const buf = new TextEncoder().encode(body);
      fixture.manifest.files[`svg/0${page}.svg`] = {
        sha256: await sha256Hex(buf.buffer as ArrayBuffer),
        bytes: buf.length,
      };
      web.tamper.set(page, body);
      expect(await kindOf(svc.getPage(page))).toBe('integrity');
    }
  });

  it('reports offline when not cached and offline', async () => {
    await svc.load();
    setOnline(false);
    expect(await kindOf(svc.getPage(20))).toBe('offline');
  });

  it('serves cached pages while offline', async () => {
    await svc.getPage(21);
    await svc.settled();
    setOnline(false);
    const svc2 = freshService();
    await expect(svc2.getPage(21)).resolves.toBeTruthy();
  });

  it('maps 404 to not-found, 500 and fetch failure to network', async () => {
    web.status.set(30, 404);
    web.status.set(31, 500);
    expect(await kindOf(svc.getPage(30))).toBe('not-found');
    expect(await kindOf(svc.getPage(31))).toBe('network');
    web.throwNetwork = false;
    await svc.load();
    web.throwNetwork = true;
    expect(await kindOf(svc.getPage(32))).toBe('network');
    expect(await kindOf(svc.getPage(0))).toBe('not-found');
  });

  it('bounds the automatic cache with an LRU of autoCacheLimit pages', async () => {
    for (let p = 1; p <= 63; p++) await svc.getPage(p);
    await svc.settled();
    const cache = web.caches.cache();
    expect(cache.entries.size).toBe(60);
    expect(cache.entries.has(pageUrl(3, TEST_VERSION))).toBe(false);
    expect(cache.entries.has(pageUrl(4, TEST_VERSION))).toBe(true);
    expect(cache.entries.has(pageUrl(63, TEST_VERSION))).toBe(true);
    const lru = (await db.meta.get('pageLru'))!.value as number[];
    expect(lru.length).toBe(60);
    expect(lru.at(-1)).toBe(63);
  });

  it('does not evict when the offline package is pinned', async () => {
    await db.meta.put({
      key: 'offlinePackage',
      value: { pinned: true, contentVersion: TEST_VERSION },
    });
    for (let p = 1; p <= 63; p++) await svc.getPage(p);
    await svc.settled();
    expect(web.caches.cache().entries.size).toBe(63);
  });

  it('deletes caches of older content versions on load', async () => {
    await web.caches.open('mushaf-pages-old');
    await web.caches.open('unrelated-cache');
    await svc.load();
    await new Promise((r) => setTimeout(r, 30));
    const names = await web.caches.keys();
    expect(names).not.toContain('mushaf-pages-old');
    expect(names).toContain('unrelated-cache');
  });

  it('prefetch skips when offline and fetches in the background otherwise', async () => {
    await svc.load();
    setOnline(false);
    svc.prefetch([40, 41]);
    await new Promise((r) => setTimeout(r, 300));
    expect(web.requests.some((u) => u.includes('svg/040.svg'))).toBe(false);
    setOnline(true);
    svc.prefetch([40, 41]);
    await new Promise((r) => setTimeout(r, 500));
    expect(web.requests.some((u) => u.includes('svg/040.svg'))).toBe(true);
    expect(web.requests.some((u) => u.includes('svg/041.svg'))).toBe(true);
  });
});

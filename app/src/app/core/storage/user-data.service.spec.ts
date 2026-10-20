import { installFakeIndexedDb } from './testing';
import { TestBed } from '@angular/core/testing';
import { UserDataService } from './user-data.service';
import { MUSHAF_DB } from './db-token';
import { MushafDb } from './db';
import { DEFAULT_PREFERENCES, ExportFile } from '../models';

installFakeIndexedDb();

describe('UserDataService', () => {
  let db: MushafDb;
  let svc: UserDataService;

  const create = async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: MUSHAF_DB, useValue: db }] });
    svc = TestBed.inject(UserDataService);
    await svc.init();
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

  beforeEach(async () => {
    db = new MushafDb('test-' + Math.random());
    await create();
  });

  afterEach(async () => {
    await svc.flushPosition();
    await svc.idle();
    vi.useRealTimers();
    // DB is intentionally left open: each test uses a fresh random name in a fresh fake
    // IDBFactory, and closing it raced with pending Dexie work on CI (DatabaseClosedError).
  });

  describe('init', () => {
    it('creates a persistent deviceId and default prefs', async () => {
      expect(svc.ready()).toBe(true);
      const id = svc.deviceId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(svc.prefs().paperTheme).toBe(DEFAULT_PREFERENCES.paperTheme);
      expect(svc.position()).toBeNull();
      await create();
      expect(svc.deviceId()).toBe(id);
    });

    it('persists prefs across instances', async () => {
      await svc.setPrefs({ uiTheme: 'samudra', onboardingDone: true });
      await create();
      expect(svc.prefs().uiTheme).toBe('samudra');
      expect(svc.prefs().onboardingDone).toBe(true);
      expect(svc.prefs().updatedAt).toBeGreaterThan(0);
    });
  });

  describe('bookmarks', () => {
    it('toggles page bookmarks and keeps one active per key', async () => {
      expect(await svc.togglePageBookmark(5)).toBe('added');
      expect(svc.isPageBookmarked(5)).toBe(true);
      expect(svc.bookmarks().length).toBe(1);
      expect(await svc.togglePageBookmark(5)).toBe('removed');
      expect(svc.isPageBookmarked(5)).toBe(false);
      expect(svc.bookmarks().length).toBe(0);
    });

    it('re-adding after delete creates a NEW id and tombstones remain', async () => {
      await svc.togglePageBookmark(5);
      const first = svc.bookmarks()[0].id;
      await svc.togglePageBookmark(5);
      await svc.togglePageBookmark(5);
      expect(svc.bookmarks()[0].id).not.toBe(first);
      expect(await db.bookmarks.count()).toBe(2);
      expect((await db.bookmarks.get(first))!.deletedAt).not.toBeNull();
    });

    it('concurrent toggles never produce duplicates', async () => {
      await Promise.all([
        svc.toggleVerseBookmark({ surah: 2, ayah: 255 }, 42),
        svc.toggleVerseBookmark({ surah: 2, ayah: 255 }, 42),
        svc.toggleVerseBookmark({ surah: 2, ayah: 255 }, 42),
      ]);
      expect(svc.bookmarks().length).toBe(1);
    });

    it('verse bookmarks store page + key', async () => {
      await svc.toggleVerseBookmark({ surah: 2, ayah: 255 }, 42);
      const b = svc.bookmarks()[0];
      expect(b).toMatchObject({
        kind: 'verse',
        page: 42,
        surah: 2,
        ayah: 255,
        key: 'hafs-kfqc|verse|2:255',
      });
      expect(svc.isVerseBookmarked({ surah: 2, ayah: 255 })).toBe(true);
      expect(svc.isVerseBookmarked({ surah: 2, ayah: 256 })).toBe(false);
    });

    it('rejects invalid pages', async () => {
      await expect(svc.togglePageBookmark(0)).rejects.toThrow();
      await expect(svc.toggleVerseBookmark({ surah: 1, ayah: 1 }, 605)).rejects.toThrow();
    });

    it('removeBookmark returns an undo that restores it', async () => {
      await svc.togglePageBookmark(9);
      const id = svc.bookmarks()[0].id;
      const undo = await svc.removeBookmark(id);
      expect(svc.bookmarks().length).toBe(0);
      await undo();
      expect(svc.bookmarks().map((b) => b.id)).toEqual([id]);
      expect((await db.bookmarks.get(id))!.deletedAt).toBeNull();
    });

    it('undo is a no-op after the 6 s window or when a new bookmark took its place', async () => {
      await svc.togglePageBookmark(9);
      const id = svc.bookmarks()[0].id;
      vi.useFakeTimers({ toFake: ['Date'] });
      const undo = await svc.removeBookmark(id);
      vi.setSystemTime(Date.now() + 7000);
      await undo();
      expect(svc.bookmarks().length).toBe(0);
      vi.useRealTimers();

      const undo2Source = await svc.togglePageBookmark(9); // new bookmark, new id
      expect(undo2Source).toBe('added');
      const newId = svc.bookmarks()[0].id;
      const undo3 = await svc.removeBookmark(newId);
      await svc.togglePageBookmark(9);
      await undo3();
      expect(svc.bookmarks().length).toBe(1);
      expect(svc.bookmarks()[0].id).not.toBe(newId);
    });

    it('removing an unknown id is harmless', async () => {
      const undo = await svc.removeBookmark('nope');
      await undo();
      expect(svc.bookmarks().length).toBe(0);
    });
  });

  describe('outbox', () => {
    it('does not enqueue when sync is disabled or has no account', async () => {
      await svc.togglePageBookmark(1);
      await svc.setPrefs({ uiTheme: 'ceria' });
      await db.sync.put({
        key: 'state',
        enabled: false,
        accountId: 'acc1',
        cursor: 0,
        lastSuccessAt: null,
        status: 'off',
        lastErrorCode: null,
      });
      await svc.togglePageBookmark(2);
      expect(await db.outbox.count()).toBe(0);
    });

    it('enqueues bookmark upsert/delete with payload shapes when sync is enabled', async () => {
      await enableSync();
      await svc.toggleVerseBookmark({ surah: 3, ayah: 4 }, 50);
      let ops = await db.outbox.toArray();
      expect(ops.length).toBe(1);
      expect(ops[0]).toMatchObject({
        accountId: 'acc1',
        entity: 'bookmark',
        action: 'upsert',
        baseRev: null,
        retryCount: 0,
      });
      expect(ops[0].entityId).toBe(svc.bookmarks()[0].id);
      expect(Object.keys(ops[0].payload as object).sort()).toEqual(
        ['ayah', 'createdAt', 'editionId', 'folderId', 'key', 'kind', 'note', 'page', 'surah', 'updatedAt'].sort(),
      );

      // Coalesced into a single delete op for the same entity.
      await svc.togglePageBookmark(1); // other entity
      await svc.removeBookmark(svc.bookmarks().find((b) => b.kind === 'verse')!.id);
      ops = await db.outbox.toArray();
      expect(ops.filter((o) => o.entity === 'bookmark').length).toBe(2);
      expect(ops.filter((o) => o.action === 'delete').length).toBe(1);
    });

    it('uses the current rev as baseRev and coalesces undo over delete', async () => {
      await enableSync();
      await svc.togglePageBookmark(7);
      const id = svc.bookmarks()[0].id;
      await db.bookmarks.update(id, { rev: 4 });
      const undo = await svc.removeBookmark(id);
      let ops = await db.outbox.filter((o) => o.entityId === id).toArray();
      expect(ops.length).toBe(1);
      expect(ops[0]).toMatchObject({ action: 'delete', baseRev: 4 });
      await undo();
      ops = await db.outbox.filter((o) => o.entityId === id).toArray();
      expect(ops.length).toBe(1);
      expect(ops[0]).toMatchObject({ action: 'upsert', baseRev: 4 });
    });

    it('enqueues prefs only when a synced field changes', async () => {
      await enableSync();
      await svc.setPrefs({ onboardingDone: true });
      expect(await db.outbox.count()).toBe(0);
      await svc.setPrefs({ paperTheme: 'antique' });
      await svc.setPrefs({ highContrast: true });
      const ops = await db.outbox.toArray();
      expect(ops.length).toBe(1);
      expect(ops[0]).toMatchObject({ entity: 'prefs', entityId: 'prefs', action: 'upsert' });
      expect(ops[0].payload).toMatchObject({ paperTheme: 'antique', highContrast: true });
      expect(ops[0].payload).not.toHaveProperty('onboardingDone');
    });

    it('keeps at most one pending position op', async () => {
      await enableSync();
      for (const p of [10, 11, 12]) {
        svc.savePosition(p, { surah: 2, ayah: p });
        await svc.flushPosition();
      }
      const ops = await db.outbox.toArray();
      expect(ops.length).toBe(1);
      expect(ops[0]).toMatchObject({ entity: 'position', entityId: 'hafs-kfqc', action: 'upsert' });
      expect(ops[0].payload).toMatchObject({
        editionId: 'hafs-kfqc',
        page: 12,
        surah: 2,
        ayah: 12,
        deviceId: svc.deviceId(),
      });
    });
  });

  describe('position', () => {
    it('reflects the new page immediately while the write is throttled', async () => {
      svc.savePosition(5);
      await svc.flushPosition();
      svc.savePosition(6);
      expect(svc.position()?.page).toBe(6);
      await svc.reload();
      expect(svc.position()?.page).toBe(6);
      expect((await db.positions.get('hafs-kfqc'))!.page).toBe(5);
      await svc.flushPosition();
      expect((await db.positions.get('hafs-kfqc'))!.page).toBe(6);
    });

    it('ignores invalid pages', async () => {
      svc.savePosition(0);
      svc.savePosition(605);
      svc.savePosition(1.5);
      await svc.flushPosition();
      expect(await db.positions.count()).toBe(0);
    });

    it('writes immediately first, then throttles to >= 2 s', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      svc.savePosition(5);
      await svc.flushPosition();
      expect((await db.positions.get('hafs-kfqc'))!.page).toBe(5);

      svc.savePosition(6);
      svc.savePosition(7, { surah: 2, ayah: 3 });
      await vi.advanceTimersByTimeAsync(1000);
      await svc.reload();
      expect((await db.positions.get('hafs-kfqc'))!.page).toBe(5);
      await vi.advanceTimersByTimeAsync(1100);
      await svc.flushPosition();
      const row = (await db.positions.get('hafs-kfqc'))!;
      expect(row.page).toBe(7);
      expect(row).toMatchObject({ surah: 2, ayah: 3, deviceId: svc.deviceId() });
      expect(svc.position()?.page).toBe(7);
    });

    it('flushes pending position on visibilitychange hidden and pagehide', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      svc.savePosition(5);
      await svc.flushPosition();
      svc.savePosition(8);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await svc.flushPosition();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      expect((await db.positions.get('hafs-kfqc'))!.page).toBe(8);

      svc.savePosition(9);
      window.dispatchEvent(new Event('pagehide'));
      await svc.flushPosition();
      expect((await db.positions.get('hafs-kfqc'))!.page).toBe(9);
    });
  });

  describe('export / import', () => {
    const validFile = (over: Partial<Record<string, unknown>> = {}): ExportFile =>
      ({
        format: 'mushaf-digital-export',
        version: 1,
        exportedAt: 1,
        editionId: 'hafs-kfqc',
        bookmarks: [
          { kind: 'page', page: 3, surah: null, ayah: null, createdAt: 10, updatedAt: 10 },
          { kind: 'verse', page: 42, surah: 2, ayah: 255, createdAt: 11, updatedAt: 11 },
        ],
        position: { page: 77, surah: 4, ayah: 1, updatedAt: 5 },
        preferences: { ...DEFAULT_PREFERENCES, uiTheme: 'klasik' },
        ...over,
      }) as unknown as ExportFile;

    const fileOf = (data: unknown, raw?: string) =>
      new File([raw ?? JSON.stringify(data)], 'export.json', { type: 'application/json' });

    it('round-trips bookmarks through export and import', async () => {
      await svc.togglePageBookmark(3);
      await svc.toggleVerseBookmark({ surah: 2, ayah: 255 }, 42);
      svc.savePosition(30);
      const blob = await svc.exportJson();
      const text = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsText(blob);
      });
      const parsed = JSON.parse(text) as ExportFile;
      expect(parsed.format).toBe('mushaf-digital-export');
      expect(parsed.version).toBe(2);
      expect(parsed.bookmarks.length).toBe(2);
      expect(parsed.position?.page).toBe(30);

      db.close();
      db = new MushafDb('test-' + Math.random());
      await create();
      const res = await svc.importJson(fileOf(null, text));
      expect(res).toEqual({ added: 2, skipped: 0 });
      expect(svc.bookmarks().length).toBe(2);
      expect(svc.position()?.page).toBe(30);
    });

    it('merges by semantic key and skips duplicates', async () => {
      await svc.togglePageBookmark(3);
      const res = await svc.importJson(fileOf(validFile()));
      expect(res).toEqual({ added: 1, skipped: 1 });
      expect(svc.bookmarks().length).toBe(2);
      const again = await svc.importJson(fileOf(validFile()));
      expect(again).toEqual({ added: 0, skipped: 2 });
    });

    it('does not override a newer local position, and restores prefs only on a pristine device', async () => {
      svc.savePosition(100);
      await svc.flushPosition();
      await svc.importJson(fileOf(validFile()));
      expect(svc.position()?.page).toBe(100);
      expect(svc.prefs().uiTheme).toBe('klasik'); // pristine → restored
      await svc.setPrefs({ uiTheme: 'ceria' });
      await svc.importJson(fileOf(validFile()));
      expect(svc.prefs().uiTheme).toBe('ceria'); // customised → kept
    });

    it('enqueues outbox ops for imported data when sync is enabled', async () => {
      await enableSync();
      await svc.importJson(fileOf(validFile()));
      const ops = await db.outbox.toArray();
      expect(ops.filter((o) => o.entity === 'bookmark').length).toBe(2);
      expect(ops.filter((o) => o.entity === 'position').length).toBe(1);
    });

    const rejects: [string, () => File, RegExp][] = [
      ['not JSON', () => fileOf(null, '{nope'), /JSON/],
      ['wrong format', () => fileOf({ format: 'x' }), /bukan ekspor/],
      ['wrong version', () => fileOf(validFile({ version: 3 })), /Versi/],
      ['wrong edition', () => fileOf(validFile({ editionId: 'other' })), /Edisi/],
      ['missing bookmarks', () => fileOf(validFile({ bookmarks: 'x' })), /penanda/],
      [
        'page out of range',
        () => fileOf(validFile({ bookmarks: [{ kind: 'page', page: 605, createdAt: 1 }] })),
        /1–604/,
      ],
      [
        'surah out of range',
        () =>
          fileOf(
            validFile({
              bookmarks: [{ kind: 'verse', page: 1, surah: 115, ayah: 1, createdAt: 1 }],
            }),
          ),
        /1–114/,
      ],
      [
        'ayah < 1',
        () =>
          fileOf(
            validFile({ bookmarks: [{ kind: 'verse', page: 1, surah: 1, ayah: 0, createdAt: 1 }] }),
          ),
        /ayat/,
      ],
      [
        'bad kind',
        () => fileOf(validFile({ bookmarks: [{ kind: 'zzz', page: 1, createdAt: 1 }] })),
        /jenis/,
      ],
      ['bad position', () => fileOf(validFile({ position: { page: 0, updatedAt: 1 } })), /posisi/],
      [
        'bad prefs',
        () => fileOf(validFile({ preferences: { ...DEFAULT_PREFERENCES, uiTheme: 'neon' } })),
        /pengaturan/,
      ],
      ['too large', () => fileOf(null, ' '.repeat(2 * 1024 * 1024 + 1)), /2 MB/],
    ];
    for (const [name, make, msg] of rejects) {
      it('rejects ' + name + ' with an Indonesian message and writes nothing', async () => {
        await expect(svc.importJson(make())).rejects.toThrow(msg);
        expect(await db.bookmarks.count()).toBe(0);
      });
    }
  });
});

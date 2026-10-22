import Dexie from 'dexie';
import { TestBed } from '@angular/core/testing';
import { installFakeIndexedDb } from './testing';
import { UserDataService } from './user-data.service';
import { MUSHAF_DB } from './db-token';
import { MushafDb } from './db';
import { BOOKMARK_NOTE_MAX, DEFAULT_PREFERENCES, FOLDER_LIMIT, FOLDER_NAME_MAX } from '../models';

installFakeIndexedDb();

const read = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob);
  });

describe('UserDataService folders & bookmark management', () => {
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

  const addPages = async (...pages: number[]) => {
    for (const p of pages) await svc.togglePageBookmark(p);
    return svc.bookmarks();
  };

  beforeEach(async () => {
    db = new MushafDb('test-' + Math.random());
    await create();
  });

  afterEach(async () => {
    await svc.idle();
    vi.useRealTimers();
    db.close();
  });

  describe('folder CRUD', () => {
    it('creates, trims and naturally sorts folders', async () => {
      await svc.createFolder('  Khatam ke-10 ');
      await svc.createFolder('Khatam ke-2');
      await svc.createFolder('Khatam ke-1');
      expect(svc.folders().map((f) => f.name)).toEqual([
        'Khatam ke-1',
        'Khatam ke-2',
        'Khatam ke-10',
      ]);
      const f = svc.folders()[0];
      expect(f).toMatchObject({ deletedAt: null, rev: null });
    });

    it('validates names with Indonesian messages', async () => {
      await expect(svc.createFolder('   ')).rejects.toThrow('Nama folder tidak boleh kosong.');
      await expect(svc.createFolder('x'.repeat(FOLDER_NAME_MAX + 1))).rejects.toThrow(
        /maksimal 40 karakter/,
      );
      await svc.createFolder('Ramadhan 1447');
      await expect(svc.createFolder('ramadhan 1447')).rejects.toThrow('Nama folder sudah dipakai.');
      await expect(svc.renameFolder('nope', 'X')).rejects.toThrow('Folder tidak ditemukan.');
    });

    it('enforces the folder limit', async () => {
      const now = Date.now();
      await db.folders.bulkAdd(
        Array.from({ length: FOLDER_LIMIT }, (_, i) => ({
          id: 'f' + i,
          name: 'F' + i,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          rev: null,
          archivedAt: null,
        })),
      );
      await expect(svc.createFolder('Lagi')).rejects.toThrow(/maksimal 100/);
    });

    it('renames; allows case change of itself, rejects taken names', async () => {
      const a = await svc.createFolder('Satu');
      await svc.createFolder('Dua');
      await svc.renameFolder(a.id, 'SATU');
      expect(svc.folders().map((f) => f.name)).toContain('SATU');
      await expect(svc.renameFolder(a.id, 'dua')).rejects.toThrow('Nama folder sudah dipakai.');
      await expect(svc.renameFolder(a.id, '')).rejects.toThrow('tidak boleh kosong');
    });

    it('new bookmarks start with folderId null and note null', async () => {
      const [b] = await addPages(4);
      expect(b.folderId).toBeNull();
      expect(b.note).toBeNull();
    });

    it('reload() loads folders', async () => {
      await svc.createFolder('Sementara');
      await create();
      expect(svc.folders().map((f) => f.name)).toEqual(['Sementara']);
    });
  });

  describe('bulk move / remove', () => {
    it('moves several bookmarks in one go; unknown ids ignored; bad folder rejected', async () => {
      const f = await svc.createFolder('Khatam 1');
      const bs = await addPages(1, 2, 3);
      await svc.moveBookmarks([bs[0].id, bs[1].id, 'ghost'], f.id);
      expect(svc.bookmarks().filter((b) => b.folderId === f.id).length).toBe(2);
      await svc.moveBookmarks(
        bs.map((b) => b.id),
        null,
      );
      expect(svc.bookmarks().every((b) => b.folderId === null)).toBe(true);
      await expect(svc.moveBookmarks([bs[0].id], 'nope')).rejects.toThrow(
        'Folder tidak ditemukan.',
      );
    });

    it('removeBookmarks soft-deletes all and undo restores exact folderId', async () => {
      const f = await svc.createFolder('K');
      const bs = await addPages(1, 2, 3);
      await svc.moveBookmarks([bs[0].id], f.id);
      const ids = bs.map((b) => b.id);
      const undo = await svc.removeBookmarks(ids);
      expect(svc.bookmarks().length).toBe(0);
      await undo();
      expect(svc.bookmarks().length).toBe(3);
      expect(svc.bookmarks().find((b) => b.id === bs[0].id)!.folderId).toBe(f.id);
      expect(svc.bookmarks().filter((b) => b.deletedAt !== null).length).toBe(0);
    });

    it('bulk undo expires after 6 s', async () => {
      const bs = await addPages(1, 2);
      vi.useFakeTimers({ toFake: ['Date'] });
      const undo = await svc.removeBookmarks(bs.map((b) => b.id));
      vi.setSystemTime(Date.now() + 7000);
      await undo();
      expect(svc.bookmarks().length).toBe(0);
    });
  });

  describe('deleteFolder', () => {
    it('moves bookmarks to no folder by default and undo restores them', async () => {
      const f = await svc.createFolder('K');
      const bs = await addPages(1, 2);
      await svc.moveBookmarks(
        bs.map((b) => b.id),
        f.id,
      );
      const undo = await svc.deleteFolder(f.id);
      expect(svc.folders().length).toBe(0);
      expect(svc.bookmarks().length).toBe(2);
      expect(svc.bookmarks().every((b) => b.folderId === null)).toBe(true);
      await undo();
      expect(svc.folders().map((x) => x.id)).toEqual([f.id]);
      expect(svc.bookmarks().every((b) => b.folderId === f.id)).toBe(true);
    });

    it('with deleteBookmarks tombstones them too and undo brings everything back', async () => {
      const f = await svc.createFolder('K');
      const bs = await addPages(1, 2, 3);
      await svc.moveBookmarks([bs[0].id, bs[1].id], f.id);
      const undo = await svc.deleteFolder(f.id, { deleteBookmarks: true });
      expect(svc.bookmarks().length).toBe(1);
      await undo();
      expect(svc.bookmarks().length).toBe(3);
      expect(svc.bookmarks().filter((b) => b.folderId === f.id).length).toBe(2);
    });

    it('deleting an empty folder works; unknown folder rejects; undo skipped if name reused', async () => {
      const f = await svc.createFolder('Kosong');
      const undo = await svc.deleteFolder(f.id);
      await svc.createFolder('kosong');
      await undo();
      expect(svc.folders().length).toBe(1);
      expect(svc.folders()[0].id).not.toBe(f.id);
      await expect(svc.deleteFolder('nope')).rejects.toThrow('Folder tidak ditemukan.');
    });
  });

  describe('notes', () => {
    it('trims, clears and limits notes', async () => {
      const [b] = await addPages(8);
      await svc.setBookmarkNote(b.id, '  halaman favorit  ');
      expect(svc.bookmarks()[0].note).toBe('halaman favorit');
      await svc.setBookmarkNote(b.id, '   ');
      expect(svc.bookmarks()[0].note).toBeNull();
      await svc.setBookmarkNote(b.id, 'x'.repeat(BOOKMARK_NOTE_MAX));
      await expect(svc.setBookmarkNote(b.id, 'x'.repeat(BOOKMARK_NOTE_MAX + 1))).rejects.toThrow(
        /maksimal 500/,
      );
      await expect(svc.setBookmarkNote('ghost', 'a')).rejects.toThrow('Penanda tidak ditemukan.');
    });
  });

  describe('outbox', () => {
    it('emits nothing when sync is off', async () => {
      const f = await svc.createFolder('K');
      const [b] = await addPages(1);
      await svc.moveBookmarks([b.id], f.id);
      await svc.setBookmarkNote(b.id, 'n');
      await svc.deleteFolder(f.id);
      expect(await db.outbox.count()).toBe(0);
    });

    it('emits one coalesced op per changed entity when sync is on', async () => {
      await enableSync();
      const f = await svc.createFolder('K');
      let ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        entity: 'folder',
        entityId: f.id,
        action: 'upsert',
        baseRev: null,
      });
      expect(Object.keys(ops[0].payload as object).sort()).toEqual([
        'archivedAt',
        'createdAt',
        'name',
        'updatedAt',
      ]);

      const bs = await addPages(1, 2, 3);
      await svc.moveBookmarks(
        bs.map((b) => b.id),
        f.id,
      );
      await svc.setBookmarkNote(bs[0].id, 'catatan');
      ops = await db.outbox.toArray();
      const bmOps = ops.filter((o) => o.entity === 'bookmark');
      expect(bmOps).toHaveLength(3); // coalesced
      const first = bmOps.find((o) => o.entityId === bs[0].id)!;
      expect(first.payload).toMatchObject({ folderId: f.id, note: 'catatan' });

      await svc.renameFolder(f.id, 'K2');
      expect(await db.outbox.filter((o) => o.entity === 'folder').toArray()).toHaveLength(1);

      await svc.deleteFolder(f.id, { deleteBookmarks: true });
      ops = await db.outbox.toArray();
      expect(ops.filter((o) => o.entity === 'folder')[0]).toMatchObject({ action: 'delete' });
      expect(ops.filter((o) => o.entity === 'bookmark').every((o) => o.action === 'delete')).toBe(
        true,
      );
    });

    it('undo re-emits upserts that replace the delete ops', async () => {
      await enableSync();
      const bs = await addPages(1, 2);
      const undo = await svc.removeBookmarks(bs.map((b) => b.id));
      expect((await db.outbox.toArray()).every((o) => o.action === 'delete')).toBe(true);
      await undo();
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(2);
      expect(ops.every((o) => o.action === 'upsert')).toBe(true);
    });
  });

  describe('Dexie v1 -> v2 upgrade', () => {
    it('keeps existing data and defaults folderId/note to null', async () => {
      const name = 'upgrade-' + Math.random();
      const old = new Dexie(name);
      old.version(1).stores({
        bookmarks: 'id, key, kind, page, updatedAt, deletedAt',
        positions: 'editionId',
        prefs: 'key',
        outbox: 'opId, accountId, nextAttemptAt, createdAt',
        sync: 'key',
        meta: 'key',
      });
      await old.table('bookmarks').add({
        id: 'old1',
        kind: 'page',
        editionId: 'hafs-kfqc',
        page: 5,
        surah: null,
        ayah: null,
        key: 'hafs-kfqc|page|5',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        rev: null,
      });
      await old.table('meta').put({ key: 'deviceId', value: 'dev-1' });
      old.close();

      const upgraded = new MushafDb(name);
      const row = (await upgraded.bookmarks.get('old1'))!;
      expect(row).toMatchObject({ page: 5, folderId: null, note: null });
      expect((await upgraded.meta.get('deviceId'))!.value).toBe('dev-1');
      expect(await upgraded.folders.count()).toBe(0);
      upgraded.close();
    });
  });

  describe('export / import v2', () => {
    const file = (data: unknown) => new File([JSON.stringify(data)], 'x.json');
    const base = (over: Record<string, unknown>) => ({
      format: 'mushaf-digital-export',
      version: 2,
      exportedAt: 1,
      editionId: 'hafs-kfqc',
      bookmarks: [],
      folders: [],
      position: null,
      preferences: { ...DEFAULT_PREFERENCES },
      ...over,
    });

    it('exports v2 with folders, folderId and note, and re-imports with remapped ids', async () => {
      const f = await svc.createFolder('Khatam 3');
      const [b] = await addPages(11);
      await svc.moveBookmarks([b.id], f.id);
      await svc.setBookmarkNote(b.id, 'penting');
      const text = await read(await svc.exportJson());
      const parsed = JSON.parse(text);
      expect(parsed.version).toBe(3);
      expect(parsed.folders).toHaveLength(1);
      expect(parsed.bookmarks[0]).toMatchObject({ folderId: f.id, note: 'penting' });

      db.close();
      db = new MushafDb('test-' + Math.random());
      await create();
      const res = await svc.importJson(file(parsed));
      expect(res).toEqual({ added: 1, skipped: 0 });
      expect(svc.folders().map((x) => x.name)).toEqual(['Khatam 3']);
      const nf = svc.folders()[0];
      expect(nf.id).not.toBe(f.id);
      expect(svc.bookmarks()[0]).toMatchObject({ folderId: nf.id, note: 'penting' });
      expect(svc.bookmarks()[0].id).not.toBe(b.id);
    });

    it('merges folders by case-insensitive name and never creates duplicates', async () => {
      const existing = await svc.createFolder('Ramadhan');
      const data = base({
        folders: [
          { id: 'ff1', name: 'RAMADHAN', createdAt: 5 },
          { id: 'ff2', name: 'Baru', createdAt: 5 },
        ],
        bookmarks: [
          { kind: 'page', page: 3, createdAt: 1, folderId: 'ff1', note: ' hai ' },
          { kind: 'page', page: 4, createdAt: 1, folderId: 'ff2' },
          { kind: 'page', page: 5, createdAt: 1, folderId: 'unknown' },
        ],
      });
      await svc.importJson(file(data));
      expect(
        svc
          .folders()
          .map((x) => x.name)
          .sort(),
      ).toEqual(['Baru', 'Ramadhan']);
      const byPage = (p: number) => svc.bookmarks().find((b) => b.page === p)!;
      expect(byPage(3).folderId).toBe(existing.id);
      expect(byPage(3).note).toBe('hai');
      expect(byPage(4).folderId).toBe(svc.folders().find((x) => x.name === 'Baru')!.id);
      expect(byPage(5).folderId).toBeNull();
    });

    it('still imports v1 files (no folders, folderId/note ignored)', async () => {
      const data = base({
        version: 1,
        folders: undefined,
        bookmarks: [{ kind: 'page', page: 3, createdAt: 1, folderId: 'x', note: 'ignored' }],
      });
      const res = await svc.importJson(file(data));
      expect(res.added).toBe(1);
      expect(svc.bookmarks()[0]).toMatchObject({ folderId: null, note: null });
    });

    it('rejects invalid folders / notes / unknown versions', async () => {
      await expect(svc.importJson(file(base({ version: 4 })))).rejects.toThrow(/Versi/);
      await expect(
        svc.importJson(file(base({ folders: [{ id: 'a', name: '   ' }] }))),
      ).rejects.toThrow(/folder #1/);
      await expect(
        svc.importJson(file(base({ folders: [{ id: 'a', name: 'x'.repeat(41) }] }))),
      ).rejects.toThrow(/nama folder #1/);
      await expect(
        svc.importJson(
          file(
            base({ bookmarks: [{ kind: 'page', page: 1, createdAt: 1, note: 'x'.repeat(501) }] }),
          ),
        ),
      ).rejects.toThrow(/catatan/);
      expect(await db.bookmarks.count()).toBe(0);
      expect(await db.folders.count()).toBe(0);
    });

    it('enqueues folder + bookmark ops for imports when sync is on', async () => {
      await enableSync();
      await svc.importJson(
        file(
          base({
            folders: [{ id: 'ff1', name: 'A', createdAt: 1 }],
            bookmarks: [{ kind: 'page', page: 3, createdAt: 1, folderId: 'ff1' }],
          }),
        ),
      );
      const ops = await db.outbox.toArray();
      expect(ops.filter((o) => o.entity === 'folder')).toHaveLength(1);
      expect(ops.filter((o) => o.entity === 'bookmark')).toHaveLength(1);
    });
  });
});

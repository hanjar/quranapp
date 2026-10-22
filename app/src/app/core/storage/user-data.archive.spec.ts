import Dexie from 'dexie';
import { TestBed } from '@angular/core/testing';
import { installFakeIndexedDb } from './testing';
import { UserDataService } from './user-data.service';
import { MUSHAF_DB } from './db-token';
import { MushafDb } from './db';
import { parseExportText } from './export-file';

installFakeIndexedDb();

const read = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob);
  });

describe('UserDataService favorites and khatam archive', () => {
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
    await svc.idle();
    db.close();
  });

  describe('favorites', () => {
    it('toggles a favorite separately from the verse bookmark', async () => {
      const ref = { surah: 2, ayah: 255 };
      expect(await svc.toggleFavorite(ref, 42)).toBe('added');
      expect(svc.isFavorite(ref)).toBe(true);
      // a favorite is not "bookmarked" and is not in the Penanda list
      expect(svc.isVerseBookmarked(ref)).toBe(false);
      expect(svc.bookmarks()).toHaveLength(0);
      expect(svc.favorites()).toHaveLength(1);
      expect(svc.favorites()[0]).toMatchObject({
        kind: 'favorite',
        surah: 2,
        ayah: 255,
        page: 42,
        archivedAt: null,
        key: 'hafs-kfqc|favorite|2:255',
      });

      // the same verse can have both
      expect(await svc.toggleVerseBookmark(ref, 42)).toBe('added');
      expect(svc.isVerseBookmarked(ref)).toBe(true);
      expect(svc.isFavorite(ref)).toBe(true);
      expect(svc.bookmarks()).toHaveLength(1);

      expect(await svc.toggleFavorite(ref, 42)).toBe('removed');
      expect(svc.isFavorite(ref)).toBe(false);
      expect(svc.isVerseBookmarked(ref)).toBe(true);
    });

    it('lists favorites newest first and survives a reload', async () => {
      await svc.toggleFavorite({ surah: 1, ayah: 1 }, 1);
      await new Promise((r) => setTimeout(r, 3));
      await svc.toggleFavorite({ surah: 2, ayah: 2 }, 2);
      expect(svc.favorites().map((b) => b.surah)).toEqual([2, 1]);
      await create();
      expect(svc.favorites()).toHaveLength(2);
      expect(svc.isFavorite({ surah: 1, ayah: 1 })).toBe(true);
    });

    it('queues favorite ops with archivedAt null', async () => {
      await enableSync();
      await svc.toggleFavorite({ surah: 3, ayah: 4 }, 50);
      const ops = await db.outbox.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0].payload).toMatchObject({ kind: 'favorite', key: 'hafs-kfqc|favorite|3:4', archivedAt: null });
    });

    it('convertToFavorites moves verse bookmarks to favorites and undo restores them', async () => {
      await svc.toggleVerseBookmark({ surah: 2, ayah: 1 }, 2);
      await svc.toggleVerseBookmark({ surah: 2, ayah: 2 }, 2);
      await svc.togglePageBookmark(9);
      const ids = svc.bookmarks().map((b) => b.id); // includes the page bookmark: ignored
      const { count, undo } = await svc.convertToFavorites(ids);
      expect(count).toBe(2);
      expect(svc.favorites()).toHaveLength(2);
      expect(svc.bookmarks().map((b) => b.kind)).toEqual(['page']);
      await undo();
      expect(svc.favorites()).toHaveLength(0);
      expect(svc.bookmarks()).toHaveLength(3);
    });

    it('convertToFavorites does not duplicate an existing favorite', async () => {
      await svc.toggleFavorite({ surah: 2, ayah: 1 }, 2);
      await svc.toggleVerseBookmark({ surah: 2, ayah: 1 }, 2);
      await svc.convertToFavorites(svc.bookmarks().map((b) => b.id));
      expect(svc.favorites()).toHaveLength(1);
      expect(svc.bookmarks()).toHaveLength(0);
    });
  });

  describe('archiveCurrentBookmarks', () => {
    it('archives verse and page bookmarks into one archived folder, keeps favorites', async () => {
      await svc.togglePageBookmark(10);
      await svc.toggleVerseBookmark({ surah: 2, ayah: 5 }, 3);
      await svc.toggleFavorite({ surah: 2, ayah: 5 }, 3);
      await enableSync();
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1 · Okt 2026');
      expect(res.count).toBe(2);
      expect(res.folder).toMatchObject({ name: 'Khatam ke-1 · Okt 2026' });
      expect(res.folder!.archivedAt).toBeGreaterThan(0);

      // hidden everywhere the reader looks
      expect(svc.bookmarks()).toHaveLength(0);
      expect(svc.isPageBookmarked(10)).toBe(false);
      expect(svc.isVerseBookmarked({ surah: 2, ayah: 5 })).toBe(false);
      // favorites stay, and are not archived
      expect(svc.favorites()).toHaveLength(1);
      expect(svc.favorites()[0].archivedAt).toBeNull();
      // visible for Kelola
      expect(svc.archivedBookmarks()).toHaveLength(2);
      expect(svc.archivedFolders().map((f) => f.name)).toEqual(['Khatam ke-1 · Okt 2026']);
      expect(svc.folders()).toHaveLength(0);

      // one folder op and one op per bookmark, all carrying archivedAt
      const ops = await db.outbox.toArray();
      const folderOp = ops.find((o) => o.entity === 'folder')!;
      expect((folderOp.payload as { archivedAt: number }).archivedAt).toBe(res.folder!.archivedAt);
      const bmOps = ops.filter((o) => o.entity === 'bookmark');
      expect(bmOps).toHaveLength(2);
      for (const o of bmOps) {
        expect((o.payload as { archivedAt: number; folderId: string }).archivedAt).toBe(res.folder!.archivedAt);
        expect((o.payload as { folderId: string }).folderId).toBe(res.folder!.id);
      }
    });

    it('starts a new round clean: the same page can be bookmarked again', async () => {
      await svc.togglePageBookmark(10);
      await svc.archiveCurrentBookmarks('Khatam ke-1');
      expect(await svc.togglePageBookmark(10)).toBe('added');
      expect(svc.isPageBookmarked(10)).toBe(true);
      expect(svc.bookmarks()).toHaveLength(1);
      expect(svc.archivedBookmarks()).toHaveLength(1);
      // toggling again removes only the active one
      expect(await svc.togglePageBookmark(10)).toBe('removed');
      expect(svc.archivedBookmarks()).toHaveLength(1);
    });

    it('does nothing and creates no folder when there are no bookmarks', async () => {
      await svc.toggleFavorite({ surah: 1, ayah: 1 }, 1);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      expect(res).toMatchObject({ folder: null, count: 0 });
      expect(svc.archivedFolders()).toHaveLength(0);
    });

    it('makes the folder name unique', async () => {
      await svc.togglePageBookmark(1);
      await svc.archiveCurrentBookmarks('Khatam ke-1');
      await svc.togglePageBookmark(2);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      expect(res.folder!.name).toBe('Khatam ke-1 (2)');
    });

    it('undo puts bookmarks and their folders back and removes the empty archive folder', async () => {
      const f = await svc.createFolder('Murajaah');
      await svc.togglePageBookmark(7);
      await svc.moveBookmarks([svc.bookmarks()[0].id], f.id);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      expect(svc.bookmarks()).toHaveLength(0);
      await res.undo();
      expect(svc.bookmarks()).toHaveLength(1);
      expect(svc.bookmarks()[0].folderId).toBe(f.id);
      expect(svc.bookmarks()[0].archivedAt).toBeNull();
      expect(svc.archivedFolders()).toHaveLength(0);
      expect(svc.archivedBookmarks()).toHaveLength(0);
    });

    it('archived bookmarks cannot be moved into a folder', async () => {
      await svc.togglePageBookmark(7);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      const f = await svc.createFolder('Lain');
      await svc.moveBookmarks(svc.archivedBookmarks().map((b) => b.id), f.id);
      expect(svc.archivedBookmarks()[0].folderId).toBe(res.folder!.id);
    });
  });

  describe('unarchiveFolder', () => {
    it('restores everything and clears the folder archive flag', async () => {
      await svc.togglePageBookmark(10);
      await svc.toggleVerseBookmark({ surah: 2, ayah: 5 }, 3);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      await enableSync();
      const out = await svc.unarchiveFolder(res.folder!.id);
      expect(out).toEqual({ restored: 2, skipped: 0 });
      expect(svc.bookmarks()).toHaveLength(2);
      expect(svc.archivedBookmarks()).toHaveLength(0);
      expect(svc.archivedFolders()).toHaveLength(0);
      expect(svc.folders().map((f) => f.name)).toEqual(['Khatam ke-1']);
      const ops = await db.outbox.toArray();
      expect(ops.filter((o) => o.entity === 'bookmark').every((o) => (o.payload as { archivedAt: null }).archivedAt === null)).toBe(true);
      expect((ops.find((o) => o.entity === 'folder')!.payload as { archivedAt: null }).archivedAt).toBeNull();
    });

    it('keeps a bookmark archived when its key is taken again, and reports it', async () => {
      await svc.togglePageBookmark(10);
      await svc.togglePageBookmark(11);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      await svc.togglePageBookmark(10); // new round bookmark with the same key
      const out = await svc.unarchiveFolder(res.folder!.id);
      expect(out).toEqual({ restored: 1, skipped: 1 });
      expect(svc.bookmarks().map((b) => b.page).sort()).toEqual([10, 11]);
      expect(svc.archivedBookmarks()).toHaveLength(1);
      // the folder stays archived while something is left in it
      expect(svc.archivedFolders()).toHaveLength(1);
    });
  });

  describe('Dexie v5', () => {
    it('upgrades v4 data: archivedAt defaults to null on bookmarks and folders', async () => {
      const name = 'upgrade5-' + Math.random();
      const old = new Dexie(name);
      old.version(1).stores({
        bookmarks: 'id, key, kind, page, updatedAt, deletedAt',
        positions: 'editionId',
        prefs: 'key',
        outbox: 'opId, accountId, nextAttemptAt, createdAt',
        sync: 'key',
        meta: 'key',
      });
      old.version(2).stores({
        bookmarks: 'id, key, kind, page, updatedAt, deletedAt, folderId',
        folders: 'id, updatedAt, deletedAt',
      });
      old.version(3).stores({ readDays: 'day, updatedAt', rounds: 'id, n, startedAt' });
      old.version(4).stores({ readMarks: 'key' });
      await old.table('bookmarks').add({
        id: 'b1',
        kind: 'page',
        editionId: 'hafs-kfqc',
        page: 5,
        surah: null,
        ayah: null,
        key: 'hafs-kfqc|page|5',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        rev: 3,
        folderId: 'f1',
        note: 'x',
      });
      await old.table('folders').add({ id: 'f1', name: 'A', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 2 });
      old.close();

      const upgraded = new MushafDb(name);
      expect(await upgraded.bookmarks.get('b1')).toMatchObject({ page: 5, note: 'x', rev: 3, archivedAt: null });
      expect(await upgraded.folders.get('f1')).toMatchObject({ name: 'A', rev: 2, archivedAt: null });
      upgraded.close();
    });
  });

  describe('export / import', () => {
    it('exports v3 with favorites, archived bookmarks and archived folders, and re-imports them', async () => {
      await svc.togglePageBookmark(10);
      await svc.toggleFavorite({ surah: 2, ayah: 5 }, 3);
      const res = await svc.archiveCurrentBookmarks('Khatam ke-1');
      const text = await read(await svc.exportJson());
      const parsed = JSON.parse(text);
      expect(parsed.version).toBe(3);
      expect(parsed.bookmarks).toHaveLength(2);
      expect(parsed.folders[0]).toMatchObject({ name: 'Khatam ke-1', archivedAt: res.folder!.archivedAt });
      const pageRow = parsed.bookmarks.find((b: { kind: string }) => b.kind === 'page');
      expect(pageRow.archivedAt).toBe(res.folder!.archivedAt);

      db = new MushafDb('test-' + Math.random());
      await create();
      const out = await svc.importJson(new File([text], 'x.json'));
      expect(out).toEqual({ added: 2, skipped: 0 });
      expect(svc.favorites()).toHaveLength(1);
      expect(svc.bookmarks()).toHaveLength(0);
      expect(svc.archivedBookmarks()).toHaveLength(1);
      expect(svc.archivedFolders()[0].name).toBe('Khatam ke-1');
      // importing the same file again changes nothing
      expect(await svc.importJson(new File([text], 'x.json'))).toEqual({ added: 0, skipped: 2 });
    });

    it('rejects favorites in older file versions and never archives a favorite from a file', () => {
      const base = {
        format: 'mushaf-digital-export',
        editionId: 'hafs-kfqc',
        position: null,
        preferences: { ...JSON.parse('{"paperTheme":"sepia","uiTheme":"segar","layoutMode":"auto","controlsAlwaysVisible":true,"motion":"system","highContrast":false}') },
        folders: [],
      };
      const fav = { kind: 'favorite', page: 3, surah: 2, ayah: 5, createdAt: 1, archivedAt: 99 };
      expect(() => parseExportText(JSON.stringify({ ...base, version: 2, bookmarks: [fav] }))).toThrow(/jenis/);
      const ok = parseExportText(JSON.stringify({ ...base, version: 3, bookmarks: [fav] }));
      expect(ok.bookmarks[0]).toMatchObject({ kind: 'favorite', archivedAt: null, key: 'hafs-kfqc|favorite|2:5' });
    });
  });
});

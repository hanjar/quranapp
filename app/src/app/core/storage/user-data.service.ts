import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { APP_CONFIG } from '../config';
import { ImportResult, UserDataApi } from '../contracts';
import {
  AyahRef,
  Bookmark,
  BOOKMARK_NOTE_MAX,
  BookmarkFolder,
  bookmarkKey,
  FOLDER_LIMIT,
  FOLDER_NAME_MAX,
  DEFAULT_EDITION,
  DEFAULT_PREFERENCES,
  EditionId,
  ExportFile,
  isValidPage,
  Preferences,
  ReadingPosition,
  uuid,
} from '../models';
import { ReaderUiService } from '../reader-ui.service';
import { MUSHAF_DB } from './db-token';
import { PrefsRow } from './db';
import { devicePrefsMigrationPatch, readLegacyDevicePrefs } from './device-prefs-migration';
import { MAX_IMPORT_BYTES, parseExportText } from './export-file';
import { activeSyncAccount, enqueueOutbox } from './outbox';
import { recordStorageError } from './storage-diagnostics';
import { setErrorReportDevice } from './error-reporter';

const POSITION_THROTTLE_MS = 2000;
const UNDO_WINDOW_MS = 6000;
const EDITION: EditionId = APP_CONFIG.editionId;
/** A database that is not open after this long is held up by another tab; fail instead of hanging. */
export const DB_OPEN_TIMEOUT_MS = 8000;
export const DB_BLOCKED_MESSAGE = 'Tutup tab Mushaf Digital lain lalu muat ulang.';
export const DB_OUTDATED_MESSAGE = 'Versi baru siap di tab lain. Muat ulang halaman ini.';

export class StorageUnavailableError extends Error {
  constructor(
    message: string,
    /** blocked: another tab holds the open up; outdated: a newer schema is open elsewhere. */
    readonly kind: 'blocked' | 'outdated' = 'blocked',
  ) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

function bookmarkPayload(b: Bookmark) {
  return {
    kind: b.kind,
    editionId: b.editionId,
    page: b.page,
    surah: b.surah,
    ayah: b.ayah,
    key: b.key,
    folderId: b.folderId,
    note: b.note,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function folderPayload(f: BookmarkFolder) {
  return { name: f.name, createdAt: f.createdAt, updatedAt: f.updatedAt };
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'id', { numeric: true });
const sameName = (a: string, b: string) => a.toLocaleLowerCase('id') === b.toLocaleLowerCase('id');

function prefsPayload(p: Preferences) {
  return {
    paperTheme: p.paperTheme,
    customThemes: p.customThemes,
    uiTheme: p.uiTheme,
    layoutMode: p.layoutMode,
    controlsAlwaysVisible: p.controlsAlwaysVisible,
    motion: p.motion,
    highContrast: p.highContrast,
    dailyTarget: p.dailyTarget,
    trackProgress: p.trackProgress,
    nightMode: p.nightMode,
    nightAuto: p.nightAuto,
    nightStart: p.nightStart,
    nightEnd: p.nightEnd,
    lineRules: p.lineRules,
    showLatin: p.showLatin,
    translationScale: p.translationScale,
    audioMode: p.audioMode,
    audioFollow: p.audioFollow,
    pageRenderer: p.pageRenderer,
    updatedAt: p.updatedAt,
  };
}

function positionPayload(p: ReadingPosition) {
  return {
    editionId: p.editionId,
    page: p.page,
    surah: p.surah,
    ayah: p.ayah,
    updatedAt: p.updatedAt,
    deviceId: p.deviceId,
  };
}

function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** A write slower than this is recorded in the storage diagnostics. */
const SLOW_WRITE_MS = 2000;

@Injectable({ providedIn: 'root' })
export class UserDataService extends UserDataApi {
  private readonly db = inject(MUSHAF_DB);
  /** Aborts document/window listeners when the injector is destroyed (tests, HMR). */
  private readonly listeners = new AbortController();
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private issueShown = false;

  constructor() {
    super();
    this.db.onIssue = (kind) =>
      this.notifyIssue(kind === 'blocked' ? DB_BLOCKED_MESSAGE : DB_OUTDATED_MESSAGE, kind === 'versionchange');
  }

  private notifyIssue(message: string, reload: boolean): void {
    if (this.issueShown) return;
    this.issueShown = true;
    try {
      this.injector.get(ReaderUiService).showToast({
        message,
        duration: 60000,
        ...(reload ? { actionLabel: 'Muat ulang', action: () => location.reload() } : {}),
      });
    } catch {
      /* no UI (tests) */
    }
    setTimeout(() => (this.issueShown = false), 15000);
  }

  /** Resolves once IndexedDB is open; rejects (never hangs) when another tab holds it up. */
  private async ensureOpen(): Promise<void> {
    if (this.db.isOpen()) return;
    if (this.db.outdated) throw new StorageUnavailableError(DB_OUTDATED_MESSAGE, 'outdated');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.db.open(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StorageUnavailableError(DB_BLOCKED_MESSAGE)), DB_OPEN_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      if (e instanceof StorageUnavailableError) this.notifyIssue(e.message, false);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private readonly _ready = signal(false);
  private readonly _deviceId = signal('');
  private readonly _prefs = signal<Preferences>({ ...DEFAULT_PREFERENCES });
  private readonly _position = signal<ReadingPosition | null>(null);
  private readonly _bookmarks = signal<Bookmark[]>([]);
  private readonly _folders = signal<BookmarkFolder[]>([]);

  readonly ready = this._ready.asReadonly();
  readonly deviceId = this._deviceId.asReadonly();
  readonly prefs = this._prefs.asReadonly();
  readonly position = this._position.asReadonly();
  readonly bookmarks = this._bookmarks.asReadonly();
  readonly folders = this._folders.asReadonly();

  private readonly keys = computed(() => new Set(this._bookmarks().map((b) => b.key)));

  private initPromise: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private pendingPos: { page: number; surah: number | null; ayah: number | null } | null = null;
  private lastPosWrite = 0;
  private posTimer: ReturnType<typeof setTimeout> | null = null;

  private get tables() {
    const d = this.db;
    return [d.bookmarks, d.folders, d.positions, d.prefs, d.outbox, d.sync, d.meta];
  }

  /** Serializes all writes so read-modify-write sequences never interleave. */
  private serial<T>(fn: () => Promise<T>, op = 'write', lane: 'main' | 'position' = 'main'): Promise<T> {
    const t0 = Date.now();
    let tQueued = 0;
    let tOpen = 0;
    let before = '';
    const run = (lane === 'main' ? this.chain : this.posChain)
      .then(() => {
        tQueued = Date.now();
        before = this.lastOp;
        return this.ensureOpen();
      })
      .then(() => {
        tOpen = Date.now();
        this.lastOp = op;
        return fn();
      })
      .then((v) => {
        // Slow writes are recorded too (sent with Masukan) to find what blocks them.
        const done = Date.now();
        if (done - t0 > SLOW_WRITE_MS) {
          const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';
          const slow = new Error(
            `antre ${sec(tQueued - t0)} (setelah ${before || '-'}), buka DB ${sec(tOpen - tQueued)}, tulis ${sec(done - tOpen)}`,
          );
          slow.name = 'SlowWrite';
          recordStorageError(op, slow);
        }
        return v;
      })
      .catch((e: unknown) => {
        recordStorageError(op, e);
        throw e;
      });
    if (lane === 'main') this.chain = run.catch(() => undefined);
    else this.posChain = run.catch(() => undefined);
    return run;
  }
  private lastOp = '';
  /**
   * Reading-position writes run in their own lane: they are a single transaction that
   * only touches positions/outbox/sync, so a bookmark toggle never waits behind one.
   */
  private posChain: Promise<unknown> = Promise.resolve();

  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      await this.ensureOpen();
      const stored = (await this.db.meta.get('deviceId'))?.value;
      let id = typeof stored === 'string' ? stored : '';
      if (!id) {
        id = uuid();
        await this.db.meta.put({ key: 'deviceId', value: id });
      }
      this._deviceId.set(id);
      setErrorReportDevice(id);
      await this.reload();
      await this.migrateMenuDefault();
      await this.migrateDevicePrefs();
    } catch {
      if (!this._deviceId()) this._deviceId.set(uuid());
    }
    if (typeof document !== 'undefined') {
      const signal = this.listeners.signal;
      this.destroyRef.onDestroy(() => this.listeners.abort());
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'hidden') this.flushQuietly();
        },
        { signal },
      );
      window.addEventListener('pagehide', () => this.flushQuietly(), { signal });
    }
    this._ready.set(true);
  }

  /**
   * One-time switch to the new default (20 Okt 2026): the reader menu stays visible.
   * Devices that stored the old default (false) are moved over once; a user who
   * turns it off afterwards keeps that choice.
   */
  private async migrateMenuDefault(): Promise<void> {
    const KEY = 'migr:menu-visible-default';
    if (await this.db.meta.get(KEY)) return;
    if (!this.prefs().controlsAlwaysVisible) {
      await this.setPrefs({ controlsAlwaysVisible: true });
    }
    await this.db.meta.put({ key: KEY, value: Date.now() });
  }

  /**
   * One-time: settings that used to live in localStorage (line rules, translation options,
   * audio options, page style) are adopted into the synced prefs so nobody loses a choice.
   */
  private async migrateDevicePrefs(): Promise<void> {
    const KEY = 'migr:device-prefs-synced';
    if (await this.db.meta.get(KEY)) return;
    const row = await this.db.prefs.get('prefs');
    const patch = devicePrefsMigrationPatch(
      row as Record<string, unknown> | undefined,
      readLegacyDevicePrefs(),
    );
    if (Object.keys(patch).length) await this.setPrefs(patch);
    await this.db.meta.put({ key: KEY, value: Date.now() });
  }

  async reload(): Promise<void> {
    const row = await this.db.prefs.get('prefs');
    this._prefs.set(row ? this.stripPrefs(row) : { ...DEFAULT_PREFERENCES });
    const stored = (await this.db.positions.get(EDITION)) ?? null;
    const pending = this.pendingPos;
    // A not-yet-flushed local page change is newer than what IndexedDB holds.
    this._position.set(pending && stored ? { ...stored, ...pending } : stored);
    await this.refreshBookmarks();
    await this.refreshFolders();
  }

  private async refreshFolders(): Promise<void> {
    const all = await this.db.folders.filter((f) => f.deletedAt === null).toArray();
    all.sort((a, b) => naturalCompare(a.name, b.name));
    this._folders.set(all);
  }

  private stripPrefs(row: PrefsRow): Preferences {
    const { key: _key, ...rest } = row;
    return { ...DEFAULT_PREFERENCES, ...rest };
  }

  private async refreshBookmarks(): Promise<void> {
    const all = await this.db.bookmarks.filter((b) => b.deletedAt === null).toArray();
    all.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
    this._bookmarks.set(all);
  }

  // ---- preferences ---------------------------------------------------------

  setPrefs(patch: Partial<Omit<Preferences, 'updatedAt' | 'rev'>>): Promise<void> {
    return this.serial(async () => {
      const next = await this.db.transaction('rw', this.tables, async () => {
        const row = await this.db.prefs.get('prefs');
        const prev = row ? this.stripPrefs(row) : { ...DEFAULT_PREFERENCES };
        const merged: Preferences = { ...prev, ...patch, updatedAt: Date.now(), rev: prev.rev };
        await this.db.prefs.put({ ...merged, key: 'prefs' });
        const account = await activeSyncAccount(this.db);
        const before = JSON.stringify({ ...prefsPayload(prev), updatedAt: 0 });
        const after = JSON.stringify({ ...prefsPayload(merged), updatedAt: 0 });
        if (account && before !== after) {
          await enqueueOutbox(
            this.db,
            account,
            'prefs',
            'prefs',
            'upsert',
            prefsPayload(merged),
            merged.rev,
          );
        }
        return merged;
      });
      this._prefs.set(next);
    }, 'prefs');
  }

  // ---- reading position ----------------------------------------------------

  savePosition(page: number, ayah?: AyahRef | null): void {
    if (!isValidPage(page)) return;
    this.pendingPos = { page, surah: ayah?.surah ?? null, ayah: ayah?.ayah ?? null };
    // The UI ("Posisi terakhir") reflects the page at once; only the IndexedDB write is throttled.
    const cur = this._position();
    this._position.set({
      editionId: EDITION,
      page,
      surah: this.pendingPos.surah,
      ayah: this.pendingPos.ayah,
      updatedAt: Date.now(),
      deviceId: this._deviceId(),
      rev: cur?.rev ?? null,
    });
    const wait = this.lastPosWrite + POSITION_THROTTLE_MS - Date.now();
    if (wait <= 0) {
      this.flushQuietly();
    } else if (this.posTimer === null) {
      this.posTimer = setTimeout(() => this.flushQuietly(), wait);
    }
  }

  /** Fire-and-forget flush: a closed database must never surface as an unhandled rejection. */
  private flushQuietly(): void {
    this.flushPosition().catch(() => undefined);
  }

  /** Resolves when all queued writes have finished (tests / teardown). */
  idle(): Promise<void> {
    return Promise.all([this.chain, this.posChain]).then(() => undefined);
  }

  flushPosition(): Promise<void> {
    if (this.posTimer !== null) {
      clearTimeout(this.posTimer);
      this.posTimer = null;
    }
    const pending = this.pendingPos;
    if (!pending) return this.posChain.then(() => undefined);
    this.pendingPos = null;
    this.lastPosWrite = Date.now();
    return this.serial(async () => {
      const next = await this.db.transaction('rw', [this.db.positions, this.db.outbox, this.db.sync], async () => {
        const existing = await this.db.positions.get(EDITION);
        const row: ReadingPosition = {
          editionId: EDITION,
          page: pending.page,
          surah: pending.surah,
          ayah: pending.ayah,
          updatedAt: Date.now(),
          deviceId: this._deviceId(),
          rev: existing?.rev ?? null,
        };
        await this.db.positions.put(row);
        const account = await activeSyncAccount(this.db);
        if (account) {
          await enqueueOutbox(
            this.db,
            account,
            'position',
            EDITION,
            'upsert',
            positionPayload(row),
            row.rev,
          );
        }
        return row;
      });
      this._position.set(next);
    }, 'position', 'position');
  }

  // ---- bookmarks -----------------------------------------------------------

  isPageBookmarked(page: number): boolean {
    return this.keys().has(bookmarkKey(DEFAULT_EDITION, 'page', { page }));
  }

  isVerseBookmarked(ref: AyahRef): boolean {
    return this.keys().has(bookmarkKey(DEFAULT_EDITION, 'verse', ref));
  }

  togglePageBookmark(page: number): Promise<'added' | 'removed'> {
    if (!isValidPage(page)) return Promise.reject(new Error('Nomor halaman tidak valid.'));
    return this.toggle('page', { page, surah: null, ayah: null });
  }

  toggleVerseBookmark(ref: AyahRef, page: number): Promise<'added' | 'removed'> {
    if (!isValidPage(page)) return Promise.reject(new Error('Nomor halaman tidak valid.'));
    return this.toggle('verse', { page, surah: ref.surah, ayah: ref.ayah });
  }

  private toggle(
    kind: Bookmark['kind'],
    t: { page: number; surah: number | null; ayah: number | null },
  ): Promise<'added' | 'removed'> {
    return this.serial(async () => {
      const key = bookmarkKey(DEFAULT_EDITION, kind, t);
      // Narrow scope: only the tables a toggle touches, so it never queues behind a
      // transaction on prefs/positions/read days.
      const scope = [this.db.bookmarks, this.db.outbox, this.db.sync];
      const result = await this.db.transaction('rw', scope, async () => {
        const account = await activeSyncAccount(this.db);
        const active = await this.db.bookmarks
          .where('key')
          .equals(key)
          .filter((b) => b.deletedAt === null)
          .first();
        const now = Date.now();
        if (active) {
          const gone: Bookmark = { ...active, deletedAt: now, updatedAt: now };
          await this.db.bookmarks.put(gone);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'bookmark',
              gone.id,
              'delete',
              bookmarkPayload(gone),
              gone.rev,
            );
          }
          return 'removed' as const;
        }
        const fresh: Bookmark = {
          id: uuid(),
          kind,
          editionId: DEFAULT_EDITION,
          page: t.page,
          surah: t.surah,
          ayah: t.ayah,
          key,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          rev: null,
          folderId: null,
          note: null,
        };
        await this.db.bookmarks.add(fresh);
        if (account) {
          await enqueueOutbox(
            this.db,
            account,
            'bookmark',
            fresh.id,
            'upsert',
            bookmarkPayload(fresh),
            null,
          );
        }
        return 'added' as const;
      });
      await this.refreshBookmarks();
      return result;
    }, 'toggle-bookmark');
  }

  removeBookmark(id: string): Promise<() => Promise<void>> {
    return this.removeBookmarks([id]);
  }

  /** Common undo wrapper: valid for UNDO_WINDOW_MS after `at`, serialized, one transaction. */
  private undoable(at: number, restore: () => Promise<void>, after: () => Promise<void>) {
    return () =>
      this.serial(async () => {
        if (Date.now() - at > UNDO_WINDOW_MS) return;
        await this.db.transaction('rw', this.tables, restore);
        await after();
      });
  }

  private async putBookmark(
    b: Bookmark,
    account: string | null,
    action: 'upsert' | 'delete',
    baseRev: number | null,
  ) {
    await this.db.bookmarks.put(b);
    if (account) {
      await enqueueOutbox(this.db, account, 'bookmark', b.id, action, bookmarkPayload(b), baseRev);
    }
  }

  private async putFolder(
    f: BookmarkFolder,
    account: string | null,
    action: 'upsert' | 'delete',
    baseRev: number | null,
  ) {
    await this.db.folders.put(f);
    if (account) {
      await enqueueOutbox(this.db, account, 'folder', f.id, action, folderPayload(f), baseRev);
    }
  }

  /** Restores previously active bookmarks to their snapshot (skips rows whose key is taken again). */
  private async restoreBookmarks(prevs: Bookmark[], account: string | null, now: number) {
    for (const prev of prevs) {
      const cur = await this.db.bookmarks.get(prev.id);
      if (!cur) continue;
      if (prev.deletedAt === null && cur.deletedAt !== null) {
        const clash = await this.db.bookmarks
          .where('key')
          .equals(prev.key)
          .filter((x) => x.deletedAt === null)
          .first();
        if (clash) continue;
      }
      await this.putBookmark({ ...prev, rev: cur.rev, updatedAt: now }, account, 'upsert', cur.rev);
    }
  }

  async removeBookmarks(ids: readonly string[]): Promise<() => Promise<void>> {
    const { prevs, at } = await this.serial(async () => {
      const out = await this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const now = Date.now();
        const prevs: Bookmark[] = [];
        for (const id of new Set(ids)) {
          const b = await this.db.bookmarks.get(id);
          if (!b || b.deletedAt !== null) continue;
          prevs.push(b);
          await this.putBookmark({ ...b, deletedAt: now, updatedAt: now }, account, 'delete', b.rev);
        }
        return { prevs, at: now };
      });
      await this.refreshBookmarks();
      return out;
    });
    if (!prevs.length) return async () => undefined;
    return this.undoable(
      at,
      async () => this.restoreBookmarks(prevs, await activeSyncAccount(this.db), Date.now()),
      () => this.refreshBookmarks(),
    );
  }

  async moveBookmarks(ids: readonly string[], folderId: string | null): Promise<void> {
    await this.serial(async () => {
      await this.db.transaction('rw', this.tables, async () => {
        if (folderId !== null) {
          const f = await this.db.folders.get(folderId);
          if (!f || f.deletedAt !== null) throw new Error('Folder tidak ditemukan.');
        }
        const account = await activeSyncAccount(this.db);
        const now = Date.now();
        for (const id of new Set(ids)) {
          const b = await this.db.bookmarks.get(id);
          if (!b || b.deletedAt !== null || b.folderId === folderId) continue;
          await this.putBookmark({ ...b, folderId, updatedAt: now }, account, 'upsert', b.rev);
        }
      });
      await this.refreshBookmarks();
    });
  }

  async setBookmarkNote(id: string, note: string | null): Promise<void> {
    const clean = note?.trim() || null;
    if (clean !== null && clean.length > BOOKMARK_NOTE_MAX) {
      throw new Error(`Catatan maksimal ${BOOKMARK_NOTE_MAX} karakter.`);
    }
    await this.serial(async () => {
      await this.db.transaction('rw', this.tables, async () => {
        const b = await this.db.bookmarks.get(id);
        if (!b || b.deletedAt !== null) throw new Error('Penanda tidak ditemukan.');
        if (b.note === clean) return;
        const account = await activeSyncAccount(this.db);
        await this.putBookmark({ ...b, note: clean, updatedAt: Date.now() }, account, 'upsert', b.rev);
      });
      await this.refreshBookmarks();
    });
  }

  // ---- folders -------------------------------------------------------------

  private cleanFolderName(name: string): string {
    const n = (name ?? '').trim();
    if (!n) throw new Error('Nama folder tidak boleh kosong.');
    if (n.length > FOLDER_NAME_MAX) {
      throw new Error(`Nama folder maksimal ${FOLDER_NAME_MAX} karakter.`);
    }
    return n;
  }

  private activeFolders(): Promise<BookmarkFolder[]> {
    return this.db.folders.filter((f) => f.deletedAt === null).toArray();
  }

  createFolder(name: string): Promise<BookmarkFolder> {
    return this.serial(async () => {
      const clean = this.cleanFolderName(name);
      const folder = await this.db.transaction('rw', this.tables, async () => {
        const active = await this.activeFolders();
        if (active.length >= FOLDER_LIMIT) {
          throw new Error(`Jumlah folder maksimal ${FOLDER_LIMIT}.`);
        }
        if (active.some((f) => sameName(f.name, clean))) throw new Error('Nama folder sudah dipakai.');
        const now = Date.now();
        const f: BookmarkFolder = {
          id: uuid(),
          name: clean,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          rev: null,
        };
        await this.putFolder(f, await activeSyncAccount(this.db), 'upsert', null);
        return f;
      });
      await this.refreshFolders();
      return folder;
    });
  }

  renameFolder(id: string, name: string): Promise<void> {
    return this.serial(async () => {
      const clean = this.cleanFolderName(name);
      await this.db.transaction('rw', this.tables, async () => {
        const f = await this.db.folders.get(id);
        if (!f || f.deletedAt !== null) throw new Error('Folder tidak ditemukan.');
        if (f.name === clean) return;
        const active = await this.activeFolders();
        if (active.some((o) => o.id !== id && sameName(o.name, clean))) {
          throw new Error('Nama folder sudah dipakai.');
        }
        await this.putFolder(
          { ...f, name: clean, updatedAt: Date.now() },
          await activeSyncAccount(this.db),
          'upsert',
          f.rev,
        );
      });
      await this.refreshFolders();
    });
  }

  async deleteFolder(
    id: string,
    opts?: { deleteBookmarks?: boolean },
  ): Promise<() => Promise<void>> {
    const removeToo = !!opts?.deleteBookmarks;
    const { folder, prevs, at } = await this.serial(async () => {
      const out = await this.db.transaction('rw', this.tables, async () => {
        const f = await this.db.folders.get(id);
        if (!f || f.deletedAt !== null) throw new Error('Folder tidak ditemukan.');
        const account = await activeSyncAccount(this.db);
        const now = Date.now();
        const prevs = await this.db.bookmarks
          .where('folderId')
          .equals(id)
          .filter((b) => b.deletedAt === null)
          .toArray();
        for (const b of prevs) {
          if (removeToo) {
            await this.putBookmark({ ...b, deletedAt: now, updatedAt: now }, account, 'delete', b.rev);
          } else {
            await this.putBookmark({ ...b, folderId: null, updatedAt: now }, account, 'upsert', b.rev);
          }
        }
        await this.putFolder({ ...f, deletedAt: now, updatedAt: now }, account, 'delete', f.rev);
        return { folder: f, prevs, at: now };
      });
      await this.refreshFolders();
      await this.refreshBookmarks();
      return out;
    });
    return this.undoable(
      at,
      async () => {
        const cur = await this.db.folders.get(id);
        if (!cur || cur.deletedAt === null) return;
        const active = await this.activeFolders();
        if (active.some((f) => sameName(f.name, folder.name))) return;
        const account = await activeSyncAccount(this.db);
        const now = Date.now();
        await this.putFolder({ ...folder, rev: cur.rev, updatedAt: now }, account, 'upsert', cur.rev);
        if (removeToo) {
          await this.restoreBookmarks(prevs, account, now);
          return;
        }
        for (const prev of prevs) {
          const b = await this.db.bookmarks.get(prev.id);
          // Only undo moves the user has not changed since.
          if (!b || b.deletedAt !== null || b.folderId !== null) continue;
          await this.putBookmark({ ...b, folderId: prev.folderId, updatedAt: now }, account, 'upsert', b.rev);
        }
      },
      async () => {
        await this.refreshFolders();
        await this.refreshBookmarks();
      },
    );
  }

  // ---- export / import -----------------------------------------------------

  async exportJson(): Promise<Blob> {
    await this.flushPosition();
    const bookmarks = await this.db.bookmarks.filter((b) => b.deletedAt === null).toArray();
    bookmarks.sort((a, b) => a.createdAt - b.createdAt);
    const file: ExportFile = {
      format: 'mushaf-digital-export',
      version: 2,
      exportedAt: Date.now(),
      editionId: DEFAULT_EDITION,
      bookmarks,
      folders: (await this.activeFolders()).sort((x, y) => naturalCompare(x.name, y.name)),
      position: (await this.db.positions.get(EDITION)) ?? null,
      preferences: this._prefs(),
    };
    return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  }

  async importJson(file: File): Promise<ImportResult> {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Berkas terlalu besar (maksimal 2 MB).');
    const parsed = parseExportText(await readText(file), file.size);

    return this.serial(async () => {
      const result = await this.db.transaction('rw', this.tables, async () => {
        const account = await activeSyncAccount(this.db);
        const existing = new Set(
          (await this.db.bookmarks.filter((b) => b.deletedAt === null).toArray()).map((b) => b.key),
        );
        // Folders: merge by case-insensitive name, never reuse ids from the file.
        const folders = await this.activeFolders();
        const folderMap = new Map<string, string>();
        for (const ff of parsed.folders) {
          let target = folders.find((f) => sameName(f.name, ff.name));
          if (!target) {
            if (folders.length >= FOLDER_LIMIT) throw new Error(`Jumlah folder maksimal ${FOLDER_LIMIT}.`);
            const now = Date.now();
            target = {
              id: uuid(),
              name: ff.name,
              createdAt: ff.createdAt || now,
              updatedAt: now,
              deletedAt: null,
              rev: null,
            };
            folders.push(target);
            await this.putFolder(target, account, 'upsert', null);
          }
          folderMap.set(ff.id, target.id);
        }
        let added = 0;
        let skipped = 0;
        for (const b of parsed.bookmarks) {
          if (existing.has(b.key)) {
            skipped++;
            continue;
          }
          existing.add(b.key);
          const row: Bookmark = {
            ...b,
            id: uuid(),
            folderId: b.folderId ? (folderMap.get(b.folderId) ?? null) : null,
          };
          await this.db.bookmarks.add(row);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'bookmark',
              row.id,
              'upsert',
              bookmarkPayload(row),
              null,
            );
          }
          added++;
        }

        const localPos = await this.db.positions.get(EDITION);
        if (parsed.position && (!localPos || parsed.position.updatedAt > localPos.updatedAt)) {
          const pos: ReadingPosition = {
            ...parsed.position,
            deviceId: this._deviceId(),
            rev: localPos?.rev ?? null,
          };
          await this.db.positions.put(pos);
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'position',
              EDITION,
              'upsert',
              positionPayload(pos),
              pos.rev,
            );
          }
        }

        // Preferences only restore onto a device that was never customised.
        const prefsRow = await this.db.prefs.get('prefs');
        if (!prefsRow || prefsRow.updatedAt === 0) {
          const merged: Preferences = {
            ...parsed.preferences,
            onboardingDone:
              parsed.preferences.onboardingDone || (prefsRow?.onboardingDone ?? false),
            updatedAt: Date.now(),
            rev: prefsRow?.rev ?? null,
          };
          await this.db.prefs.put({ ...merged, key: 'prefs' });
          if (account) {
            await enqueueOutbox(
              this.db,
              account,
              'prefs',
              'prefs',
              'upsert',
              prefsPayload(merged),
              merged.rev,
            );
          }
        }
        return { added, skipped };
      });
      await this.reload();
      return result;
    });
  }
}

import { Injectable, computed, inject, signal } from '@angular/core';
import { APP_CONFIG } from '../config';
import { ImportResult, UserDataApi } from '../contracts';
import {
  AyahRef,
  Bookmark,
  bookmarkKey,
  DEFAULT_EDITION,
  DEFAULT_PREFERENCES,
  EditionId,
  ExportFile,
  isValidPage,
  Preferences,
  ReadingPosition,
  uuid,
} from '../models';
import { MUSHAF_DB } from './db-token';
import { PrefsRow } from './db';
import { MAX_IMPORT_BYTES, parseExportText } from './export-file';
import { activeSyncAccount, enqueueOutbox } from './outbox';

const POSITION_THROTTLE_MS = 2000;
const UNDO_WINDOW_MS = 6000;
const EDITION: EditionId = APP_CONFIG.editionId;

function bookmarkPayload(b: Bookmark) {
  return {
    kind: b.kind,
    editionId: b.editionId,
    page: b.page,
    surah: b.surah,
    ayah: b.ayah,
    key: b.key,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function prefsPayload(p: Preferences) {
  return {
    paperTheme: p.paperTheme,
    uiTheme: p.uiTheme,
    layoutMode: p.layoutMode,
    controlsAlwaysVisible: p.controlsAlwaysVisible,
    motion: p.motion,
    highContrast: p.highContrast,
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

@Injectable({ providedIn: 'root' })
export class UserDataService extends UserDataApi {
  private readonly db = inject(MUSHAF_DB);

  private readonly _ready = signal(false);
  private readonly _deviceId = signal('');
  private readonly _prefs = signal<Preferences>({ ...DEFAULT_PREFERENCES });
  private readonly _position = signal<ReadingPosition | null>(null);
  private readonly _bookmarks = signal<Bookmark[]>([]);

  readonly ready = this._ready.asReadonly();
  readonly deviceId = this._deviceId.asReadonly();
  readonly prefs = this._prefs.asReadonly();
  readonly position = this._position.asReadonly();
  readonly bookmarks = this._bookmarks.asReadonly();

  private readonly keys = computed(() => new Set(this._bookmarks().map((b) => b.key)));

  private initPromise: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private pendingPos: { page: number; surah: number | null; ayah: number | null } | null = null;
  private lastPosWrite = 0;
  private posTimer: ReturnType<typeof setTimeout> | null = null;

  private get tables() {
    const d = this.db;
    return [d.bookmarks, d.positions, d.prefs, d.outbox, d.sync, d.meta];
  }

  /** Serializes all writes so read-modify-write sequences never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      const stored = (await this.db.meta.get('deviceId'))?.value;
      let id = typeof stored === 'string' ? stored : '';
      if (!id) {
        id = uuid();
        await this.db.meta.put({ key: 'deviceId', value: id });
      }
      this._deviceId.set(id);
      await this.reload();
    } catch {
      if (!this._deviceId()) this._deviceId.set(uuid());
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushQuietly();
      });
      window.addEventListener('pagehide', () => this.flushQuietly());
    }
    this._ready.set(true);
  }

  async reload(): Promise<void> {
    const row = await this.db.prefs.get('prefs');
    this._prefs.set(row ? this.stripPrefs(row) : { ...DEFAULT_PREFERENCES });
    this._position.set((await this.db.positions.get(EDITION)) ?? null);
    await this.refreshBookmarks();
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
          await enqueueOutbox(this.db, account, 'prefs', 'prefs', 'upsert', prefsPayload(merged), merged.rev);
        }
        return merged;
      });
      this._prefs.set(next);
    });
  }

  // ---- reading position ----------------------------------------------------

  savePosition(page: number, ayah?: AyahRef | null): void {
    if (!isValidPage(page)) return;
    this.pendingPos = { page, surah: ayah?.surah ?? null, ayah: ayah?.ayah ?? null };
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
    return this.chain.then(() => undefined);
  }

  flushPosition(): Promise<void> {
    if (this.posTimer !== null) {
      clearTimeout(this.posTimer);
      this.posTimer = null;
    }
    const pending = this.pendingPos;
    if (!pending) return this.chain.then(() => undefined);
    this.pendingPos = null;
    this.lastPosWrite = Date.now();
    return this.serial(async () => {
      const next = await this.db.transaction('rw', this.tables, async () => {
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
          await enqueueOutbox(this.db, account, 'position', EDITION, 'upsert', positionPayload(row), row.rev);
        }
        return row;
      });
      this._position.set(next);
    });
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
      const result = await this.db.transaction('rw', this.tables, async () => {
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
            await enqueueOutbox(this.db, account, 'bookmark', gone.id, 'delete', bookmarkPayload(gone), gone.rev);
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
        };
        await this.db.bookmarks.add(fresh);
        if (account) {
          await enqueueOutbox(this.db, account, 'bookmark', fresh.id, 'upsert', bookmarkPayload(fresh), null);
        }
        return 'added' as const;
      });
      await this.refreshBookmarks();
      return result;
    });
  }

  async removeBookmark(id: string): Promise<() => Promise<void>> {
    const removedAt = await this.serial(async () => {
      const at = await this.db.transaction('rw', this.tables, async () => {
        const b = await this.db.bookmarks.get(id);
        if (!b || b.deletedAt !== null) return null;
        const now = Date.now();
        const gone: Bookmark = { ...b, deletedAt: now, updatedAt: now };
        await this.db.bookmarks.put(gone);
        const account = await activeSyncAccount(this.db);
        if (account) {
          await enqueueOutbox(this.db, account, 'bookmark', id, 'delete', bookmarkPayload(gone), gone.rev);
        }
        return now;
      });
      await this.refreshBookmarks();
      return at;
    });
    if (removedAt === null) return async () => undefined;

    return () =>
      this.serial(async () => {
        if (Date.now() - removedAt > UNDO_WINDOW_MS) return;
        await this.db.transaction('rw', this.tables, async () => {
          const b = await this.db.bookmarks.get(id);
          if (!b || b.deletedAt === null) return;
          const clash = await this.db.bookmarks
            .where('key')
            .equals(b.key)
            .filter((x) => x.deletedAt === null)
            .first();
          if (clash) return;
          const back: Bookmark = { ...b, deletedAt: null, updatedAt: Date.now() };
          await this.db.bookmarks.put(back);
          const account = await activeSyncAccount(this.db);
          if (account) {
            await enqueueOutbox(this.db, account, 'bookmark', id, 'upsert', bookmarkPayload(back), back.rev);
          }
        });
        await this.refreshBookmarks();
      });
  }

  // ---- export / import -----------------------------------------------------

  async exportJson(): Promise<Blob> {
    await this.flushPosition();
    const bookmarks = await this.db.bookmarks.filter((b) => b.deletedAt === null).toArray();
    bookmarks.sort((a, b) => a.createdAt - b.createdAt);
    const file: ExportFile = {
      format: 'mushaf-digital-export',
      version: 1,
      exportedAt: Date.now(),
      editionId: DEFAULT_EDITION,
      bookmarks,
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
        let added = 0;
        let skipped = 0;
        for (const b of parsed.bookmarks) {
          if (existing.has(b.key)) {
            skipped++;
            continue;
          }
          existing.add(b.key);
          const row: Bookmark = { ...b, id: uuid() };
          await this.db.bookmarks.add(row);
          if (account) {
            await enqueueOutbox(this.db, account, 'bookmark', row.id, 'upsert', bookmarkPayload(row), null);
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
            await enqueueOutbox(this.db, account, 'position', EDITION, 'upsert', positionPayload(pos), pos.rev);
          }
        }

        // Preferences only restore onto a device that was never customised.
        const prefsRow = await this.db.prefs.get('prefs');
        if (!prefsRow || prefsRow.updatedAt === 0) {
          const merged: Preferences = {
            ...parsed.preferences,
            onboardingDone: parsed.preferences.onboardingDone || (prefsRow?.onboardingDone ?? false),
            updatedAt: Date.now(),
            rev: prefsRow?.rev ?? null,
          };
          await this.db.prefs.put({ ...merged, key: 'prefs' });
          if (account) {
            await enqueueOutbox(this.db, account, 'prefs', 'prefs', 'upsert', prefsPayload(merged), merged.rev);
          }
        }
        return { added, skipped };
      });
      await this.reload();
      return result;
    });
  }
}

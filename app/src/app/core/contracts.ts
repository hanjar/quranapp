import { Signal } from '@angular/core';
import {
  Account,
  AyahRef,
  Bookmark,
  BookmarkFolder,
  ContentIndex,
  JuzMeta,
  PageMeta,
  Preferences,
  ReadingPosition,
  SurahMeta,
  SyncStatus,
} from './models';

/**
 * Service contracts. Features inject these abstract classes; concrete
 * implementations are bound in app.config.ts. Abstract classes double as DI
 * tokens, so a consumer never imports an implementation file.
 */

// ---------------------------------------------------------------------------
// Content: metadata + page artwork (impl: core/content/content.service.ts)
// ---------------------------------------------------------------------------
export abstract class ContentApi {
  /** null until load() resolves. */
  abstract readonly index: Signal<ContentIndex | null>;
  /** Human-readable Indonesian error when metadata could not be loaded. */
  abstract readonly loadError: Signal<string | null>;

  /** Loads edition/surahs/pages/juz JSON. Idempotent. */
  abstract load(): Promise<void>;

  // Pure lookups — valid only after load(). Page numbers are 1–604.
  abstract pageMeta(page: number): PageMeta;
  abstract surah(number: number): SurahMeta;
  /** Primary surah shown on a page (the surah of the page's first ayah). */
  abstract surahAt(page: number): SurahMeta;
  abstract juzAt(page: number): JuzMeta;
  /** Page that contains the ayah, or null if the ref is invalid. */
  abstract pageOf(ref: AyahRef): number | null;

  /**
   * Returns a fresh, detached, sanitized-at-build SVG root for the page.
   * Reads Cache Storage first, then network (and caches the response).
   * Verifies sha256 against the manifest. Throws PageLoadError.
   */
  abstract getPage(page: number): Promise<SVGSVGElement>;
  /** Best-effort background fetch into cache; never throws. */
  abstract prefetch(pages: number[]): void;
  abstract isPageAvailableOffline(page: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Offline package management (impl: core/offline/offline.service.ts)
// ---------------------------------------------------------------------------
export type DownloadState = 'idle' | 'downloading' | 'paused' | 'done' | 'error' | 'quota';

export interface OfflineStatus {
  online: boolean;
  /** Pages present + verified in the page cache. */
  cachedPages: number;
  totalPages: number;
  /** Sum of manifest bytes for cached pages. */
  cachedBytes: number;
  /** Manifest total for all 604 pages. 0 until manifest loaded. */
  totalBytes: number;
  state: DownloadState;
  failedPages: number[];
  /** navigator.storage.persisted() result, null when unsupported. */
  persisted: boolean | null;
}

export abstract class OfflineApi {
  abstract readonly status: Signal<OfflineStatus>;
  abstract refresh(): Promise<void>;
  abstract startFullDownload(): Promise<void>;
  abstract pause(): void;
  abstract resume(): Promise<void>;
  abstract retryFailed(): Promise<void>;
  /** Deletes cached page artwork only — never bookmarks/position. */
  abstract clearPages(): Promise<void>;
}

// ---------------------------------------------------------------------------
// User data: prefs, position, bookmarks (impl: core/storage/user-data.service.ts)
// All writes are local-first; when sync is enabled they also enqueue an
// OutboxOperation in the same Dexie transaction.
// ---------------------------------------------------------------------------
export interface ImportResult {
  added: number;
  skipped: number;
}

export abstract class UserDataApi {
  abstract readonly ready: Signal<boolean>;
  abstract readonly deviceId: Signal<string>;
  abstract readonly prefs: Signal<Preferences>;
  abstract readonly position: Signal<ReadingPosition | null>;
  /** Active (non-deleted) bookmarks, newest first. */
  abstract readonly bookmarks: Signal<Bookmark[]>;

  abstract init(): Promise<void>;
  abstract setPrefs(patch: Partial<Omit<Preferences, 'updatedAt' | 'rev'>>): Promise<void>;
  /** Throttled persistence (≥ 2 s apart) + flush on visibilitychange/pagehide. */
  abstract savePosition(page: number, ayah?: AyahRef | null): void;
  abstract flushPosition(): Promise<void>;

  abstract isPageBookmarked(page: number): boolean;
  abstract isVerseBookmarked(ref: AyahRef): boolean;
  abstract togglePageBookmark(page: number): Promise<'added' | 'removed'>;
  abstract toggleVerseBookmark(ref: AyahRef, page: number): Promise<'added' | 'removed'>;
  /** Soft-deletes; resolves to an undo function valid for ~6 s. */
  abstract removeBookmark(id: string): Promise<() => Promise<void>>;

  // --- bookmark management (folders = collections such as khatam rounds) ---
  /** Active folders sorted by name (natural order, so "Khatam ke-2" < "Khatam ke-10"). */
  abstract readonly folders: Signal<BookmarkFolder[]>;
  /** Rejects with an Indonesian message on empty/too long/duplicate name or FOLDER_LIMIT reached. */
  abstract createFolder(name: string): Promise<BookmarkFolder>;
  abstract renameFolder(id: string, name: string): Promise<void>;
  /**
   * Tombstones the folder. Its bookmarks move to "Tanpa folder", or are deleted too
   * when `deleteBookmarks` is true. Resolves to an undo function valid for ~6 s.
   */
  abstract deleteFolder(id: string, opts?: { deleteBookmarks?: boolean }): Promise<() => Promise<void>>;
  /** Moves the given active bookmarks into a folder (null = "Tanpa folder"). One transaction. */
  abstract moveBookmarks(ids: readonly string[], folderId: string | null): Promise<void>;
  /** Bulk soft-delete in one transaction; resolves to an undo function valid for ~6 s. */
  abstract removeBookmarks(ids: readonly string[]): Promise<() => Promise<void>>;
  /** Empty/whitespace note clears it; longer than BOOKMARK_NOTE_MAX rejects. */
  abstract setBookmarkNote(id: string, note: string | null): Promise<void>;

  abstract exportJson(): Promise<Blob>;
  /** Rejects with an Indonesian Error message on invalid files. */
  abstract importJson(file: File): Promise<ImportResult>;
  /** Re-read everything from IndexedDB (called by sync after applying remote changes). */
  abstract reload(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Optional cloud sync (impl: core/sync/sync.service.ts)
// ---------------------------------------------------------------------------
export interface PositionConflict {
  device: ReadingPosition;
  cloud: ReadingPosition;
}

export abstract class SyncApi {
  /** False when the build has no API origin configured: hide all cloud UI. */
  abstract readonly available: boolean;
  abstract readonly status: Signal<SyncStatus>;
  abstract readonly account: Signal<Account | null>;
  abstract readonly lastSuccessAt: Signal<number | null>;
  abstract readonly conflict: Signal<PositionConflict | null>;

  abstract init(): Promise<void>;
  /** Full-page redirect to the provider. */
  abstract signIn(provider: 'google'): void;
  /** Only works when the Worker runs with DEV_AUTH=1 (local dev). */
  abstract signInDev(email: string): Promise<void>;
  abstract signOut(opts: { clearLocal: boolean }): Promise<void>;
  abstract syncNow(): Promise<void>;
  abstract resolveConflict(choice: 'device' | 'cloud'): Promise<void>;
  /** Deletes the cloud account + data; local data is untouched. */
  abstract deleteCloudData(): Promise<void>;
}

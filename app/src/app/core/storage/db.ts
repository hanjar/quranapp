import Dexie, { Table } from 'dexie';
import {
  Bookmark,
  BookmarkFolder,
  KhatamRound,
  OutboxOperation,
  Preferences,
  ReadDay,
  ReadingPosition,
  SyncState,
} from '../models';

/** Key-value rows for small singletons (deviceId, history). */
export interface MetaRow {
  key: string;
  value: unknown;
}

export interface PrefsRow extends Preferences {
  key: 'prefs';
}

/**
 * Frozen IndexedDB schema. Bump the version and add an upgrade() when changing
 * indexes — never edit an existing version block.
 *
 * - bookmarks: includes tombstones (deletedAt != null). `key` is the semantic
 *   dedupe key; it is NOT unique at the index level because tombstones may
 *   share it. Stores enforce "one active bookmark per key".
 * - positions: one row per edition (primary key editionId).
 * - outbox: ops are scoped by accountId so a sign-in switch never leaks ops.
 */
export class MushafDb extends Dexie {
  bookmarks!: Table<Bookmark, string>;
  folders!: Table<BookmarkFolder, string>;
  positions!: Table<ReadingPosition, string>;
  prefs!: Table<PrefsRow, string>;
  readDays!: Table<ReadDay, string>;
  rounds!: Table<KhatamRound, string>;
  outbox!: Table<OutboxOperation, string>;
  sync!: Table<SyncState, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'mushaf-digital') {
    super(name);
    this.version(1).stores({
      bookmarks: 'id, key, kind, page, updatedAt, deletedAt',
      positions: 'editionId',
      prefs: 'key',
      outbox: 'opId, accountId, nextAttemptAt, createdAt',
      sync: 'key',
      meta: 'key',
    });
    // v2: bookmark folders (collections such as khatam rounds) + per-bookmark note.
    this.version(2)
      .stores({
        bookmarks: 'id, key, kind, page, updatedAt, deletedAt, folderId',
        folders: 'id, updatedAt, deletedAt',
      })
      .upgrade((tx) =>
        tx
          .table('bookmarks')
          .toCollection()
          .modify((b: Partial<Bookmark>) => {
            if (b.folderId === undefined) b.folderId = null;
            if (b.note === undefined) b.note = null;
          }),
      );
    // v3: automatic reading progress (day log + khatam rounds).
    this.version(3).stores({
      readDays: 'day, updatedAt',
      rounds: 'id, n, startedAt',
    });
  }
}

/** Single shared instance for the app. Tests construct their own MushafDb. */
export const db = new MushafDb();

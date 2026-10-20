import {
  Bookmark,
  BookmarkFolder,
  OutboxOperation,
  Preferences,
  ReadingPosition,
  SyncEntity,
  uuid,
} from '../models';
import { MushafDb } from '../storage/db';
import { WireOp } from './sync-types';

export function makeOp(
  accountId: string,
  entity: SyncEntity,
  entityId: string,
  action: 'upsert' | 'delete',
  payload: unknown,
  baseRev: number | null,
  now = Date.now(),
): OutboxOperation {
  return {
    opId: uuid(),
    accountId,
    entity,
    entityId,
    action,
    payload,
    baseRev,
    createdAt: now,
    retryCount: 0,
    nextAttemptAt: 0,
  };
}

export function toWire(op: OutboxOperation): WireOp {
  return {
    opId: op.opId,
    entity: op.entity,
    entityId: op.entityId,
    action: op.action,
    baseRev: op.baseRev,
    payload: op.payload,
  };
}

export function bookmarkPayload(b: Bookmark): Record<string, unknown> {
  return {
    kind: b.kind,
    editionId: b.editionId,
    page: b.page,
    surah: b.surah,
    ayah: b.ayah,
    key: b.key,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    folderId: b.folderId ?? null,
    note: b.note ?? null,
  };
}

export function folderPayload(f: BookmarkFolder): Record<string, unknown> {
  return { name: f.name, createdAt: f.createdAt, updatedAt: f.updatedAt };
}

export function positionPayload(p: ReadingPosition): Record<string, unknown> {
  return {
    editionId: p.editionId,
    page: p.page,
    surah: p.surah,
    ayah: p.ayah,
    updatedAt: p.updatedAt,
    deviceId: p.deviceId,
  };
}

export function prefsPayload(p: Preferences): Record<string, unknown> {
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

/**
 * First-link merge (flow F): enqueue everything local so nothing is lost.
 * Skips entities that already have a pending op. Returns number of ops added.
 */
export async function enqueueLocalSnapshot(
  db: MushafDb,
  accountId: string,
  now = Date.now(),
): Promise<number> {
  return db.transaction(
    'rw',
    db.bookmarks,
    db.folders,
    db.positions,
    db.prefs,
    db.outbox,
    async () => {
      const pending = await db.outbox.where('accountId').equals(accountId).toArray();
      const has = (e: SyncEntity, id: string) =>
        pending.some((o) => o.entity === e && o.entityId === id);
      const ops: OutboxOperation[] = [];
      // Folders first so bookmarks never reference a folder the server has not seen.
      for (const f of await db.folders.filter((x) => x.deletedAt == null).toArray()) {
        if (!has('folder', f.id))
          ops.push(makeOp(accountId, 'folder', f.id, 'upsert', folderPayload(f), f.rev, now));
      }
      const later = now + 1;
      const bookmarks = await db.bookmarks.filter((b) => b.deletedAt == null).toArray();
      for (const b of bookmarks) {
        if (!has('bookmark', b.id))
          ops.push(makeOp(accountId, 'bookmark', b.id, 'upsert', bookmarkPayload(b), b.rev, later));
      }
      for (const p of await db.positions.toArray()) {
        if (!has('position', p.editionId)) {
          ops.push(
            makeOp(accountId, 'position', p.editionId, 'upsert', positionPayload(p), p.rev, later),
          );
        }
      }
      const prefs = await db.prefs.get('prefs');
      if (prefs && prefs.updatedAt > 0 && !has('prefs', 'prefs')) {
        ops.push(
          makeOp(accountId, 'prefs', 'prefs', 'upsert', prefsPayload(prefs), prefs.rev, later),
        );
      }
      if (ops.length) await db.outbox.bulkAdd(ops);
      return ops.length;
    },
  );
}

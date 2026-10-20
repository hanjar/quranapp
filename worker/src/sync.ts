import {
  type BookmarkData,
  type Entity,
  type ParsedOp,
  type PositionData,
  type PrefsData,
  parseBookmark,
  parseOp,
  parsePosition,
  parsePrefs,
} from './validate';
import { isRecord } from './util';

export const MAX_ACTIVE_BOOKMARKS = 5000;
export const DEFAULT_PAGE_LIMIT = 200;
export const MAX_PAGE_LIMIT = 500;
const MAX_ATTEMPTS = 3;

export interface Change {
  entity: Entity;
  id: string;
  rev: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export type OpStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface OpResult {
  opId: string;
  status: OpStatus;
  rev?: number;
  current?: Change;
  error?: string;
}

interface BookmarkRow {
  id: string;
  semantic_key: string;
  kind: 'verse' | 'page';
  edition_id: string;
  page: number;
  surah: number | null;
  ayah: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  rev: number;
}

interface PositionRow {
  edition_id: string;
  page: number;
  surah: number | null;
  ayah: number | null;
  updated_at: number;
  device_id: string;
  rev: number;
}

interface PrefsRow {
  payload: string;
  rev: number;
}

export function bookmarkChange(r: BookmarkRow): Change {
  const deleted = r.deleted_at !== null;
  return {
    entity: 'bookmark',
    id: r.id,
    rev: r.rev,
    deleted,
    data: deleted
      ? null
      : {
          kind: r.kind,
          editionId: r.edition_id,
          page: r.page,
          surah: r.surah,
          ayah: r.ayah,
          key: r.semantic_key,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
  };
}

export function positionChange(r: PositionRow): Change {
  return {
    entity: 'position',
    id: r.edition_id,
    rev: r.rev,
    deleted: false,
    data: {
      editionId: r.edition_id,
      page: r.page,
      surah: r.surah,
      ayah: r.ayah,
      updatedAt: r.updated_at,
      deviceId: r.device_id,
    },
  };
}

export function prefsChange(r: PrefsRow): Change {
  const parsed: unknown = JSON.parse(r.payload);
  return { entity: 'prefs', id: 'prefs', rev: r.rev, deleted: false, data: isRecord(parsed) ? parsed : {} };
}

// --------------------------------------------------------------------------------------------
// Revision helpers
// --------------------------------------------------------------------------------------------

interface RevisionRow {
  revision: number;
  tombstone_horizon: number;
}

export async function getRevision(db: D1Database, userId: string): Promise<RevisionRow> {
  const row = await db
    .prepare('SELECT revision, tombstone_horizon FROM user_revisions WHERE user_id = ?1')
    .bind(userId)
    .first<RevisionRow>();
  if (row) return row;
  await db.prepare('INSERT OR IGNORE INTO user_revisions (user_id) VALUES (?1)').bind(userId).run();
  return { revision: 0, tombstone_horizon: 0 };
}

// --------------------------------------------------------------------------------------------
// GET /sync
// --------------------------------------------------------------------------------------------

export interface SyncPage {
  changes: Change[];
  cursor: number;
  hasMore: boolean;
  reset: boolean;
}

export async function pullChanges(db: D1Database, userId: string, cursor: number, limit: number): Promise<SyncPage> {
  const rv = await getRevision(db, userId);
  const needsReset = cursor > rv.revision || (cursor > 0 && cursor < rv.tombstone_horizon);

  if (needsReset) {
    // Full snapshot of live data in ONE response (no pagination), so clients never loop on reset.
    const [bm, pos, pref] = await db.batch([
      db.prepare('SELECT * FROM bookmarks WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(userId),
      db.prepare('SELECT * FROM reading_progress WHERE user_id = ?1 ORDER BY rev').bind(userId),
      db.prepare('SELECT payload, rev FROM preferences WHERE user_id = ?1').bind(userId),
    ]);
    const changes = [
      ...(bm?.results as BookmarkRow[]).map(bookmarkChange),
      ...(pos?.results as PositionRow[]).map(positionChange),
      ...(pref?.results as PrefsRow[]).map(prefsChange),
    ].sort((a, b) => a.rev - b.rev);
    return { changes, cursor: rv.revision, hasMore: false, reset: true };
  }

  const n = limit + 1;
  const [bm, pos, pref, rv2] = await db.batch([
    db.prepare('SELECT * FROM bookmarks WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT * FROM reading_progress WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT payload, rev FROM preferences WHERE user_id = ?1 AND rev > ?2').bind(userId, cursor),
    db.prepare('SELECT revision FROM user_revisions WHERE user_id = ?1').bind(userId),
  ]);
  const merged = [
    ...(bm?.results as BookmarkRow[]).map(bookmarkChange),
    ...(pos?.results as PositionRow[]).map(positionChange),
    ...(pref?.results as PrefsRow[]).map(prefsChange),
  ].sort((a, b) => a.rev - b.rev);
  const hasMore = merged.length > limit;
  const changes = merged.slice(0, limit);
  const snapshotRev = (rv2?.results[0] as { revision: number } | undefined)?.revision ?? rv.revision;
  const last = changes[changes.length - 1];
  // When drained, advance to the revision seen in the same (transactional) read.
  const next = hasMore && last ? last.rev : Math.max(cursor, snapshotRev);
  return { changes, cursor: next, hasMore, reset: false };
}

// --------------------------------------------------------------------------------------------
// POST /sync/batch
// --------------------------------------------------------------------------------------------

type Stmt = D1PreparedStatement;

interface Sim {
  rev: number;
  bookmarks: Map<string, BookmarkRow>;
  activeByKey: Map<string, string>;
  activeCount: number;
  prefs: PrefsRow | null;
  log: Map<string, OpResult>;
  newLog: Map<string, OpResult>;
}

export async function applyBatch(
  db: D1Database,
  userId: string,
  rawOps: unknown[],
  now: number,
): Promise<{ results: OpResult[]; cursor: number }> {
  const parsed = rawOps.map(parseOp);
  const validOps = parsed.flatMap((p) => (p.op.ok ? [p.op.value] : []));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const base = await getRevision(db, userId);

    // Pre-compute lookup keys for a single read round trip (json_each avoids the 100-parameter cap).
    const opIds = parsed.flatMap((p) => (p.opId ? [p.opId] : []));
    const bookmarkIds: string[] = [];
    const keys: string[] = [];
    for (const op of validOps) {
      if (op.entity !== 'bookmark') continue;
      bookmarkIds.push(op.entityId);
      if (op.action === 'upsert') {
        const bm = parseBookmark(op.payload);
        if (bm.ok) keys.push(bm.value.key);
      }
    }

    const [logRes, byIdRes, byKeyRes, prefRes, countRes] = await db.batch([
      db
        .prepare('SELECT op_id, result_json FROM op_log WHERE user_id = ?1 AND op_id IN (SELECT value FROM json_each(?2))')
        .bind(userId, JSON.stringify(opIds)),
      db
        .prepare('SELECT * FROM bookmarks WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
        .bind(userId, JSON.stringify(bookmarkIds)),
      db
        .prepare(
          'SELECT * FROM bookmarks WHERE user_id = ?1 AND deleted_at IS NULL AND semantic_key IN (SELECT value FROM json_each(?2))',
        )
        .bind(userId, JSON.stringify(keys)),
      db.prepare('SELECT payload, rev FROM preferences WHERE user_id = ?1').bind(userId),
      db.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?1 AND deleted_at IS NULL').bind(userId),
    ]);

    const sim: Sim = {
      rev: base.revision,
      bookmarks: new Map(),
      activeByKey: new Map(),
      activeCount: (countRes?.results[0] as { n: number } | undefined)?.n ?? 0,
      prefs: (prefRes?.results[0] as PrefsRow | undefined) ?? null,
      log: new Map(),
      newLog: new Map(),
    };
    for (const r of (logRes?.results ?? []) as { op_id: string; result_json: string }[]) {
      sim.log.set(r.op_id, JSON.parse(r.result_json) as OpResult);
    }
    for (const r of [...((byIdRes?.results ?? []) as BookmarkRow[]), ...((byKeyRes?.results ?? []) as BookmarkRow[])]) {
      sim.bookmarks.set(r.id, r);
    }
    for (const r of sim.bookmarks.values()) {
      if (r.deleted_at === null) sim.activeByKey.set(r.semantic_key, r.id);
    }

    const writes: ((guard: Guard) => Stmt)[] = [];
    const results: OpResult[] = parsed.map((p) => {
      if (!p.opId) return { opId: 'invalid', status: 'rejected' as const, error: p.op.ok ? 'invalid' : p.op.error };
      const replay = sim.log.get(p.opId) ?? sim.newLog.get(p.opId);
      if (replay) return replay;
      const result = p.op.ok ? applyOp(db, userId, p.op.value, sim, writes, now) : { opId: p.opId, status: 'rejected' as const, error: p.op.error };
      sim.newLog.set(p.opId, result);
      return result;
    });

    const finalRev = sim.rev;
    const guard: Guard = { userId, finalRev };
    const stmts: Stmt[] = [
      // Optimistic concurrency on the per-user counter: fails (0 rows) if anyone wrote since we read.
      db
        .prepare('UPDATE user_revisions SET revision = ?1 WHERE user_id = ?2 AND revision = ?3')
        .bind(finalRev, userId, base.revision),
      ...writes.map((w) => w(guard)),
      ...[...sim.newLog.entries()].map(([opId, res]) =>
        db
          .prepare(
            `INSERT INTO op_log (user_id, op_id, result_json, created_at)
             SELECT ?1, ?2, ?3, ?4 WHERE ${GUARD_SQL}`,
          )
          .bind(userId, opId, JSON.stringify(res), now, finalRev),
      ),
    ];
    const out = await db.batch(stmts);
    if ((out[0]?.meta.changes ?? 0) === 1) {
      return { results, cursor: finalRev };
    }
    // Lost a race with another writer of the same user: re-read and re-simulate.
  }
  throw new SyncBusyError();
}

export class SyncBusyError extends Error {}

interface Guard {
  userId: string;
  finalRev: number;
}

// Statement runs only if our revision bump landed (?5 = finalRev; ?1 is always the user id).
const GUARD_SQL = '(SELECT revision FROM user_revisions WHERE user_id = ?1) = ?5';

function applyOp(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  now: number,
): OpResult {
  const reject = (error: string): OpResult => ({ opId: op.opId, status: 'rejected', error });
  switch (op.entity) {
    case 'bookmark':
      return op.action === 'upsert' ? upsertBookmark(db, userId, op, sim, writes, reject) : deleteBookmark(db, userId, op, sim, writes, now);
    case 'position': {
      if (op.action !== 'upsert') return reject('position cannot be deleted');
      const p = parsePosition(op.payload);
      if (!p.ok) return reject(p.error);
      if (p.value.editionId !== op.entityId) return reject('entityId must equal editionId');
      const rev = ++sim.rev;
      writes.push((g) => upsertPositionStmt(db, userId, p.value, rev, g));
      return { opId: op.opId, status: 'applied', rev };
    }
    case 'prefs': {
      if (op.action !== 'upsert') return reject('prefs cannot be deleted');
      if (op.entityId !== 'prefs') return reject('entityId must be "prefs"');
      const p = parsePrefs(op.payload);
      if (!p.ok) return reject(p.error);
      if (sim.prefs && op.baseRev !== sim.prefs.rev) {
        return { opId: op.opId, status: 'conflict', current: prefsChange(sim.prefs) };
      }
      const rev = ++sim.rev;
      sim.prefs = { payload: JSON.stringify(p.value), rev };
      writes.push((g) => upsertPrefsStmt(db, userId, p.value, rev, g));
      return { opId: op.opId, status: 'applied', rev };
    }
  }
}

function upsertBookmark(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  reject: (e: string) => OpResult,
): OpResult {
  const p = parseBookmark(op.payload);
  if (!p.ok) return reject(p.error);
  const data: BookmarkData = p.value;
  const existing = sim.bookmarks.get(op.entityId);

  if (existing) {
    if (existing.deleted_at !== null) {
      // Delete wins; re-adding must be a new explicit action under a new id.
      if (op.baseRev === null) return reject('id_deleted: use a new id to re-add');
      return { opId: op.opId, status: 'conflict', current: bookmarkChange(existing) };
    }
    if (op.baseRev !== existing.rev) {
      return { opId: op.opId, status: 'conflict', current: bookmarkChange(existing) };
    }
    const otherId = sim.activeByKey.get(data.key);
    if (otherId && otherId !== existing.id) {
      const other = sim.bookmarks.get(otherId);
      if (other) return { opId: op.opId, status: 'duplicate', current: bookmarkChange(other) };
    }
    const rev = ++sim.rev;
    const row: BookmarkRow = {
      ...existing,
      semantic_key: data.key,
      kind: data.kind,
      edition_id: data.editionId,
      page: data.page,
      surah: data.surah,
      ayah: data.ayah,
      updated_at: data.updatedAt,
      rev,
    };
    sim.activeByKey.delete(existing.semantic_key);
    sim.activeByKey.set(row.semantic_key, row.id);
    sim.bookmarks.set(row.id, row);
    writes.push((g) =>
      db
        .prepare(
          `UPDATE bookmarks SET semantic_key = ?2, kind = ?3, edition_id = ?4, page = ?6, surah = ?7, ayah = ?8, updated_at = ?9, rev = ?10
           WHERE user_id = ?1 AND id = ?11 AND ${GUARD_SQL}`,
        )
        .bind(userId, row.semantic_key, row.kind, row.edition_id, g.finalRev, row.page, row.surah, row.ayah, row.updated_at, rev, row.id),
    );
    return { opId: op.opId, status: 'applied', rev };
  }

  if (op.baseRev !== null) return reject('not_found');
  const otherId = sim.activeByKey.get(data.key);
  if (otherId) {
    const other = sim.bookmarks.get(otherId);
    if (other) return { opId: op.opId, status: 'duplicate', current: bookmarkChange(other) };
  }
  if (sim.activeCount >= MAX_ACTIVE_BOOKMARKS) return reject('limit_reached');
  const rev = ++sim.rev;
  const row: BookmarkRow = {
    id: op.entityId,
    semantic_key: data.key,
    kind: data.kind,
    edition_id: data.editionId,
    page: data.page,
    surah: data.surah,
    ayah: data.ayah,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    deleted_at: null,
    rev,
  };
  sim.bookmarks.set(row.id, row);
  sim.activeByKey.set(row.semantic_key, row.id);
  sim.activeCount++;
  writes.push((g) =>
    db
      .prepare(
        `INSERT INTO bookmarks (user_id, id, semantic_key, kind, edition_id, page, surah, ayah, created_at, updated_at, deleted_at, rev)
         SELECT ?1, ?2, ?3, ?4, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12 WHERE ${GUARD_SQL}`,
      )
      .bind(userId, row.id, row.semantic_key, row.kind, g.finalRev, row.edition_id, row.page, row.surah, row.ayah, row.created_at, row.updated_at, rev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

function deleteBookmark(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  now: number,
): OpResult {
  const existing = sim.bookmarks.get(op.entityId);
  if (!existing) return { opId: op.opId, status: 'applied' }; // nothing to delete; idempotent
  if (existing.deleted_at !== null) return { opId: op.opId, status: 'applied', rev: existing.rev };
  // Delete beats any stale edit, so baseRev is intentionally ignored.
  const rev = ++sim.rev;
  sim.bookmarks.set(existing.id, { ...existing, deleted_at: now, rev });
  sim.activeByKey.delete(existing.semantic_key);
  sim.activeCount--;
  writes.push((g) =>
    db
      .prepare(`UPDATE bookmarks SET deleted_at = ?2, rev = ?3 WHERE user_id = ?1 AND id = ?4 AND ${GUARD_SQL}`)
      .bind(userId, now, rev, existing.id, g.finalRev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

function upsertPositionStmt(db: D1Database, userId: string, p: PositionData, rev: number, g: Guard): Stmt {
  return db
    .prepare(
      `INSERT INTO reading_progress (user_id, edition_id, page, surah, ayah, updated_at, device_id, rev)
       SELECT ?1, ?2, ?3, ?4, ?6, ?7, ?8, ?9 WHERE ${GUARD_SQL}
       ON CONFLICT (user_id, edition_id) DO UPDATE SET
         page = excluded.page, surah = excluded.surah, ayah = excluded.ayah,
         updated_at = excluded.updated_at, device_id = excluded.device_id, rev = excluded.rev`,
    )
    .bind(userId, p.editionId, p.page, p.surah, g.finalRev, p.ayah, p.updatedAt, p.deviceId, rev);
}

function upsertPrefsStmt(db: D1Database, userId: string, p: PrefsData, rev: number, g: Guard): Stmt {
  return db
    .prepare(
      `INSERT INTO preferences (user_id, payload, updated_at, rev)
       SELECT ?1, ?2, ?3, ?4 WHERE ${GUARD_SQL}
       ON CONFLICT (user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, rev = excluded.rev`,
    )
    .bind(userId, JSON.stringify(p), p.updatedAt, rev, g.finalRev);
}

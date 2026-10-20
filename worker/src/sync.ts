import {
  type BookmarkData,
  type FolderData,
  type Entity,
  type ParsedOp,
  type DayPageSpan,
  type PageSpan,
  type PositionData,
  type PrefsData,
  type RoundData,
  parseBookmark,
  parseFolder,
  parseOp,
  parsePosition,
  parsePrefs,
  parseReadDay,
  parseReadMarks,
  parseRound,
} from './validate';
import { isRecord } from './util';

export const MAX_ACTIVE_BOOKMARKS = 5000;
export const MAX_ACTIVE_FOLDERS = 100;
export const MAX_READ_DAYS = 2000;
export const MAX_ROUNDS = 100;
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
  folder_id: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  rev: number;
}

interface FolderRow {
  id: string;
  name: string;
  name_key: string;
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

interface DayRow {
  day: string;
  pages: string; // JSON {"<page>": [firstAt, lastAt, removedAt?]}
  updated_at: number;
  deleted_at: number | null;
  cleared_at: number | null;
  rev: number;
}

interface MarksRow {
  marks: string; // JSON {"<page>": [markedAt, unmarkedAt]}
  updated_at: number;
  cleared_at: number | null;
  rev: number;
}

interface RoundRow {
  id: string;
  n: number;
  started_at: number;
  finished_at: number | null;
  updated_at: number;
  deleted_at: number | null;
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
          folderId: r.folder_id,
          note: r.note,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
  };
}

export function folderChange(r: FolderRow): Change {
  const deleted = r.deleted_at !== null;
  return {
    entity: 'folder',
    id: r.id,
    rev: r.rev,
    deleted,
    data: deleted ? null : { name: r.name, createdAt: r.created_at, updatedAt: r.updated_at },
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

export function readDayChange(r: DayRow): Change {
  const deleted = r.deleted_at !== null;
  return {
    entity: 'readday',
    id: r.day,
    rev: r.rev,
    deleted,
    // A tombstone carries the clear watermark so clients drop only reads made before it.
    data: deleted
      ? { clearedAt: r.cleared_at ?? r.deleted_at }
      : { day: r.day, pages: JSON.parse(r.pages) as Record<string, DayPageSpan>, updatedAt: r.updated_at },
  };
}

export function marksChange(r: MarksRow): Change {
  return {
    entity: 'readmark',
    id: 'marks',
    rev: r.rev,
    deleted: false,
    data: {
      marks: JSON.parse(r.marks) as Record<string, PageSpan>,
      updatedAt: r.updated_at,
      clearedAt: r.cleared_at,
    },
  };
}

export function roundChange(r: RoundRow): Change {
  const deleted = r.deleted_at !== null;
  return {
    entity: 'khatam',
    id: r.id,
    rev: r.rev,
    deleted,
    data: deleted ? null : { n: r.n, startedAt: r.started_at, finishedAt: r.finished_at, updatedAt: r.updated_at },
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
  progress_cleared_at: number;
}

export async function getRevision(db: D1Database, userId: string): Promise<RevisionRow> {
  const row = await db
    .prepare('SELECT revision, tombstone_horizon, progress_cleared_at FROM user_revisions WHERE user_id = ?1')
    .bind(userId)
    .first<RevisionRow>();
  if (row) return row;
  await db.prepare('INSERT OR IGNORE INTO user_revisions (user_id) VALUES (?1)').bind(userId).run();
  return { revision: 0, tombstone_horizon: 0, progress_cleared_at: 0 };
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
    const [bm, pos, pref, fol, rd, kr, mk] = await db.batch([
      db.prepare('SELECT * FROM bookmarks WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(userId),
      db.prepare('SELECT * FROM reading_progress WHERE user_id = ?1 ORDER BY rev').bind(userId),
      db.prepare('SELECT payload, rev FROM preferences WHERE user_id = ?1').bind(userId),
      db.prepare('SELECT * FROM folders WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(userId),
      db.prepare('SELECT * FROM reading_days WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(userId),
      db.prepare('SELECT * FROM khatam_rounds WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(userId),
      db.prepare("SELECT * FROM read_marks WHERE user_id = ?1 AND marks != '{}'").bind(userId),
    ]);
    const changes = [
      ...((mk?.results ?? []) as MarksRow[]).map(marksChange),
      ...((fol?.results ?? []) as FolderRow[]).map(folderChange),
      ...((rd?.results ?? []) as DayRow[]).map(readDayChange),
      ...((kr?.results ?? []) as RoundRow[]).map(roundChange),
      ...(bm?.results as BookmarkRow[]).map(bookmarkChange),
      ...(pos?.results as PositionRow[]).map(positionChange),
      ...(pref?.results as PrefsRow[]).map(prefsChange),
    ].sort((a, b) => a.rev - b.rev);
    return { changes, cursor: rv.revision, hasMore: false, reset: true };
  }

  const n = limit + 1;
  const [bm, pos, pref, rv2, fol, rd, kr, mk] = await db.batch([
    db.prepare('SELECT * FROM bookmarks WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT * FROM reading_progress WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT payload, rev FROM preferences WHERE user_id = ?1 AND rev > ?2').bind(userId, cursor),
    db.prepare('SELECT revision FROM user_revisions WHERE user_id = ?1').bind(userId),
    db.prepare('SELECT * FROM folders WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT * FROM reading_days WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT * FROM khatam_rounds WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(userId, cursor, n),
    db.prepare('SELECT * FROM read_marks WHERE user_id = ?1 AND rev > ?2').bind(userId, cursor),
  ]);
  const merged = [
    ...((mk?.results ?? []) as MarksRow[]).map(marksChange),
    ...((fol?.results ?? []) as FolderRow[]).map(folderChange),
    ...((rd?.results ?? []) as DayRow[]).map(readDayChange),
    ...((kr?.results ?? []) as RoundRow[]).map(roundChange),
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
  folders: Map<string, FolderRow>;
  activeFolderByName: Map<string, string>;
  activeFolderCount: number;
  activeByKey: Map<string, string>;
  activeCount: number;
  prefs: PrefsRow | null;
  marks: MarksRow | null;
  days: Map<string, DayRow>;
  activeDayCount: number;
  rounds: Map<string, RoundRow>;
  activeRoundByN: Map<number, string>;
  activeRoundCount: number;
  /** Clear watermark (server ms) of 'Hapus riwayat baca'. */
  clearedAt: number;
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

    const folderIds: string[] = [];
    const folderNames: string[] = [];
    for (const op of validOps) {
      if (op.entity !== 'folder') continue;
      folderIds.push(op.entityId);
      if (op.action === 'upsert') {
        const f = parseFolder(op.payload);
        if (f.ok) folderNames.push(f.value.nameKey);
      }
    }

    const dayIds: string[] = [];
    const roundIds: string[] = [];
    const roundNs: number[] = [];
    let clearAll = false;
    for (const op of validOps) {
      if (op.entity === 'readday') {
        if (op.action === 'delete' && op.entityId === 'all') clearAll = true;
        else dayIds.push(op.entityId);
      } else if (op.entity === 'khatam') {
        roundIds.push(op.entityId);
        if (op.action === 'upsert') {
          const r = parseRound(op.payload);
          if (r.ok) roundNs.push(r.value.n);
        }
      }
    }

    const [logRes, byIdRes, byKeyRes, prefRes, countRes, fIdRes, fNameRes, fCountRes, rdIdRes, rdAllRes, rdCountRes, krIdRes, krNRes, krAllRes, krCountRes, mkRes] = await db.batch([
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
      db
        .prepare('SELECT * FROM folders WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
        .bind(userId, JSON.stringify(folderIds)),
      db
        .prepare(
          'SELECT * FROM folders WHERE user_id = ?1 AND deleted_at IS NULL AND name_key IN (SELECT value FROM json_each(?2))',
        )
        .bind(userId, JSON.stringify(folderNames)),
      db.prepare('SELECT COUNT(*) AS n FROM folders WHERE user_id = ?1 AND deleted_at IS NULL').bind(userId),
      db
        .prepare('SELECT * FROM reading_days WHERE user_id = ?1 AND day IN (SELECT value FROM json_each(?2))')
        .bind(userId, JSON.stringify(dayIds)),
      db
        .prepare('SELECT * FROM reading_days WHERE user_id = ?1 AND deleted_at IS NULL AND ?2 = 1')
        .bind(userId, clearAll ? 1 : 0),
      db.prepare('SELECT COUNT(*) AS n FROM reading_days WHERE user_id = ?1 AND deleted_at IS NULL').bind(userId),
      db
        .prepare('SELECT * FROM khatam_rounds WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
        .bind(userId, JSON.stringify(roundIds)),
      db
        .prepare(
          'SELECT * FROM khatam_rounds WHERE user_id = ?1 AND deleted_at IS NULL AND n IN (SELECT value FROM json_each(?2))',
        )
        .bind(userId, JSON.stringify(roundNs)),
      db
        .prepare('SELECT * FROM khatam_rounds WHERE user_id = ?1 AND deleted_at IS NULL AND ?2 = 1')
        .bind(userId, clearAll ? 1 : 0),
      db.prepare('SELECT COUNT(*) AS n FROM khatam_rounds WHERE user_id = ?1 AND deleted_at IS NULL').bind(userId),
      db.prepare('SELECT * FROM read_marks WHERE user_id = ?1').bind(userId),
    ]);

    const sim: Sim = {
      rev: base.revision,
      bookmarks: new Map(),
      folders: new Map(),
      activeFolderByName: new Map(),
      activeFolderCount: (fCountRes?.results[0] as { n: number } | undefined)?.n ?? 0,
      activeByKey: new Map(),
      activeCount: (countRes?.results[0] as { n: number } | undefined)?.n ?? 0,
      prefs: (prefRes?.results[0] as PrefsRow | undefined) ?? null,
      marks: (mkRes?.results[0] as MarksRow | undefined) ?? null,
      days: new Map(),
      activeDayCount: (rdCountRes?.results[0] as { n: number } | undefined)?.n ?? 0,
      rounds: new Map(),
      activeRoundByN: new Map(),
      activeRoundCount: (krCountRes?.results[0] as { n: number } | undefined)?.n ?? 0,
      clearedAt: base.progress_cleared_at,
      log: new Map(),
      newLog: new Map(),
    };
    for (const r of (logRes?.results ?? []) as { op_id: string; result_json: string }[]) {
      sim.log.set(r.op_id, JSON.parse(r.result_json) as OpResult);
    }
    for (const r of [...((byIdRes?.results ?? []) as BookmarkRow[]), ...((byKeyRes?.results ?? []) as BookmarkRow[])]) {
      sim.bookmarks.set(r.id, r);
    }
    for (const r of [...((fIdRes?.results ?? []) as FolderRow[]), ...((fNameRes?.results ?? []) as FolderRow[])]) {
      sim.folders.set(r.id, r);
    }
    for (const r of [...((rdIdRes?.results ?? []) as DayRow[]), ...((rdAllRes?.results ?? []) as DayRow[])]) {
      sim.days.set(r.day, r);
    }
    for (const r of [
      ...((krIdRes?.results ?? []) as RoundRow[]),
      ...((krNRes?.results ?? []) as RoundRow[]),
      ...((krAllRes?.results ?? []) as RoundRow[]),
    ]) {
      sim.rounds.set(r.id, r);
      if (r.deleted_at === null) sim.activeRoundByN.set(r.n, r.id);
    }
    for (const r of sim.folders.values()) {
      if (r.deleted_at === null) sim.activeFolderByName.set(r.name_key, r.id);
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
        .prepare('UPDATE user_revisions SET revision = ?1, progress_cleared_at = ?4 WHERE user_id = ?2 AND revision = ?3')
        .bind(finalRev, userId, base.revision, sim.clearedAt),
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
    case 'folder':
      return op.action === 'upsert'
        ? upsertFolder(db, userId, op, sim, writes, reject)
        : deleteFolder(db, userId, op, sim, writes, now);
    case 'readday':
      if (op.action === 'upsert') return upsertReadDay(db, userId, op, sim, writes, reject);
      return op.entityId === 'all' ? clearProgress(db, userId, op, sim, writes, now) : reject('only "all" can be deleted');
    case 'readmark':
      if (op.action !== 'upsert') return reject('readmarks cannot be deleted');
      if (op.entityId !== 'marks') return reject('entityId must be "marks"');
      return upsertMarks(db, userId, op, sim, writes, reject);
    case 'khatam':
      return op.action === 'upsert'
        ? upsertRound(db, userId, op, sim, writes, reject)
        : deleteRound(db, userId, op, sim, writes, now);
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
      folder_id: data.folderId,
      note: data.note,
      rev,
    };
    sim.activeByKey.delete(existing.semantic_key);
    sim.activeByKey.set(row.semantic_key, row.id);
    sim.bookmarks.set(row.id, row);
    writes.push((g) =>
      db
        .prepare(
          `UPDATE bookmarks SET semantic_key = ?2, kind = ?3, edition_id = ?4, page = ?6, surah = ?7, ayah = ?8, updated_at = ?9, rev = ?10, folder_id = ?12, note = ?13
           WHERE user_id = ?1 AND id = ?11 AND ${GUARD_SQL}`,
        )
        .bind(userId, row.semantic_key, row.kind, row.edition_id, g.finalRev, row.page, row.surah, row.ayah, row.updated_at, rev, row.id, row.folder_id, row.note),
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
    folder_id: data.folderId,
    note: data.note,
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
        `INSERT INTO bookmarks (user_id, id, semantic_key, kind, edition_id, page, surah, ayah, created_at, updated_at, deleted_at, rev, folder_id, note)
         SELECT ?1, ?2, ?3, ?4, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, ?14 WHERE ${GUARD_SQL}`,
      )
      .bind(userId, row.id, row.semantic_key, row.kind, g.finalRev, row.edition_id, row.page, row.surah, row.ayah, row.created_at, row.updated_at, rev, row.folder_id, row.note),
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

function upsertFolder(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  reject: (e: string) => OpResult,
): OpResult {
  const p = parseFolder(op.payload);
  if (!p.ok) return reject(p.error);
  const data: FolderData = p.value;
  const existing = sim.folders.get(op.entityId);
  const nameOwner = sim.activeFolderByName.get(data.nameKey);

  if (existing) {
    if (existing.deleted_at !== null) {
      if (op.baseRev === null) return reject('id_deleted: use a new id to re-add');
      return { opId: op.opId, status: 'conflict', current: folderChange(existing) };
    }
    if (op.baseRev !== existing.rev) return { opId: op.opId, status: 'conflict', current: folderChange(existing) };
    if (nameOwner && nameOwner !== existing.id) return reject('folder_name_taken');
    const rev = ++sim.rev;
    const row: FolderRow = { ...existing, name: data.name, name_key: data.nameKey, updated_at: data.updatedAt, rev };
    sim.activeFolderByName.delete(existing.name_key);
    sim.activeFolderByName.set(row.name_key, row.id);
    sim.folders.set(row.id, row);
    writes.push((g) =>
      db
        .prepare(
          `UPDATE folders SET name = ?2, name_key = ?3, updated_at = ?4, rev = ?6
           WHERE user_id = ?1 AND id = ?7 AND ${GUARD_SQL}`,
        )
        .bind(userId, row.name, row.name_key, row.updated_at, g.finalRev, rev, row.id),
    );
    return { opId: op.opId, status: 'applied', rev };
  }

  if (op.baseRev !== null) return reject('not_found');
  if (nameOwner) return reject('folder_name_taken');
  if (sim.activeFolderCount >= MAX_ACTIVE_FOLDERS) return reject('limit_reached');
  const rev = ++sim.rev;
  const row: FolderRow = {
    id: op.entityId,
    name: data.name,
    name_key: data.nameKey,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    deleted_at: null,
    rev,
  };
  sim.folders.set(row.id, row);
  sim.activeFolderByName.set(row.name_key, row.id);
  sim.activeFolderCount++;
  writes.push((g) =>
    db
      .prepare(
        `INSERT INTO folders (user_id, id, name, name_key, created_at, updated_at, deleted_at, rev)
         SELECT ?1, ?2, ?3, ?4, ?6, ?7, NULL, ?8 WHERE ${GUARD_SQL}`,
      )
      .bind(userId, row.id, row.name, row.name_key, g.finalRev, row.created_at, row.updated_at, rev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

function deleteFolder(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  now: number,
): OpResult {
  const existing = sim.folders.get(op.entityId);
  if (!existing) return { opId: op.opId, status: 'applied' };
  if (existing.deleted_at !== null) return { opId: op.opId, status: 'applied', rev: existing.rev };
  // Delete beats stale edits. No server-side cascade: clients send bookmark moves/deletes themselves.
  const rev = ++sim.rev;
  sim.folders.set(existing.id, { ...existing, deleted_at: now, rev });
  sim.activeFolderByName.delete(existing.name_key);
  sim.activeFolderCount--;
  writes.push((g) =>
    db
      .prepare(`UPDATE folders SET deleted_at = ?2, rev = ?3 WHERE user_id = ?1 AND id = ?4 AND ${GUARD_SQL}`)
      .bind(userId, now, rev, existing.id, g.finalRev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

// --------------------------------------------------------------------------------------------
// Reading progress
// --------------------------------------------------------------------------------------------

type Pages = Record<string, DayPageSpan>;

const copySpan = (v: DayPageSpan): DayPageSpan => (v.length === 3 ? [v[0], v[1], v[2]] : [v[0], v[1]]);

/**
 * Merge: per page min(firstAt), max(lastAt), max(removedAt). A page counts on its day while
 * lastAt > removedAt, so removals sync and a later read re-adds the page. 2-element entries
 * (old clients, never removed) stay 2-element.
 */
export function mergePages(a: Pages, b: Pages): Pages {
  const out: Pages = {};
  for (const [k, v] of Object.entries(a)) out[k] = copySpan(v);
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (!cur) {
      out[k] = copySpan(v);
      continue;
    }
    const first = Math.min(cur[0], v[0]);
    const last = Math.max(cur[1], v[1]);
    out[k] =
      cur.length === 2 && v.length === 2 ? [first, last] : [first, last, Math.max(cur[2] ?? 0, v[2] ?? 0)];
  }
  return out;
}

function upsertReadDay(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  reject: (e: string) => OpResult,
): OpResult {
  const p = parseReadDay(op.payload);
  if (!p.ok) return reject(p.error);
  const data = p.value;
  if (data.day !== op.entityId) return reject('entityId must equal day');
  // Reads at/before the last "clear history" are dropped: a stale device cannot resurrect them.
  const incoming: Pages = {};
  for (const [k, v] of Object.entries(data.pages)) if (v[1] > sim.clearedAt) incoming[k] = v;
  const existing = sim.days.get(data.day);
  if (Object.keys(incoming).length === 0) return { opId: op.opId, status: 'applied', rev: existing?.rev };

  if (existing) {
    const live = existing.deleted_at === null;
    const cur: Pages = live ? (JSON.parse(existing.pages) as Pages) : {};
    const merged = mergePages(cur, incoming);
    const mergedJson = JSON.stringify(merged);
    // Nothing new: no write, no revision (keeps devices from echoing each other forever).
    if (live && mergedJson === existing.pages) return { opId: op.opId, status: 'applied', rev: existing.rev };
    if (!live && sim.activeDayCount >= MAX_READ_DAYS) return reject('limit_reached');
    const rev = ++sim.rev;
    const row: DayRow = {
      ...existing,
      pages: mergedJson,
      updated_at: Math.max(existing.updated_at, data.updatedAt),
      deleted_at: null,
      rev,
    };
    sim.days.set(row.day, row);
    if (!live) sim.activeDayCount++;
    writes.push((g) =>
      db
        .prepare(
          `UPDATE reading_days SET pages = ?2, updated_at = ?3, deleted_at = NULL, rev = ?4
           WHERE user_id = ?1 AND day = ?6 AND ${GUARD_SQL}`,
        )
        .bind(userId, row.pages, row.updated_at, rev, g.finalRev, row.day),
    );
    return { opId: op.opId, status: 'applied', rev };
  }

  if (sim.activeDayCount >= MAX_READ_DAYS) return reject('limit_reached');
  const rev = ++sim.rev;
  const row: DayRow = {
    day: data.day,
    pages: JSON.stringify(mergePages({}, incoming)),
    updated_at: data.updatedAt,
    deleted_at: null,
    cleared_at: null,
    rev,
  };
  sim.days.set(row.day, row);
  sim.activeDayCount++;
  writes.push((g) =>
    db
      .prepare(
        `INSERT INTO reading_days (user_id, day, pages, updated_at, deleted_at, cleared_at, rev)
         SELECT ?1, ?2, ?3, ?4, NULL, NULL, ?6 WHERE ${GUARD_SQL}`,
      )
      .bind(userId, row.day, row.pages, row.updated_at, g.finalRev, rev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

const CLEAR_CHUNK = 200;

/**
 * `readday/all` delete = "Hapus riwayat baca": tombstones every live day and khatam round,
 * clears the page data and moves the user's clear watermark to `now`.
 */
function clearProgress(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  now: number,
): OpResult {
  sim.clearedAt = Math.max(sim.clearedAt, now);
  const cleared = sim.clearedAt;
  const days = [...sim.days.values()].filter((r) => r.deleted_at === null);
  const rounds = [...sim.rounds.values()].filter((r) => r.deleted_at === null);
  let last: number | undefined;
  for (let i = 0; i < days.length; i += CLEAR_CHUNK) {
    const chunk = days.slice(i, i + CLEAR_CHUNK);
    const revs: Record<string, number> = {};
    for (const r of chunk) {
      revs[r.day] = ++sim.rev;
      last = sim.rev;
      sim.days.set(r.day, { ...r, pages: '{}', deleted_at: now, cleared_at: cleared, rev: revs[r.day] as number });
    }
    sim.activeDayCount -= chunk.length;
    writes.push((g) =>
      db
        .prepare(
          `UPDATE reading_days SET pages = '{}', deleted_at = ?2, cleared_at = ?6, rev = json_extract(?3, '$."' || day || '"')
           WHERE user_id = ?1 AND deleted_at IS NULL AND day IN (SELECT value FROM json_each(?4)) AND ${GUARD_SQL}`,
        )
        .bind(userId, now, JSON.stringify(revs), JSON.stringify(chunk.map((r) => r.day)), g.finalRev, cleared),
    );
  }
  for (let i = 0; i < rounds.length; i += CLEAR_CHUNK) {
    const chunk = rounds.slice(i, i + CLEAR_CHUNK);
    const revs: Record<string, number> = {};
    for (const r of chunk) {
      revs[r.id] = ++sim.rev;
      last = sim.rev;
      sim.rounds.set(r.id, { ...r, deleted_at: now, rev: revs[r.id] as number });
      sim.activeRoundByN.delete(r.n);
    }
    sim.activeRoundCount -= chunk.length;
    writes.push((g) =>
      db
        .prepare(
          `UPDATE khatam_rounds SET deleted_at = ?2, rev = json_extract(?3, '$."' || id || '"')
           WHERE user_id = ?1 AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?4)) AND ${GUARD_SQL}`,
        )
        .bind(userId, now, JSON.stringify(revs), JSON.stringify(chunk.map((r) => r.id)), g.finalRev),
    );
  }
  if (sim.marks && sim.marks.marks !== '{}') {
    const rev = ++sim.rev;
    last = rev;
    sim.marks = { ...sim.marks, marks: '{}', cleared_at: cleared, updated_at: now, rev };
    writes.push((g) =>
      db
        .prepare(
          `UPDATE read_marks SET marks = '{}', cleared_at = ?2, rev = ?3, updated_at = ?4
           WHERE user_id = ?1 AND ${GUARD_SQL}`,
        )
        .bind(userId, cleared, rev, now, g.finalRev),
    );
  }
  return { opId: op.opId, status: 'applied', rev: last };
}

function upsertMarks(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  reject: (e: string) => OpResult,
): OpResult {
  const p = parseReadMarks(op.payload);
  if (!p.ok) return reject(p.error);
  const existing = sim.marks;
  // Entries last touched at/before the clear watermark are dropped (no resurrection).
  const incoming: Pages = {};
  for (const [k, v] of Object.entries(p.value.marks)) if (Math.max(v[0], v[1]) > sim.clearedAt) incoming[k] = v;
  if (Object.keys(incoming).length === 0) return { opId: op.opId, status: 'applied', rev: existing?.rev };
  const cur = existing ? (JSON.parse(existing.marks) as Pages) : {};
  const merged = mergeMarks(cur, incoming);
  const json = JSON.stringify(merged);
  if (existing && json === existing.marks) return { opId: op.opId, status: 'applied', rev: existing.rev };
  const rev = ++sim.rev;
  const updatedAt = Math.max(existing?.updated_at ?? 0, p.value.updatedAt);
  sim.marks = { marks: json, updated_at: updatedAt, cleared_at: existing?.cleared_at ?? null, rev };
  if (existing) {
    writes.push((g) =>
      db
        .prepare(`UPDATE read_marks SET marks = ?2, updated_at = ?3, rev = ?4 WHERE user_id = ?1 AND ${GUARD_SQL}`)
        .bind(userId, json, updatedAt, rev, g.finalRev),
    );
  } else {
    writes.push((g) =>
      db
        .prepare(
          `INSERT INTO read_marks (user_id, marks, updated_at, cleared_at, rev)
           SELECT ?1, ?2, ?3, NULL, ?4 WHERE ${GUARD_SQL}`,
        )
        .bind(userId, json, updatedAt, rev, g.finalRev),
    );
  }
  return { opId: op.opId, status: 'applied', rev };
}

/** Per-component max: marks and unmarks both only grow. */
export function mergeMarks(a: Pages, b: Pages): Pages {
  const out: Pages = {};
  for (const [k, v] of Object.entries(a)) out[k] = [v[0], v[1]];
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = cur ? [Math.max(cur[0], v[0]), Math.max(cur[1], v[1])] : [v[0], v[1]];
  }
  return out;
}

function upsertRound(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  reject: (e: string) => OpResult,
): OpResult {
  const p = parseRound(op.payload);
  if (!p.ok) return reject(p.error);
  const data: RoundData = p.value;
  const existing = sim.rounds.get(op.entityId);
  const owner = sim.activeRoundByN.get(data.n);

  if (existing) {
    if (existing.deleted_at !== null) {
      if (op.baseRev === null) return reject('id_deleted: use a new id to re-add');
      return { opId: op.opId, status: 'conflict', current: roundChange(existing) };
    }
    if (op.baseRev !== existing.rev) return { opId: op.opId, status: 'conflict', current: roundChange(existing) };
    if (owner && owner !== existing.id) {
      const other = sim.rounds.get(owner);
      if (other) return { opId: op.opId, status: 'duplicate', current: roundChange(other) };
    }
    const rev = ++sim.rev;
    const row: RoundRow = {
      ...existing,
      n: data.n,
      started_at: data.startedAt,
      finished_at: data.finishedAt,
      updated_at: data.updatedAt,
      rev,
    };
    sim.activeRoundByN.delete(existing.n);
    sim.activeRoundByN.set(row.n, row.id);
    sim.rounds.set(row.id, row);
    writes.push((g) =>
      db
        .prepare(
          `UPDATE khatam_rounds SET n = ?2, started_at = ?3, finished_at = ?4, updated_at = ?6, rev = ?7
           WHERE user_id = ?1 AND id = ?8 AND ${GUARD_SQL}`,
        )
        .bind(userId, row.n, row.started_at, row.finished_at, g.finalRev, row.updated_at, rev, row.id),
    );
    return { opId: op.opId, status: 'applied', rev };
  }

  if (op.baseRev !== null) return reject('not_found');
  if (data.startedAt <= sim.clearedAt) return reject('cleared_history');
  if (owner) {
    const other = sim.rounds.get(owner);
    if (other) return { opId: op.opId, status: 'duplicate', current: roundChange(other) };
  }
  if (sim.activeRoundCount >= MAX_ROUNDS) return reject('limit_reached');
  const rev = ++sim.rev;
  const row: RoundRow = {
    id: op.entityId,
    n: data.n,
    started_at: data.startedAt,
    finished_at: data.finishedAt,
    updated_at: data.updatedAt,
    deleted_at: null,
    rev,
  };
  sim.rounds.set(row.id, row);
  sim.activeRoundByN.set(row.n, row.id);
  sim.activeRoundCount++;
  writes.push((g) =>
    db
      .prepare(
        `INSERT INTO khatam_rounds (user_id, id, n, started_at, finished_at, updated_at, deleted_at, rev)
         SELECT ?1, ?2, ?3, ?4, ?6, ?7, NULL, ?8 WHERE ${GUARD_SQL}`,
      )
      .bind(userId, row.id, row.n, row.started_at, g.finalRev, row.finished_at, row.updated_at, rev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

function deleteRound(
  db: D1Database,
  userId: string,
  op: ParsedOp,
  sim: Sim,
  writes: ((g: Guard) => Stmt)[],
  now: number,
): OpResult {
  const existing = sim.rounds.get(op.entityId);
  if (!existing) return { opId: op.opId, status: 'applied' };
  if (existing.deleted_at !== null) return { opId: op.opId, status: 'applied', rev: existing.rev };
  const rev = ++sim.rev;
  sim.rounds.set(existing.id, { ...existing, deleted_at: now, rev });
  sim.activeRoundByN.delete(existing.n);
  sim.activeRoundCount--;
  writes.push((g) =>
    db
      .prepare(`UPDATE khatam_rounds SET deleted_at = ?2, rev = ?3 WHERE user_id = ?1 AND id = ?4 AND ${GUARD_SQL}`)
      .bind(userId, now, rev, existing.id, g.finalRev),
  );
  return { opId: op.opId, status: 'applied', rev };
}

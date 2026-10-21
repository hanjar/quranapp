import { PositionConflict } from '../contracts';
import { isPaperThemeId, parseCustomThemes } from '../custom-theme';
import {
  AUDIO_MODE_IDS,
  AudioMode,
  PAGE_RENDERER_IDS,
  PageRendererId,
  snapScale,
  Bookmark,
  BookmarkFolder,
  DEFAULT_PREFERENCES,
  EditionId,
  KhatamRound,
  LayoutMode,
  MotionPref,
  NightAuto,
  NightMode,
  isHHMM,
  OutboxOperation,
  PageReadSpan,
  ReadDay,
  ReadMarks,
  ReadingPosition,
  SyncEntity,
  UiTheme,
  clampDailyTarget,
  isValidPage,
  mergeReadMarks,
  mergeReadPages,
} from '../models';
import { MushafDb } from '../storage/db';
import { bookmarkPayload, folderPayload, makeOp, readDayPayload, readMarksPayload, roundPayload } from './outbox';
import { BatchResult, Change } from './sync-types';

/**
 * Pure(ish) application of server data to Dexie. Every exported function
 * runs in one transaction and only awaits Dexie operations.
 */

export interface ApplyOptions {
  localDeviceId: string;
  /** Cold start / first sync: a newer remote position from another device becomes a conflict. */
  detectPositionConflict: boolean;
  /** A position conflict is awaiting a user choice: leave the local position alone. */
  holdPosition?: boolean;
  /** Server-authoritative (conflict / duplicate results): ignore pending-op guards. */
  force?: boolean;
  now?: number;
}

export interface ApplyResult {
  conflict: PositionConflict | null;
  changed: boolean;
}

interface Ctx extends ApplyResult {
  db: MushafDb;
  accountId: string;
  pending: OutboxOperation[];
  opts: ApplyOptions;
}

const UI: readonly string[] = ['klasik', 'segar', 'ceria', 'samudra'];
const LAYOUT: readonly string[] = ['auto', 'single', 'spread'];
const MOTION: readonly string[] = ['system', 'reduce'];
const NIGHT: readonly string[] = ['off', 'on', 'auto'];
const NIGHT_AUTO: readonly string[] = ['system', 'schedule'];

const TABLES = (db: MushafDb) => [
  db.bookmarks,
  db.folders,
  db.positions,
  db.prefs,
  db.readDays,
  db.rounds,
  db.readMarks,
  db.outbox,
];

// -- pending-op helpers -----------------------------------------------------

function pendingFor(
  ctx: Ctx,
  entity: SyncEntity,
  id: string,
  action?: 'upsert' | 'delete',
): OutboxOperation[] {
  return ctx.pending.filter(
    (o) => o.entity === entity && o.entityId === id && (!action || o.action === action),
  );
}

async function dropPending(
  ctx: Ctx,
  entity: SyncEntity,
  id: string,
  action?: 'upsert' | 'delete',
): Promise<void> {
  const ops = pendingFor(ctx, entity, id, action);
  if (!ops.length) return;
  await ctx.db.outbox.bulkDelete(ops.map((o) => o.opId));
  ctx.pending = ctx.pending.filter((o) => !ops.includes(o));
}

async function bumpBaseRev(ctx: Ctx, entity: SyncEntity, id: string, rev: number): Promise<void> {
  for (const op of pendingFor(ctx, entity, id)) {
    if (op.baseRev == null || op.baseRev < rev) {
      op.baseRev = rev;
      await ctx.db.outbox.update(op.opId, { baseRev: rev });
    }
  }
}

// -- field readers (noPropertyAccessFromIndexSignature friendly) ------------

const str = (d: Record<string, unknown>, k: string): string | null =>
  typeof d[k] === 'string' ? (d[k] as string) : null;
const num = (d: Record<string, unknown>, k: string): number | null =>
  typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : null;
const bool = (d: Record<string, unknown>, k: string): boolean | null =>
  typeof d[k] === 'boolean' ? (d[k] as boolean) : null;

// -- per-entity apply -------------------------------------------------------

async function applyBookmark(ctx: Ctx, ch: Change): Promise<void> {
  const { db } = ctx;
  const d = ch.data;
  const local = await db.bookmarks.get(ch.id);
  const force = !!ctx.opts.force;
  const now = ctx.opts.now ?? Date.now();

  if (ch.deleted) {
    // Tombstone wins over any stale local edit.
    await dropPending(ctx, 'bookmark', ch.id, 'upsert');
    if (local && !(local.rev != null && local.rev > ch.rev)) {
      await db.bookmarks.put({
        ...local,
        deletedAt: local.deletedAt ?? (d ? num(d, 'updatedAt') : null) ?? now,
        rev: ch.rev,
      });
      ctx.changed = true;
    }
    return;
  }
  if (!d) return;
  if (local) {
    if (local.rev != null && local.rev > ch.rev) return; // stale
    if (!force && local.deletedAt != null && pendingFor(ctx, 'bookmark', ch.id, 'delete').length)
      return; // local delete in flight
  }
  const kind = str(d, 'kind');
  const key = str(d, 'key');
  const page = num(d, 'page');
  if ((kind !== 'verse' && kind !== 'page') || !key || !isValidPage(page)) return;

  // Semantic dedupe: one active bookmark per key.
  const same = await db.bookmarks
    .where('key')
    .equals(key)
    .filter((b) => b.id !== ch.id && b.deletedAt == null)
    .toArray();
  for (const s of same) {
    await db.bookmarks.delete(s.id);
    await dropPending(ctx, 'bookmark', s.id);
  }
  const createdAt = num(d, 'createdAt') ?? now;
  const row: Bookmark = {
    id: ch.id,
    kind,
    editionId: (str(d, 'editionId') as EditionId | null) ?? local?.editionId ?? 'hafs-kfqc',
    page,
    surah: num(d, 'surah'),
    ayah: num(d, 'ayah'),
    key,
    createdAt,
    updatedAt: num(d, 'updatedAt') ?? createdAt,
    deletedAt: null,
    rev: ch.rev,
    folderId: str(d, 'folderId'),
    note: str(d, 'note'),
  };
  await db.bookmarks.put(row);
  await bumpBaseRev(ctx, 'bookmark', ch.id, ch.rev);
  ctx.changed = true;
}

/** Moves local bookmarks from one folder id to another, keeping the outbox consistent. */
async function repointBookmarks(ctx: Ctx, fromId: string, toId: string): Promise<void> {
  const { db } = ctx;
  const now = ctx.opts.now ?? Date.now();
  const rows = await db.bookmarks.where('folderId').equals(fromId).toArray();
  for (const b of rows) {
    const moved: Bookmark = { ...b, folderId: toId };
    await db.bookmarks.put(moved);
    const ups = pendingFor(ctx, 'bookmark', b.id, 'upsert');
    if (ups.length) {
      for (const op of ups) {
        op.payload = { ...(op.payload as Record<string, unknown>), folderId: toId };
        await db.outbox.update(op.opId, { payload: op.payload });
      }
    } else if (b.rev != null && b.deletedAt == null) {
      const op = makeOp(ctx.accountId, 'bookmark', b.id, 'upsert', bookmarkPayload(moved), b.rev, now);
      await db.outbox.add(op);
      ctx.pending.push(op);
    }
  }
}

async function applyFolder(ctx: Ctx, ch: Change): Promise<void> {
  const { db } = ctx;
  const d = ch.data;
  const local = await db.folders.get(ch.id);
  const now = ctx.opts.now ?? Date.now();
  if (ch.deleted) {
    await dropPending(ctx, 'folder', ch.id, 'upsert');
    if (local && !(local.rev != null && local.rev > ch.rev)) {
      await db.folders.put({ ...local, deletedAt: local.deletedAt ?? (d ? num(d, 'updatedAt') : null) ?? now, rev: ch.rev });
      ctx.changed = true;
    }
    return;
  }
  const name = d ? str(d, 'name')?.trim() : null;
  if (!d || !name) return;
  if (local) {
    if (local.rev != null && local.rev > ch.rev) return;
    if (!ctx.opts.force && local.deletedAt != null && pendingFor(ctx, 'folder', ch.id, 'delete').length) return;
  }
  // Case-insensitive name collision with a different, unsynced local folder: the server one wins.
  const lower = name.toLocaleLowerCase();
  const twins = await db.folders
    .filter((f) => f.id !== ch.id && f.deletedAt == null && f.rev == null && f.name.toLocaleLowerCase() === lower)
    .toArray();
  for (const t of twins) {
    await repointBookmarks(ctx, t.id, ch.id);
    await dropPending(ctx, 'folder', t.id);
    await db.folders.put({ ...t, deletedAt: now });
  }
  const createdAt = num(d, 'createdAt') ?? now;
  const row: BookmarkFolder = {
    id: ch.id,
    name,
    createdAt,
    updatedAt: num(d, 'updatedAt') ?? createdAt,
    deletedAt: null,
    rev: ch.rev,
  };
  await db.folders.put(row);
  await bumpBaseRev(ctx, 'folder', ch.id, ch.rev);
  ctx.changed = true;
}

async function applyPrefs(ctx: Ctx, ch: Change): Promise<void> {
  const { db } = ctx;
  if (ch.deleted || !ch.data) return;
  const local = await db.prefs.get('prefs');
  if (local && local.rev != null && local.rev > ch.rev) return;
  if (!ctx.opts.force && pendingFor(ctx, 'prefs', 'prefs').length) {
    // Local edit is newer than this pull: keep it, retry on top of the current revision.
    await bumpBaseRev(ctx, 'prefs', 'prefs', ch.rev);
    return;
  }
  const d = ch.data;
  const base = local ?? { ...DEFAULT_PREFERENCES, key: 'prefs' as const };
  const paper = str(d, 'paperTheme');
  const ui = str(d, 'uiTheme');
  const layout = str(d, 'layoutMode');
  const motion = str(d, 'motion');
  const night = str(d, 'nightMode');
  const nightAuto = str(d, 'nightAuto');
  const nStart = str(d, 'nightStart');
  const nEnd = str(d, 'nightEnd');
  const audioMode = str(d, 'audioMode');
  const renderer = str(d, 'pageRenderer');
  const tScale = num(d, 'translationScale');
  await db.prefs.put({
    ...base,
    key: 'prefs',
    paperTheme: paper && isPaperThemeId(paper) ? paper : base.paperTheme,
    // absent (older client) keeps the local list; present replaces it, bad entries dropped
    customThemes: Array.isArray(d['customThemes']) ? parseCustomThemes(d['customThemes']) : base.customThemes,
    uiTheme: ui && UI.includes(ui) ? (ui as UiTheme) : base.uiTheme,
    layoutMode: layout && LAYOUT.includes(layout) ? (layout as LayoutMode) : base.layoutMode,
    motion: motion && MOTION.includes(motion) ? (motion as MotionPref) : base.motion,
    controlsAlwaysVisible: bool(d, 'controlsAlwaysVisible') ?? base.controlsAlwaysVisible,
    highContrast: bool(d, 'highContrast') ?? base.highContrast,
    dailyTarget: num(d, 'dailyTarget') != null ? clampDailyTarget(num(d, 'dailyTarget') as number) : base.dailyTarget,
    trackProgress: bool(d, 'trackProgress') ?? base.trackProgress,
    nightMode: night && NIGHT.includes(night) ? (night as NightMode) : base.nightMode,
    nightAuto:
      nightAuto && NIGHT_AUTO.includes(nightAuto) ? (nightAuto as NightAuto) : base.nightAuto,
    nightStart: isHHMM(nStart) ? nStart : base.nightStart,
    nightEnd: isHHMM(nEnd) ? nEnd : base.nightEnd,
    lineRules: bool(d, 'lineRules') ?? base.lineRules,
    showLatin: bool(d, 'showLatin') ?? base.showLatin,
    translationScale: tScale != null ? snapScale(tScale) : base.translationScale,
    audioMode:
      audioMode && AUDIO_MODE_IDS.includes(audioMode as AudioMode)
        ? (audioMode as AudioMode)
        : base.audioMode,
    audioFollow: bool(d, 'audioFollow') ?? base.audioFollow,
    pageRenderer:
      renderer && PAGE_RENDERER_IDS.includes(renderer as PageRendererId)
        ? (renderer as PageRendererId)
        : base.pageRenderer,
    updatedAt: num(d, 'updatedAt') ?? base.updatedAt,
    rev: ch.rev,
  });
  ctx.changed = true;
}

async function applyPosition(ctx: Ctx, ch: Change): Promise<void> {
  const { db, opts } = ctx;
  if (ch.deleted || !ch.data) return;
  const d = ch.data;
  const page = num(d, 'page');
  if (!isValidPage(page)) return;
  const editionId = (str(d, 'editionId') ?? ch.id) as EditionId;
  const remote: ReadingPosition = {
    editionId,
    page,
    surah: num(d, 'surah'),
    ayah: num(d, 'ayah'),
    updatedAt: num(d, 'updatedAt') ?? 0,
    deviceId: str(d, 'deviceId') ?? '',
    rev: ch.rev,
  };
  const local = await db.positions.get(editionId);
  if (!local) {
    if (!opts.holdPosition) {
      await db.positions.put(remote);
      ctx.changed = true;
    }
    return;
  }
  if (local.rev != null && local.rev > ch.rev) return;
  if (opts.force) {
    await db.positions.put(remote);
    ctx.changed = true;
    return;
  }
  if (opts.holdPosition) return;
  if (remote.deviceId === opts.localDeviceId) {
    // Echo of our own write: just record the revision.
    if (remote.updatedAt === local.updatedAt && local.rev !== remote.rev)
      await db.positions.update(editionId, { rev: remote.rev });
    return;
  }
  if (remote.updatedAt <= local.updatedAt) return; // local is newer; it wins on push
  if (opts.detectPositionConflict && remote.page !== local.page) {
    ctx.conflict = { device: local, cloud: remote };
    await dropPending(ctx, 'position', editionId); // must not overwrite the cloud copy before the user chooses
    return;
  }
  if (pendingFor(ctx, 'position', editionId).length) return;
  // Active session: store silently; the reader is never moved by sync.
  await db.positions.put(remote);
  ctx.changed = true;
}

/** Parses a wire `pages` object; malformed entries are dropped. */
export function parseWirePages(raw: unknown): Record<string, PageReadSpan> {
  const out: Record<string, PageReadSpan> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const page = Number(k);
    if (!isValidPage(page) || String(page) !== k || !Array.isArray(v) || (v.length !== 2 && v.length !== 3)) continue;
    const [a, b, r] = v as unknown[];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (v.length === 3 && (typeof r !== 'number' || !Number.isFinite(r) || r < 0)) continue;
    out[k] = v.length === 3 ? [Math.min(a, b), Math.max(a, b), r as number] : [Math.min(a, b), Math.max(a, b)];
  }
  return out;
}

async function refreshPendingDay(ctx: Ctx, row: ReadDay): Promise<void> {
  for (const op of pendingFor(ctx, 'readday', row.day, 'upsert')) {
    op.payload = readDayPayload(row);
    await ctx.db.outbox.update(op.opId, { payload: op.payload });
  }
}

async function applyReadDay(ctx: Ctx, ch: Change): Promise<void> {
  const { db } = ctx;
  const d = ch.data;
  const local = await db.readDays.get(ch.id);
  if (ch.deleted) {
    // `clearedAt` watermark: reads at/before it were wiped; later local reads survive.
    const clearedAt = d ? num(d, 'clearedAt') : null;
    if (!local) return;
    const kept: Record<string, PageReadSpan> = {};
    for (const [k, v] of Object.entries(local.pages)) {
      if (clearedAt != null && v[1] > clearedAt) kept[k] = v;
    }
    if (!Object.keys(kept).length) {
      await db.readDays.delete(ch.id);
      await dropPending(ctx, 'readday', ch.id);
    } else {
      const row: ReadDay = { ...local, pages: kept };
      await db.readDays.put(row);
      await refreshPendingDay(ctx, row);
    }
    ctx.changed = true;
    return;
  }
  if (!d) return;
  const remotePages = parseWirePages(d['pages']);
  if (!Object.keys(remotePages).length) return;
  const merged = local ? mergeReadPages(local.pages, remotePages) : remotePages;
  const remoteUpdated = num(d, 'updatedAt') ?? 0;
  const row: ReadDay = {
    day: ch.id,
    pages: merged,
    updatedAt: Math.max(local?.updatedAt ?? 0, remoteUpdated),
    rev: local?.rev != null && local.rev > ch.rev ? local.rev : ch.rev,
  };
  if (local && JSON.stringify(local.pages) === JSON.stringify(merged) && local.rev === row.rev) return;
  await db.readDays.put(row);
  await bumpBaseRev(ctx, 'readday', ch.id, ch.rev);
  ctx.changed = true;
}

/** Parses wire marks; malformed entries are dropped. */
export function parseWireMarks(raw: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const page = Number(k);
    if (!isValidPage(page) || String(page) !== k || !Array.isArray(v) || v.length !== 2) continue;
    const [a, b] = v as unknown[];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    out[k] = [a, b];
  }
  return out;
}

async function applyReadMarks(ctx: Ctx, ch: Change): Promise<void> {
  const { db } = ctx;
  const d = ch.data;
  if (ch.deleted || !d) return;
  const local = await db.readMarks.get('marks');
  // `clearedAt`: entries last touched at/before the clear are gone everywhere.
  const clearedAt = num(d, 'clearedAt') ?? 0;
  let mine = local?.marks ?? {};
  if (clearedAt > 0) {
    mine = Object.fromEntries(Object.entries(mine).filter(([, v]) => Math.max(v[0], v[1]) > clearedAt));
  }
  const merged = mergeReadMarks(mine, parseWireMarks(d['marks']));
  const row: ReadMarks = {
    key: 'marks',
    marks: merged,
    updatedAt: Math.max(local?.updatedAt ?? 0, num(d, 'updatedAt') ?? 0),
    rev: local?.rev != null && local.rev > ch.rev ? local.rev : ch.rev,
  };
  if (local && JSON.stringify(local.marks) === JSON.stringify(merged) && local.rev === row.rev) return;
  await db.readMarks.put(row);
  if (clearedAt > 0 && JSON.stringify(local?.marks ?? {}) !== JSON.stringify(mine)) {
    for (const op of pendingFor(ctx, 'readmark', 'marks', 'upsert')) {
      op.payload = readMarksPayload(row);
      await db.outbox.update(op.opId, { payload: op.payload });
    }
  }
  await bumpBaseRev(ctx, 'readmark', 'marks', ch.rev);
  ctx.changed = true;
}

async function applyRound(ctx: Ctx, ch: Change): Promise<void> {
  const { db } = ctx;
  const d = ch.data;
  const local = await db.rounds.get(ch.id);
  const now = ctx.opts.now ?? Date.now();
  if (ch.deleted) {
    await dropPending(ctx, 'khatam', ch.id);
    if (local && !(local.rev != null && local.rev > ch.rev)) {
      await db.rounds.delete(ch.id);
      ctx.changed = true;
    }
    return;
  }
  if (!d) return;
  const n = num(d, 'n');
  const startedAt = num(d, 'startedAt');
  if (n == null || !Number.isInteger(n) || n < 1 || startedAt == null) return;
  if (local) {
    if (local.rev != null && local.rev > ch.rev) return;
    if (!ctx.opts.force && pendingFor(ctx, 'khatam', ch.id).length) {
      await bumpBaseRev(ctx, 'khatam', ch.id, ch.rev); // local edit in flight: retry on top
      return;
    }
  }
  let finishedAt = num(d, 'finishedAt');
  let start = startedAt;
  let reenqueue = false;
  // Same round number created on two devices: the server row wins, the finish mark survives.
  const twins = await db.rounds.filter((r) => r.id !== ch.id && r.n === n).toArray();
  for (const t of twins) {
    if (t.finishedAt != null && finishedAt == null) {
      finishedAt = t.finishedAt;
      reenqueue = true;
    }
    if (t.startedAt < start) {
      start = t.startedAt;
      reenqueue = true;
    }
    await db.rounds.delete(t.id);
    await dropPending(ctx, 'khatam', t.id);
  }
  const row: KhatamRound = {
    id: ch.id,
    n,
    startedAt: start,
    finishedAt,
    updatedAt: reenqueue ? now : (num(d, 'updatedAt') ?? now),
    rev: ch.rev,
  };
  await db.rounds.put(row);
  await bumpBaseRev(ctx, 'khatam', ch.id, ch.rev);
  if (reenqueue && !pendingFor(ctx, 'khatam', ch.id, 'upsert').length) {
    const op = makeOp(ctx.accountId, 'khatam', ch.id, 'upsert', roundPayload(row), ch.rev, now);
    await db.outbox.add(op);
    ctx.pending.push(op);
  }
  ctx.changed = true;
}

async function applyOne(ctx: Ctx, ch: Change): Promise<void> {
  switch (ch.entity) {
    case 'readday':
      return applyReadDay(ctx, ch);
    case 'khatam':
      return applyRound(ctx, ch);
    case 'readmark':
      return applyReadMarks(ctx, ch);
    case 'bookmark':
      return applyBookmark(ctx, ch);
    case 'folder':
      return applyFolder(ctx, ch);
    case 'prefs':
      return applyPrefs(ctx, ch);
    case 'position':
      return applyPosition(ctx, ch);
    default:
      return;
  }
}

async function makeCtx(db: MushafDb, accountId: string, opts: ApplyOptions): Promise<Ctx> {
  const pending = await db.outbox.where('accountId').equals(accountId).toArray();
  return { db, accountId, pending, opts, conflict: null, changed: false };
}

// -- exported entry points --------------------------------------------------

/** Changes applied per IndexedDB transaction: keeps rw locks short so local writes never queue long. */
export const APPLY_CHUNK = 40;

/**
 * Applies a pull page in small transactions (APPLY_CHUNK changes each) instead of one
 * transaction over every table: a big pull (hundreds of bookmarks/read days) used to hold
 * the bookmark table locked for the whole run, stalling bookmark toggles. Each chunk
 * re-reads the outbox, so local writes made between chunks are respected.
 */
export async function applyChanges(
  db: MushafDb,
  accountId: string,
  changes: Change[],
  opts: ApplyOptions,
): Promise<ApplyResult> {
  let conflict: PositionConflict | null = null;
  let changed = false;
  if (!changes.length) return { conflict, changed };
  for (let i = 0; i < changes.length; i += APPLY_CHUNK) {
    const chunk = changes.slice(i, i + APPLY_CHUNK);
    const res = await db.transaction('rw', TABLES(db), async () => {
      const ctx = await makeCtx(db, accountId, {
        ...opts,
        // After a conflict was found, later chunks must not touch the position.
        holdPosition: opts.holdPosition || conflict !== null,
      });
      for (const ch of chunk) await applyOne(ctx, ch);
      return { conflict: ctx.conflict, changed: ctx.changed };
    });
    conflict ??= res.conflict;
    changed = changed || res.changed;
  }
  return { conflict, changed };
}

export interface PushOutcome {
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: { opId: string; entity: SyncEntity; entityId: string; error: string }[];
  /** Ops the server returned no result for: caller backs them off. */
  missing: OutboxOperation[];
  changed: boolean;
}

/** Applies a /sync/batch response to local rows and removes handled ops. */
export function handleResults(
  db: MushafDb,
  accountId: string,
  ops: OutboxOperation[],
  results: BatchResult[],
  opts: ApplyOptions,
): Promise<PushOutcome> {
  return db.transaction('rw', TABLES(db), async () => {
    const ctx = await makeCtx(db, accountId, {
      ...opts,
      force: true,
      detectPositionConflict: false,
      holdPosition: false,
    });
    const byId = new Map(results.map((r) => [r.opId, r]));
    const out: PushOutcome = {
      applied: 0,
      duplicates: 0,
      conflicts: 0,
      rejected: [],
      missing: [],
      changed: false,
    };
    const now = opts.now ?? Date.now();

    for (const op of ops) {
      const r = byId.get(op.opId);
      if (!r) {
        out.missing.push(op);
        continue;
      }
      await db.outbox.delete(op.opId);
      ctx.pending = ctx.pending.filter((p) => p.opId !== op.opId);

      switch (r.status) {
        case 'applied': {
          out.applied++;
          if (r.rev != null) {
            if (op.entity === 'bookmark') await db.bookmarks.update(op.entityId, { rev: r.rev });
            else if (op.entity === 'folder') await db.folders.update(op.entityId, { rev: r.rev });
            else if (op.entity === 'position')
              await db.positions.update(op.entityId, { rev: r.rev });
            else if (op.entity === 'readday') await db.readDays.update(op.entityId, { rev: r.rev });
            else if (op.entity === 'khatam') await db.rounds.update(op.entityId, { rev: r.rev });
            else if (op.entity === 'readmark') await db.readMarks.update('marks', { rev: r.rev });
            else await db.prefs.update('prefs', { rev: r.rev });
            await bumpBaseRev(ctx, op.entity, op.entityId, r.rev);
          }
          break;
        }
        case 'duplicate': {
          out.duplicates++;
          if (op.entity === 'folder' || op.entity === 'khatam') {
            if (r.current) await applyOne(ctx, r.current); // name-collision merge keeps the server folder
            out.changed = true;
            break;
          }
          const rest = pendingFor(ctx, 'bookmark', op.entityId);
          const wantsDelete = rest.some((p) => p.action === 'delete');
          await db.bookmarks.delete(op.entityId);
          await dropPending(ctx, 'bookmark', op.entityId);
          const cur = r.current;
          if (cur && cur.entity === 'bookmark') {
            await applyOne(ctx, cur);
            if (wantsDelete) {
              const row = await db.bookmarks.get(cur.id);
              if (row) {
                await db.bookmarks.put({ ...row, deletedAt: now });
                await db.outbox.add(
                  makeOp(accountId, 'bookmark', cur.id, 'delete', null, cur.rev, now),
                );
              }
            }
          }
          out.changed = true;
          break;
        }
        case 'conflict': {
          out.conflicts++;
          // Server wins; a tombstone beats the stale edit.
          if (r.current) await applyOne(ctx, r.current);
          out.changed = true;
          break;
        }
        case 'rejected': {
          out.rejected.push({
            opId: op.opId,
            entity: op.entity,
            entityId: op.entityId,
            error: r.error ?? 'rejected',
          });
          break;
        }
      }
    }
    out.changed = out.changed || ctx.changed || out.applied > 0;
    return out;
  });
}

/**
 * Full reconciliation after `reset:true` (cursor older than tombstone
 * retention). `changes` is the complete remote state fetched from cursor 0.
 * Local synced rows missing remotely are removed; unsynced rows are kept and
 * re-enqueued.
 */
export function reconcileReset(
  db: MushafDb,
  accountId: string,
  changes: Change[],
  opts: ApplyOptions,
): Promise<ApplyResult> {
  return db.transaction('rw', TABLES(db), async () => {
    const ctx = await makeCtx(db, accountId, opts);
    for (const ch of changes) await applyOne(ctx, ch);

    const remoteActive = new Set(
      changes.filter((c) => c.entity === 'bookmark' && !c.deleted).map((c) => c.id),
    );
    const now = opts.now ?? Date.now();
    const remoteFolders = new Set(changes.filter((c) => c.entity === 'folder' && !c.deleted).map((c) => c.id));
    for (const f of await db.folders.toArray()) {
      if (f.rev != null) {
        if (!remoteFolders.has(f.id)) {
          await db.folders.delete(f.id);
          await dropPending(ctx, 'folder', f.id);
          ctx.changed = true;
        }
      } else if (f.deletedAt != null) {
        await db.folders.delete(f.id);
        await dropPending(ctx, 'folder', f.id);
      } else if (!pendingFor(ctx, 'folder', f.id, 'upsert').length) {
        const op = makeOp(accountId, 'folder', f.id, 'upsert', folderPayload(f), null, now - 1);
        await db.outbox.add(op);
        ctx.pending.push(op);
      }
    }
    const remoteDays = new Set(changes.filter((c) => c.entity === 'readday' && !c.deleted).map((c) => c.id));
    for (const rd of await db.readDays.toArray()) {
      if (rd.rev != null && !remoteDays.has(rd.day)) {
        // Cleared elsewhere. Keep (and re-send) only if a local edit is still in flight.
        if (pendingFor(ctx, 'readday', rd.day, 'upsert').length) {
          await db.readDays.put({ ...rd, rev: null });
        } else {
          await db.readDays.delete(rd.day);
          ctx.changed = true;
        }
      } else if (rd.rev == null && !pendingFor(ctx, 'readday', rd.day, 'upsert').length) {
        const op = makeOp(accountId, 'readday', rd.day, 'upsert', readDayPayload(rd), null, now);
        await db.outbox.add(op);
        ctx.pending.push(op);
      }
    }
    const localMarks = await db.readMarks.get('marks');
    if (localMarks) {
      const remoteHas = changes.some((c) => c.entity === 'readmark' && !c.deleted);
      if (localMarks.rev != null && !remoteHas) {
        if (pendingFor(ctx, 'readmark', 'marks', 'upsert').length) {
          await db.readMarks.put({ ...localMarks, rev: null });
        } else {
          await db.readMarks.delete('marks');
          ctx.changed = true;
        }
      } else if (localMarks.rev == null && !pendingFor(ctx, 'readmark', 'marks', 'upsert').length) {
        const op = makeOp(accountId, 'readmark', 'marks', 'upsert', readMarksPayload(localMarks), null, now);
        await db.outbox.add(op);
        ctx.pending.push(op);
      }
    }
    const remoteRounds = new Set(changes.filter((c) => c.entity === 'khatam' && !c.deleted).map((c) => c.id));
    for (const rr of await db.rounds.toArray()) {
      if (rr.rev != null && !remoteRounds.has(rr.id)) {
        await db.rounds.delete(rr.id);
        await dropPending(ctx, 'khatam', rr.id);
        ctx.changed = true;
      } else if (rr.rev == null && !pendingFor(ctx, 'khatam', rr.id, 'upsert').length) {
        const op = makeOp(accountId, 'khatam', rr.id, 'upsert', roundPayload(rr), null, now);
        await db.outbox.add(op);
        ctx.pending.push(op);
      }
    }
    for (const b of await db.bookmarks.toArray()) {
      if (b.rev != null) {
        if (!remoteActive.has(b.id)) {
          await db.bookmarks.delete(b.id);
          await dropPending(ctx, 'bookmark', b.id);
          ctx.changed = true;
        }
      } else if (b.deletedAt != null) {
        await db.bookmarks.delete(b.id);
        await dropPending(ctx, 'bookmark', b.id);
      } else if (!pendingFor(ctx, 'bookmark', b.id, 'upsert').length) {
        const op = makeOp(accountId, 'bookmark', b.id, 'upsert', bookmarkPayload(b), null, now);
        await db.outbox.add(op);
        ctx.pending.push(op);
      }
    }
    return { conflict: ctx.conflict, changed: ctx.changed };
  });
}

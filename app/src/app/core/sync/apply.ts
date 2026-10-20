import { PositionConflict } from '../contracts';
import {
  Bookmark,
  DEFAULT_PREFERENCES,
  EditionId,
  LayoutMode,
  MotionPref,
  OutboxOperation,
  PaperTheme,
  ReadingPosition,
  SyncEntity,
  UiTheme,
  isValidPage,
} from '../models';
import { MushafDb } from '../storage/db';
import { bookmarkPayload, makeOp } from './outbox';
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

const PAPER: readonly string[] = ['photo', 'ivory', 'antique'];
const UI: readonly string[] = ['klasik', 'segar', 'ceria', 'samudra'];
const LAYOUT: readonly string[] = ['auto', 'single', 'spread'];
const MOTION: readonly string[] = ['system', 'reduce'];

const TABLES = (db: MushafDb) => [db.bookmarks, db.positions, db.prefs, db.outbox];

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
  };
  await db.bookmarks.put(row);
  await bumpBaseRev(ctx, 'bookmark', ch.id, ch.rev);
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
  await db.prefs.put({
    ...base,
    key: 'prefs',
    paperTheme: paper && PAPER.includes(paper) ? (paper as PaperTheme) : base.paperTheme,
    uiTheme: ui && UI.includes(ui) ? (ui as UiTheme) : base.uiTheme,
    layoutMode: layout && LAYOUT.includes(layout) ? (layout as LayoutMode) : base.layoutMode,
    motion: motion && MOTION.includes(motion) ? (motion as MotionPref) : base.motion,
    controlsAlwaysVisible: bool(d, 'controlsAlwaysVisible') ?? base.controlsAlwaysVisible,
    highContrast: bool(d, 'highContrast') ?? base.highContrast,
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

async function applyOne(ctx: Ctx, ch: Change): Promise<void> {
  switch (ch.entity) {
    case 'bookmark':
      return applyBookmark(ctx, ch);
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

export function applyChanges(
  db: MushafDb,
  accountId: string,
  changes: Change[],
  opts: ApplyOptions,
): Promise<ApplyResult> {
  return db.transaction('rw', TABLES(db), async () => {
    const ctx = await makeCtx(db, accountId, opts);
    for (const ch of changes) await applyOne(ctx, ch);
    return { conflict: ctx.conflict, changed: ctx.changed };
  });
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
            else if (op.entity === 'position')
              await db.positions.update(op.entityId, { rev: r.rev });
            else await db.prefs.update('prefs', { rev: r.rev });
            await bumpBaseRev(ctx, op.entity, op.entityId, r.rev);
          }
          break;
        }
        case 'duplicate': {
          out.duplicates++;
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

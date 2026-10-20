import { OutboxOperation, SyncEntity, uuid } from '../models';
import { MushafDb } from './db';

/**
 * Account the local writes should be queued for, or null when cloud sync is off.
 * Call inside the same Dexie transaction as the data write (sync table in scope).
 */
export async function activeSyncAccount(db: MushafDb): Promise<string | null> {
  const state = await db.sync.get('state');
  return state?.enabled && state.accountId ? state.accountId : null;
}

/**
 * Enqueues an op, replacing any not-yet-sent op for the same entity+entityId
 * (coalescing). Must run inside a transaction that includes `db.outbox`.
 */
export async function enqueueOutbox(
  db: MushafDb,
  accountId: string,
  entity: SyncEntity,
  entityId: string,
  action: 'upsert' | 'delete',
  payload: unknown,
  baseRev: number | null,
): Promise<void> {
  const stale = await db.outbox
    .where('accountId')
    .equals(accountId)
    .filter((o) => o.entity === entity && o.entityId === entityId)
    .primaryKeys();
  if (stale.length) await db.outbox.bulkDelete(stale);
  const now = Date.now();
  const op: OutboxOperation = {
    opId: uuid(),
    accountId,
    entity,
    entityId,
    action,
    payload,
    baseRev,
    createdAt: now,
    retryCount: 0,
    nextAttemptAt: now,
  };
  await db.outbox.add(op);
}

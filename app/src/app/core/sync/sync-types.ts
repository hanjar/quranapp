import { SyncEntity } from '../models';

/** Wire types of the frozen Sync API (worker <-> client). */
export interface Change {
  entity: SyncEntity;
  id: string;
  rev: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export interface WireOp {
  opId: string;
  entity: SyncEntity;
  entityId: string;
  action: 'upsert' | 'delete';
  baseRev: number | null;
  payload: unknown;
}

export type BatchStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface BatchResult {
  opId: string;
  status: BatchStatus;
  rev?: number;
  current?: Change;
  error?: string;
}

export interface BatchResponse {
  results: BatchResult[];
  cursor: number;
}

export interface PullResponse {
  changes: Change[];
  cursor: number;
  hasMore: boolean;
  reset: boolean;
}

export interface MeUser {
  id: string;
  email: string | null;
  name: string | null;
}

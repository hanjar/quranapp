import { reportError } from './error-reporter';

/**
 * In-memory ring buffer of the most recent storage errors, so a feedback report can
 * say what actually failed on the owner's device. Never persisted; each entry is also
 * sent as an automatic error report (see error-reporter.ts) unless switched off.
 */
export interface StorageErrorEntry {
  name: string;
  message: string;
  op: string;
  at: number;
}

export const STORAGE_ERROR_LIMIT = 20;

const entries: StorageErrorEntry[] = [];

export function recordStorageError(op: string, e: unknown, now: number = Date.now()): void {
  const err = e instanceof Error ? e : new Error(String(e));
  const entry = {
    name: (err.name || 'Error').slice(0, 60),
    message: (err.message || '').slice(0, 200),
    op: op.slice(0, 40),
    at: now,
  };
  entries.push(entry);
  reportError(entry);
  if (entries.length > STORAGE_ERROR_LIMIT) entries.splice(0, entries.length - STORAGE_ERROR_LIMIT);
}

/** Oldest first. */
export function recentStorageErrors(): readonly StorageErrorEntry[] {
  return entries.slice();
}

export function clearStorageErrors(): void {
  entries.length = 0;
}

/** Compact text block for a bug report; empty string when nothing was recorded. */
export function formatStorageErrors(list: readonly StorageErrorEntry[] = entries): string {
  return list
    .map((x) => `${new Date(x.at).toISOString()} [${x.op}] ${x.name}: ${x.message}`)
    .join('\n');
}

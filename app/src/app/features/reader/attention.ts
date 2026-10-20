import { DownloadState, OfflineStatus } from '../../core/contracts';
import { SyncStatus } from '../../core/models';

/** A sync that has been "pending" longer than this since the last success is worth a look. */
export const SYNC_PENDING_TOO_LONG_MS = 10 * 60 * 1000;

/**
 * Sync needs attention when it failed, the session expired, a reading-position
 * conflict awaits a choice, or local changes have waited too long to upload.
 * Guests (`off`) and transient states (`syncing`, `offline`) never raise it.
 */
export function syncNeedsAttention(
  status: SyncStatus,
  lastSuccessAt: number | null,
  now: number = Date.now(),
): boolean {
  switch (status) {
    case 'error':
    case 'unauthorized':
    case 'conflict':
      return true;
    case 'pending':
      return lastSuccessAt !== null && now - lastSuccessAt > SYNC_PENDING_TOO_LONG_MS;
    default:
      return false;
  }
}

const OFFLINE_ATTENTION: ReadonlySet<DownloadState> = new Set(['paused', 'error', 'quota']);

/** The offline page download is paused, failed or out of storage (not merely idle/done). */
export function offlineNeedsAttention(s: Pick<OfflineStatus, 'state'>): boolean {
  return OFFLINE_ATTENTION.has(s.state);
}

/** Menu button dot: any of sync, app update or offline download needs the reader's attention. */
export function menuNeedsAttention(flags: {
  sync: boolean;
  update: boolean;
  offline: boolean;
}): boolean {
  return flags.sync || flags.update || flags.offline;
}

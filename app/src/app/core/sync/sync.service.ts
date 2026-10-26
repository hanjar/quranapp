import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { reportError } from '../storage/error-reporter';
import { TimeoutError, withTimeout } from '../async';
import { liveQuery } from 'dexie';
import { PositionConflict, SyncApi, UserDataApi } from '../contracts';
import { APP_CONFIG } from '../config';
import {
  Account,
  DEFAULT_EDITION,
  OutboxOperation,
  ReadingPosition,
  SyncState,
  SyncStatus,
} from '../models';
import { ReaderUiService } from '../reader-ui.service';
import { applyChanges, handleResults, reconcileReset } from './apply';
import { backoffDelay } from './backoff';
import { enqueueLocalSnapshot, makeOp, positionPayload, toWire } from './outbox';
import { SyncApiClient, SyncHttpError } from './sync-api-client';
import { SYNC_DB } from './sync-db';
import { Change, MeUser } from './sync-types';

/** Debounce after local outbox changes before a sync cycle starts. */
export const SYNC_DEBOUNCE_MS = 3000;
/** While the app is visible, look for changes made on other devices this often. */
export const SYNC_POLL_MS = 45_000;
const BATCH_SIZE = 100;
const PULL_LIMIT = 500;
const MIN_RETRY_MS = 1000;
const META_ACCOUNT = 'syncAccount';
const META_CONFLICT = 'syncPositionConflict';

const DEFAULT_STATE: SyncState = {
  key: 'state',
  enabled: false,
  accountId: null,
  cursor: 0,
  lastSuccessAt: null,
  status: 'off',
  lastErrorCode: null,
};

/**
 * Optional cloud sync client. Local-first: the app never depends on this
 * service for reading/writing; it only drains the outbox and applies pulls.
 * See docs/sync-client.md.
 */
/** Longer than the request timeout times the requests in a normal cycle. */
const CYCLE_TIMEOUT_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class SyncService extends SyncApi {
  private readonly db = inject(SYNC_DB);
  private readonly client = inject(SyncApiClient);
  private readonly userData = inject(UserDataApi);
  private readonly readerUi = inject(ReaderUiService);
  /** Aborts window/document listeners when the injector is destroyed (tests, HMR). */
  private readonly listeners = new AbortController();
  private readonly destroyRef = inject(DestroyRef);

  readonly available: boolean = APP_CONFIG.syncEnabled;
  private readonly _status = signal<SyncStatus>('off');
  private readonly _account = signal<Account | null>(null);
  private readonly _lastSuccessAt = signal<number | null>(null);
  private readonly _conflict = signal<PositionConflict | null>(null);
  readonly status = this._status.asReadonly();
  readonly account = this._account.asReadonly();
  readonly lastSuccessAt = this._lastSuccessAt.asReadonly();
  readonly conflict = this._conflict.asReadonly();
  /** When this device was last linked to an account by signing in (ms), else null. */
  readonly signedInAt = signal<number | null>(null);
  /** The first sync after signing in has not finished yet. */
  private firstLinkPending = false;
  /** Last newer reading position received from another device (a new object each time). */
  readonly remotePosition = signal<ReadingPosition | null>(null);

  private initialised = false;
  private inflight: Promise<void> | null = null;
  /** Step of the running cycle, reported when a cycle times out. */
  private phase = 'idle';
  private rerun: { verify: boolean } | null = null;
  /** True until the first successful cycle after init/login (position conflict detection window). */
  private coldStart = true;
  private pullFailures = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // -- lifecycle -------------------------------------------------------------

  async init(): Promise<void> {
    if (!this.available || this.initialised) return;
    this.initialised = true;
    this.registerTriggers();
    const url = new URL(location.href);
    const connected = url.searchParams.get('sync') === 'connected';
    if (connected) {
      url.searchParams.delete('sync');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    const st = await this.loadState();
    this._lastSuccessAt.set(st.lastSuccessAt);
    await this.restoreConflict();
    await this.bootstrap(connected);
  }

  signIn(_provider: 'google'): void {
    location.assign(this.client.startUrl(location.pathname));
  }

  async signInDev(email: string): Promise<void> {
    await this.client.devLogin(email);
    await this.bootstrap(true);
  }

  async signOut(opts: { clearLocal: boolean }): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      /* cookie may linger server-side; local sync is disabled regardless */
    }
    await this.disableSync();
    if (opts.clearLocal) {
      await this.db.transaction(
        'rw',
        [
          this.db.bookmarks,
          this.db.folders,
          this.db.positions,
          this.db.prefs,
          this.db.readDays,
          this.db.rounds,
          this.db.readMarks,
        ],
        async () => {
          await this.db.readMarks.clear();
          await this.db.readDays.clear();
          await this.db.rounds.clear();
          await this.db.bookmarks.clear();
          await this.db.folders.clear();
          await this.db.positions.clear();
          await this.db.prefs.clear();
        },
      );
    }
    await this.userData.reload();
  }

  async deleteCloudData(): Promise<void> {
    await this.client.deleteMyData();
    await this.disableSync();
    await this.userData.reload();
  }

  syncNow(): Promise<void> {
    return this.run(true);
  }

  async resolveConflict(choice: 'device' | 'cloud'): Promise<void> {
    const c = this._conflict();
    const st = await this.loadState();
    if (!c || !st.accountId) return;
    if (choice === 'device') {
      const local = (await this.db.positions.get(c.device.editionId)) ?? c.device;
      await this.db.transaction('rw', this.db.outbox, async () => {
        const stale = await this.db.outbox
          .filter((o) => o.accountId === st.accountId && o.entity === 'position')
          .primaryKeys();
        await this.db.outbox.bulkDelete(stale);
        await this.db.outbox.add(
          makeOp(
            st.accountId as string,
            'position',
            local.editionId,
            'upsert',
            positionPayload(local),
            c.cloud.rev,
          ),
        );
      });
      await this.clearConflict();
      await this.run(false);
    } else {
      await this.db.transaction('rw', this.db.positions, this.db.outbox, async () => {
        await this.db.positions.put(c.cloud);
        const stale = await this.db.outbox
          .filter((o) => o.accountId === st.accountId && o.entity === 'position')
          .primaryKeys();
        await this.db.outbox.bulkDelete(stale);
      });
      await this.clearConflict();
      await this.userData.reload();
      this.readerUi.goToPage(c.cloud.page);
      await this.refreshIdleStatus();
    }
  }

  // -- bootstrap / account handling -----------------------------------------

  /** `explicit` = the user just completed a sign-in (OAuth redirect or dev login). */
  private async bootstrap(explicit: boolean): Promise<void> {
    const st = await this.loadState();
    let user: MeUser | null;
    try {
      user = await this.client.me();
    } catch (e) {
      if (st.enabled) {
        this._account.set(await this.cachedAccount());
        this.setStatus(e instanceof SyncHttpError && e.kind === 'network' ? 'offline' : 'error');
      } else {
        this.setStatus('off');
      }
      return;
    }

    if (!user) {
      if (st.enabled) {
        this._account.set(await this.cachedAccount());
        this.setStatus('unauthorized');
      } else {
        this.setStatus('off');
      }
      return;
    }

    if (st.enabled && st.accountId === user.id) {
      await this.setAccount(user);
      this.coldStart = true;
      await this.run(false);
      return;
    }

    // Session belongs to someone else (or sync not enabled for this device).
    if (st.enabled && st.accountId && st.accountId !== user.id) await this.disableSync();
    if (!explicit) {
      this.setStatus('off');
      return;
    }
    await this.firstLink(user);
  }

  /** Flow F: link this device to an account, merging local data into it. */
  private async firstLink(user: MeUser): Promise<void> {
    await this.setAccount(user);
    await this.patchState({
      enabled: true,
      accountId: user.id,
      cursor: 0,
      status: 'idle',
      lastErrorCode: null,
    });
    await enqueueLocalSnapshot(this.db, user.id);
    this.coldStart = true;
    this.firstLinkPending = true;
    this.signedInAt.set(Date.now());
    this.setStatus('pending');
    await this.run(false);
  }

  /** Turns sync off for this device: no ops survive, local data is kept as anonymous. */
  private async disableSync(): Promise<void> {
    this.clearTimers();
    const st = await this.loadState();
    await this.db.transaction(
      'rw',
      [
        this.db.outbox,
        this.db.sync,
        this.db.meta,
        this.db.bookmarks,
        this.db.folders,
        this.db.positions,
        this.db.prefs,
        this.db.readDays,
        this.db.rounds,
        this.db.readMarks,
      ],
      async () => {
        if (st.accountId) await this.db.outbox.where('accountId').equals(st.accountId).delete();
        // Local rows keep their content but lose the account's revisions.
        await this.db.bookmarks.filter((b) => b.deletedAt != null).delete();
        await this.db.bookmarks.toCollection().modify({ rev: null });
        await this.db.folders.filter((f) => f.deletedAt != null).delete();
        await this.db.folders.toCollection().modify({ rev: null });
        await this.db.positions.toCollection().modify({ rev: null });
        await this.db.prefs.toCollection().modify({ rev: null });
        await this.db.readDays.toCollection().modify({ rev: null });
        await this.db.rounds.toCollection().modify({ rev: null });
        await this.db.readMarks.toCollection().modify({ rev: null });
        await this.db.meta.bulkDelete([META_ACCOUNT, META_CONFLICT]);
        await this.db.sync.put({ ...DEFAULT_STATE });
      },
    );
    this._account.set(null);
    this._conflict.set(null);
    this._lastSuccessAt.set(null);
    this.coldStart = true;
    this.setStatus('off');
  }

  // -- sync cycle ------------------------------------------------------------

  /** Single-flight; a request during a running cycle schedules exactly one follow-up. */
  private run(verify: boolean): Promise<void> {
    if (this.inflight) {
      this.rerun = { verify: verify || !!this.rerun?.verify };
      return this.inflight;
    }
    const p = (async () => {
      try {
        // A cycle stuck on the database (e.g. a frozen tab elsewhere) must not block every later sync.
        await withTimeout(this.cycle(verify), CYCLE_TIMEOUT_MS).catch((e: unknown) => {
          if (!(e instanceof TimeoutError)) throw e;
          reportError({ op: 'sync-timeout', name: 'TimeoutError', message: `phase ${this.phase}`, at: Date.now() });
          this.setStatus('error');
        });
      } finally {
        this.inflight = null;
      }
      const again = this.rerun;
      this.rerun = null;
      if (again) await this.run(again.verify);
    })();
    this.inflight = p;
    return p;
  }

  private async cycle(verify: boolean): Promise<void> {
    const st = await this.loadState();
    if (!st.enabled || !st.accountId) return;
    const accountId = st.accountId;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline');
      return;
    }
    this.clearTimer('retry');
    this.setStatus('syncing');
    let dirty = false;
    try {
      this.phase = 'verify';
      if (verify && !(await this.verifySession(accountId))) return;
      const cold = this.coldStart;
      this.phase = 'pull-cold';
      if (cold) dirty = (await this.pull(accountId, true)) || dirty;
      this.phase = 'push';
      dirty = (await this.push(accountId)) || dirty;
      this.phase = 'pull';
      dirty = (await this.pull(accountId, false)) || dirty;
      this.phase = 'finish';
      this.coldStart = false;
      this.firstLinkPending = false;
      this.pullFailures = 0;
      const now = Date.now();
      this._lastSuccessAt.set(now);
      await this.patchState({ lastSuccessAt: now });
      if (dirty) await this.userData.reload();
      await this.refreshIdleStatus(true);
    } catch (e) {
      if (dirty) await this.userData.reload();
      await this.onCycleError(accountId, e);
    }
  }

  private async verifySession(accountId: string): Promise<boolean> {
    const user = await this.client.me();
    if (!user) {
      this.setStatus('unauthorized');
      return false;
    }
    if (user.id !== accountId) {
      await this.disableSync();
      await this.userData.reload();
      return false;
    }
    await this.setAccount(user);
    return true;
  }

  private async push(accountId: string): Promise<boolean> {
    const attempted = new Set<string>();
    let changed = false;
    for (;;) {
      const now = Date.now();
      const held = !!this._conflict();
      const due = await this.db.outbox
        .where('accountId')
        .equals(accountId)
        .filter(
          (o) =>
            o.nextAttemptAt <= now && !attempted.has(o.opId) && !(held && o.entity === 'position'),
        )
        .sortBy('createdAt');
      if (!due.length) return changed;
      const batch = due.slice(0, BATCH_SIZE);
      batch.forEach((o) => attempted.add(o.opId));
      let res;
      try {
        res = await this.client.pushBatch(batch.map(toWire));
      } catch (e) {
        await this.backoffOps(batch, e);
        throw e;
      }
      const outcome = await handleResults(
        this.db,
        accountId,
        batch,
        res.results,
        this.applyOpts(false),
      );
      changed = changed || outcome.changed;
      if (outcome.missing.length) await this.backoffOps(outcome.missing, null);
      // folder_name_taken is benign: the server folder arrives by pull and merges by name.
      const fatal = outcome.rejected.filter((r) => r.error !== 'folder_name_taken');
      if (fatal.length) {
        const first = fatal[0];
        await this.patchState({ lastErrorCode: `rejected:${first?.error ?? 'unknown'}` });
        reportError({ op: 'sync-push', name: 'Rejected', message: fatal.map((r) => r.error).join(', ').slice(0, 300), at: Date.now() });
      }
    }
  }

  private async pull(accountId: string, detect: boolean): Promise<boolean> {
    let cursor = (await this.loadState()).cursor;
    let changed = false;
    for (;;) {
      const page = await this.client.pull(cursor, PULL_LIMIT);
      if (page.reset && cursor !== 0) {
        await this.fullReconcile(accountId, detect);
        return true;
      }
      const res = await applyChanges(this.db, accountId, page.changes, this.applyOpts(detect));
      await this.noteConflict(res.conflict);
      if (res.remotePosition) this.remotePosition.set({ ...res.remotePosition });
      changed = changed || res.changed;
      const advanced = page.cursor > cursor;
      cursor = page.cursor;
      await this.patchState({ cursor });
      if (!page.hasMore || !advanced) return changed;
    }
  }

  private async fullReconcile(accountId: string, detect: boolean): Promise<void> {
    const all: Change[] = [];
    let cursor = 0;
    for (;;) {
      const page = await this.client.pull(cursor, PULL_LIMIT);
      all.push(...page.changes);
      const advanced = page.cursor > cursor;
      cursor = page.cursor;
      if (!page.hasMore || !advanced) break;
    }
    const res = await reconcileReset(this.db, accountId, all, this.applyOpts(detect));
    await this.noteConflict(res.conflict);
    if (res.remotePosition) this.remotePosition.set({ ...res.remotePosition });
    await this.patchState({ cursor });
  }

  private applyOpts(detect: boolean) {
    return {
      localDeviceId: this.userData.deviceId(),
      detectPositionConflict: detect,
      holdPosition: !!this._conflict(),
      firstLink: detect && this.firstLinkPending,
    };
  }

  // -- errors & backoff ------------------------------------------------------

  private async onCycleError(accountId: string, e: unknown): Promise<void> {
    const err = e instanceof SyncHttpError ? e : new SyncHttpError('network');
    await this.patchState({ lastErrorCode: err.code ?? err.kind });
    // Offline is normal; anything else is worth knowing about.
    if (err.kind !== 'network') reportError({ op: 'sync', name: err.kind, message: String(err.code ?? ''), at: Date.now() });
    switch (err.kind) {
      case 'unauthorized':
        this.setStatus('unauthorized');
        return;
      case 'network':
        this.setStatus('offline');
        break;
      default:
        this.setStatus('error');
    }
    // Schedule one retry at the earliest backed-off op, or by pull-failure backoff.
    const ops = await this.db.outbox.where('accountId').equals(accountId).toArray();
    const now = Date.now();
    const next = ops.length ? Math.min(...ops.map((o) => o.nextAttemptAt)) : null;
    let delay: number;
    if (next != null && next > now) {
      delay = next - now;
    } else {
      this.pullFailures++;
      delay = backoffDelay(this.pullFailures, Math.random, err.retryAfterMs);
    }
    this.schedule('retry', Math.max(MIN_RETRY_MS, delay), false);
  }

  private async backoffOps(ops: OutboxOperation[], e: unknown): Promise<void> {
    if (e instanceof SyncHttpError && e.kind === 'unauthorized') return; // keep outbox untouched
    const retryAfter = e instanceof SyncHttpError ? e.retryAfterMs : null;
    const now = Date.now();
    await this.db.transaction('rw', this.db.outbox, async () => {
      for (const op of ops) {
        const retryCount = op.retryCount + 1;
        await this.db.outbox.update(op.opId, {
          retryCount,
          nextAttemptAt: now + backoffDelay(retryCount, Math.random, retryAfter),
        });
      }
    });
  }

  // -- status / state --------------------------------------------------------

  private async refreshIdleStatus(afterSuccess = false): Promise<void> {
    if (this._conflict()) {
      this.setStatus('conflict');
      return;
    }
    const st = await this.loadState();
    if (!st.enabled || !st.accountId) {
      this.setStatus('off');
      return;
    }
    const pending = await this.db.outbox.where('accountId').equals(st.accountId).count();
    this.setStatus(pending > 0 ? 'pending' : afterSuccess ? 'synced' : 'idle');
  }

  private setStatus(s: SyncStatus): void {
    this._status.set(s);
    void this.patchState({ status: s }).catch(() => undefined);
  }

  private async loadState(): Promise<SyncState> {
    return (await this.db.sync.get('state')) ?? { ...DEFAULT_STATE };
  }

  /** Serialised read-modify-write so concurrent patches never clobber each other. */
  private stateQueue: Promise<unknown> = Promise.resolve();
  private patchState(patch: Partial<SyncState>): Promise<void> {
    const next = this.stateQueue.then(async () => {
      const cur = await this.loadState();
      await this.db.sync.put({ ...cur, ...patch, key: 'state' });
    });
    this.stateQueue = next.catch(() => undefined);
    return next;
  }

  private async setAccount(user: MeUser): Promise<void> {
    const acc: Account = { id: user.id, email: user.email, name: user.name };
    this._account.set(acc);
    await this.db.meta.put({ key: META_ACCOUNT, value: acc });
  }

  private async cachedAccount(): Promise<Account | null> {
    return ((await this.db.meta.get(META_ACCOUNT))?.value as Account | undefined) ?? null;
  }

  // -- position conflict persistence ----------------------------------------

  private async noteConflict(c: PositionConflict | null): Promise<void> {
    if (!c) return;
    this._conflict.set(c);
    await this.db.meta.put({ key: META_CONFLICT, value: c.cloud });
  }

  private async clearConflict(): Promise<void> {
    this._conflict.set(null);
    await this.db.meta.delete(META_CONFLICT);
  }

  private async restoreConflict(): Promise<void> {
    const cloud = (await this.db.meta.get(META_CONFLICT))?.value as ReadingPosition | undefined;
    if (!cloud) return;
    const device = await this.db.positions.get(cloud.editionId ?? DEFAULT_EDITION);
    if (device && device.page !== cloud.page) this._conflict.set({ device, cloud });
    else await this.db.meta.delete(META_CONFLICT);
  }

  // -- triggers --------------------------------------------------------------

  private registerTriggers(): void {
    const signal = this.listeners.signal;
    this.destroyRef.onDestroy(() => {
      this.listeners.abort();
      this.clearTimers();
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.trigger(), { signal });
      window.addEventListener(
        'offline',
        () => {
          if (this._status() !== 'off') this.setStatus('offline');
        },
        { signal },
      );
    }
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'visible') this.trigger();
          // Leaving the app (switching device or tab): send pending changes now
          // instead of waiting for the debounce, so the other device sees them.
          else if (this.debounceTimer) {
            this.clearTimer('debounce');
            this.trigger();
          }
        },
        { signal },
      );
      // Pick up changes from other devices while this one stays open.
      const poll = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine !== false && !this.inflight)
          this.trigger();
      }, SYNC_POLL_MS);
      this.destroyRef.onDestroy(() => clearInterval(poll));
    }
    // Debounced sync after local outbox changes.
    const sub = liveQuery(async () => {
      const st = await this.db.sync.get('state');
      if (!st?.enabled || !st.accountId) return [] as number[];
      const ops = await this.db.outbox.where('accountId').equals(st.accountId).toArray();
      return ops.map((o) => o.nextAttemptAt);
    }).subscribe({
      next: (attempts) => {
        if (!attempts.length) return;
        const now = Date.now();
        const wait = Math.max(SYNC_DEBOUNCE_MS, Math.min(...attempts) - now);
        if (!this.inflight && ['idle', 'synced'].includes(this._status()))
          this.setStatus('pending');
        this.schedule('debounce', wait, false);
      },
      error: () => undefined,
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  /** Event-driven sync; failures surface through status, never as unhandled rejections. */
  private trigger(): void {
    this.onTrigger(true).catch(() => undefined);
  }

  private async onTrigger(verify: boolean): Promise<void> {
    const st = await this.loadState();
    if (!st.enabled) return;
    await this.run(verify);
  }

  private schedule(which: 'debounce' | 'retry', ms: number, verify: boolean): void {
    this.clearTimer(which);
    const t = setTimeout(() => {
      if (which === 'debounce') this.debounceTimer = null;
      else this.retryTimer = null;
      void this.run(verify);
    }, ms);
    if (which === 'debounce') this.debounceTimer = t;
    else this.retryTimer = t;
  }

  private clearTimer(which: 'debounce' | 'retry'): void {
    const t = which === 'debounce' ? this.debounceTimer : this.retryTimer;
    if (t) clearTimeout(t);
    if (which === 'debounce') this.debounceTimer = null;
    else this.retryTimer = null;
  }

  private clearTimers(): void {
    this.clearTimer('debounce');
    this.clearTimer('retry');
  }
}

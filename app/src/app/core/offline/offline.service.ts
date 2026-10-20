import { Injectable, inject, signal } from '@angular/core';
import { DownloadState, OfflineApi, OfflineStatus } from '../contracts';
import { ContentManifest, PAGE_COUNT, PageLoadError } from '../models';
import { MUSHAF_DB } from '../storage/db-token';
import {
  cacheStorageAvailable,
  cachedPageNumbers,
  deletePageCaches,
  fetchManifest,
  fetchVerifiedPage,
  isQuotaError,
  META_OFFLINE_PACKAGE,
  META_PAGE_LRU,
  OfflinePackageMeta,
  pageFileKey,
  putPageInCache,
} from '../content/page-cache';

const CONCURRENCY = 4;

@Injectable({ providedIn: 'root' })
export class OfflineService extends OfflineApi {
  private readonly db = inject(MUSHAF_DB);

  private readonly _status = signal<OfflineStatus>({
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    cachedPages: 0,
    totalPages: PAGE_COUNT,
    cachedBytes: 0,
    totalBytes: 0,
    state: 'idle',
    failedPages: [],
    persisted: null,
  });
  readonly status = this._status.asReadonly();

  private manifest: ContentManifest | null = null;
  private cached = new Set<number>();
  private paused = false;
  private runToken = 0;
  private active: Promise<void> | null = null;

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.patch({ online: true }));
      window.addEventListener('offline', () => this.patch({ online: false }));
    }
  }

  /** Background meta writes tolerate a closed database (app/test teardown) only. */
  private async quiet(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if ((e as { name?: string } | null)?.name !== 'DatabaseClosedError') throw e;
    }
  }

  /** Resolves when any in-flight download has finished (tests / teardown). */
  async idle(): Promise<void> {
    while (this.active) await this.active.catch(() => undefined);
  }

  private patch(p: Partial<OfflineStatus>): void {
    this._status.update((s) => ({ ...s, ...p }));
  }

  private async ensureManifest(): Promise<ContentManifest> {
    this.manifest ??= await fetchManifest();
    return this.manifest;
  }

  private bytesOf(pages: Iterable<number>): number {
    const files = this.manifest?.files ?? {};
    let sum = 0;
    for (const p of pages) sum += files[pageFileKey(p)]?.bytes ?? 0;
    return sum;
  }

  private publishCounts(): void {
    this.patch({
      cachedPages: this.cached.size,
      cachedBytes: this.bytesOf(this.cached),
    });
  }

  async refresh(): Promise<void> {
    let persisted: boolean | null = null;
    try {
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      persisted = null;
    }
    this.patch({ online: navigator.onLine !== false, persisted });
    try {
      const manifest = await this.ensureManifest();
      this.cached = new Set(await cachedPageNumbers(manifest.contentVersion));
      this.patch({ totalBytes: manifest.totalBytes });
      this.publishCounts();
      if (this.active === null && !this.paused) {
        const complete = this.cached.size >= PAGE_COUNT;
        const state = this._status().state;
        if (state === 'idle' || state === 'done') this.patch({ state: complete ? 'done' : 'idle' });
      }
    } catch {
      /* manifest unavailable (offline, first load): keep what we know */
    }
  }

  startFullDownload(): Promise<void> {
    return this.download(true);
  }

  resume(): Promise<void> {
    return this.download(false);
  }

  retryFailed(): Promise<void> {
    return this.download(false);
  }

  pause(): void {
    if (this.active === null) return;
    this.paused = true;
    this.patch({ state: 'paused' });
  }

  private download(requestPersist: boolean): Promise<void> {
    if (this.active && !this.paused) return this.active;
    const prev = this.active;
    this.paused = false;
    const token = ++this.runToken;
    const run = (async () => {
      if (prev) await prev.catch(() => undefined); // let old workers drain first
      await this.runDownload(requestPersist, token);
    })();
    this.active = run;
    const clear = () => {
      if (this.active === run) this.active = null;
    };
    run.then(clear, clear);
    return run;
  }

  private async runDownload(requestPersist: boolean, token: number): Promise<void> {
    const live = () => token === this.runToken;
    let manifest: ContentManifest;
    try {
      manifest = await this.ensureManifest();
    } catch {
      if (live()) this.patch({ state: 'error' });
      return;
    }
    if (!cacheStorageAvailable()) {
      if (live()) this.patch({ state: 'error' });
      return;
    }
    if (!live()) return;
    this.patch({
      state: this.paused ? 'paused' : 'downloading',
      totalBytes: manifest.totalBytes,
      failedPages: [],
    });

    if (requestPersist) {
      let persisted: boolean | null = null;
      try {
        persisted = (await navigator.storage?.persist?.()) ?? null;
      } catch {
        persisted = null;
      }
      this.patch({ persisted });
    }

    await deletePageCaches(manifest.contentVersion);
    this.cached = new Set(await cachedPageNumbers(manifest.contentVersion));
    this.publishCounts();

    // Pin so ContentService never evicts pages while the package is being built.
    const pkg: OfflinePackageMeta = {
      pinned: true,
      contentVersion: manifest.contentVersion,
      complete: this.cached.size >= PAGE_COUNT,
      persisted: this._status().persisted,
    };
    await this.quiet(() => this.db.meta.put({ key: META_OFFLINE_PACKAGE, value: pkg }));
    await this.quiet(() => this.db.meta.delete(META_PAGE_LRU));

    const queue: number[] = [];
    for (let p = 1; p <= PAGE_COUNT; p++) if (!this.cached.has(p)) queue.push(p);
    const failed: number[] = [];
    let endState: DownloadState | null = null;
    let wentOffline = false;

    const worker = async (): Promise<void> => {
      while (live() && !this.paused && !wentOffline && endState === null) {
        const page = queue.shift();
        if (page === undefined) return;
        try {
          const buf = await fetchVerifiedPage(page, manifest);
          await putPageInCache(page, buf, manifest.contentVersion);
          this.cached.add(page);
          this.publishCounts();
        } catch (e) {
          if (isQuotaError(e)) {
            endState = 'quota';
          } else if (e instanceof PageLoadError && e.kind === 'offline') {
            queue.unshift(page);
            wentOffline = true; // user resumes explicitly once back online
          } else {
            failed.push(page);
            this.patch({ failedPages: [...failed].sort((a, b) => a - b) });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!live()) return;

    let state: DownloadState;
    if (endState) state = endState;
    else if (this.paused || wentOffline) state = 'paused';
    else if (failed.length > 0 || this.cached.size < PAGE_COUNT) state = 'error';
    else state = 'done';
    if (state === 'done') {
      await this.quiet(() =>
        this.db.meta.put({ key: META_OFFLINE_PACKAGE, value: { ...pkg, complete: true } }),
      );
    }
    if (wentOffline) this.paused = true;
    this.patch({ state, failedPages: [...failed].sort((a, b) => a - b) });
  }

  async clearPages(): Promise<void> {
    this.runToken++; // invalidates any running download
    this.paused = false;
    if (this.active) await this.active.catch(() => undefined);
    await deletePageCaches();
    await this.quiet(() => this.db.meta.delete(META_PAGE_LRU));
    await this.quiet(() => this.db.meta.delete(META_OFFLINE_PACKAGE));
    this.cached = new Set();
    this.patch({ cachedPages: 0, cachedBytes: 0, failedPages: [], state: 'idle' });
  }
}

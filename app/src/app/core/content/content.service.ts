import { Injectable, inject, signal } from '@angular/core';
import { APP_CONFIG } from '../config';
import { ContentApi } from '../contracts';
import {
  AyahRef,
  ContentIndex,
  ContentManifest,
  Edition,
  isValidPage,
  JuzMeta,
  PAGE_COUNT,
  PageLoadError,
  PageMeta,
  SurahMeta,
} from '../models';
import { MUSHAF_DB } from '../storage/db-token';
import {
  cacheStorageAvailable,
  cachedPageNumbers,
  deletePageCaches,
  deletePageFromCache,
  fetchVerifiedPage,
  getPageFromCache,
  isOffline,
  META_OFFLINE_PACKAGE,
  META_PAGE_LRU,
  OfflinePackageMeta,
  pageCacheName,
  pageUrl,
  putPageInCache,
  saveDataEnabled,
  verifyPageBuffer,
} from './page-cache';

const DOC_LRU_SIZE = 6;
const LOAD_ERROR = 'Data mushaf gagal dimuat. Periksa koneksi internet lalu coba lagi.';

const refKey = (surah: number, ayah: number) => surah * 1000 + ayah;

/** Throws PageLoadError('integrity') when an SVG is malformed or unsafe (defense in depth). */
export function parseSafeSvg(page: number, text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new PageLoadError(page, 'integrity', `Halaman ${page} rusak.`);
  }
  const all = [root, ...Array.from(root.getElementsByTagName('*'))];
  for (const el of all) {
    const name = el.localName.toLowerCase();
    if (name === 'script' || name === 'foreignobject') {
      throw new PageLoadError(page, 'integrity', `Halaman ${page} berisi elemen tidak aman.`);
    }
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || (n.endsWith('href') && /^\s*javascript:/i.test(attr.value))) {
        throw new PageLoadError(page, 'integrity', `Halaman ${page} berisi atribut tidak aman.`);
      }
    }
  }
  return root as unknown as SVGSVGElement;
}

@Injectable({ providedIn: 'root' })
export class ContentService extends ContentApi {
  private readonly db = inject(MUSHAF_DB);

  private readonly _index = signal<ContentIndex | null>(null);
  private readonly _loadError = signal<string | null>(null);
  readonly index = this._index.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  private manifest: ContentManifest | null = null;
  private loading: Promise<void> | null = null;

  /** Parsed documents, Map insertion order = recency (oldest first). */
  private readonly docs = new Map<number, SVGSVGElement>();
  private readonly inflight = new Map<number, Promise<SVGSVGElement>>();
  private lruChain: Promise<void> = Promise.resolve();
  private cleanup: Promise<void> = Promise.resolve();

  load(): Promise<void> {
    if (this._index()) return Promise.resolve();
    this.loading ??= this.doLoad().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    const base = `${APP_CONFIG.contentBase}/${APP_CONFIG.editionId}`;
    try {
      const get = async <T>(name: string): Promise<T> => {
        const res = await fetch(`${base}/${name}.json`);
        if (!res.ok) throw new Error(`${name} ${res.status}`);
        return (await res.json()) as T;
      };
      const [edition, surahs, pages, juz, manifest] = await Promise.all([
        get<Edition>('edition'),
        get<SurahMeta[]>('surahs'),
        get<PageMeta[]>('pages'),
        get<JuzMeta[]>('juz'),
        get<ContentManifest>('manifest'),
      ]);
      if (surahs.length !== 114 || pages.length !== PAGE_COUNT || juz.length !== 30) {
        throw new Error('metadata tidak lengkap');
      }
      this.manifest = manifest;
      this._index.set({ edition, surahs, pages, juz });
      this._loadError.set(null);
    } catch {
      this._loadError.set(LOAD_ERROR);
      return;
    }
    this.cleanup = this.cleanupOldCaches().catch(() => undefined);
  }

  private async cleanupOldCaches(): Promise<void> {
    const version = this.manifest!.contentVersion;
    await deletePageCaches(version);
    const pkg = (await this.db.meta.get(META_OFFLINE_PACKAGE))?.value as
      | OfflinePackageMeta
      | undefined;
    if (pkg && pkg.contentVersion !== version) {
      await this.db.meta.delete(META_OFFLINE_PACKAGE);
      await this.db.meta.delete(META_PAGE_LRU);
    }
  }

  // ---- lookups -------------------------------------------------------------

  private idx(): ContentIndex {
    const i = this._index();
    if (!i) throw new Error('Konten belum dimuat');
    return i;
  }

  pageMeta(page: number): PageMeta {
    const meta = this.idx().pages[page - 1];
    if (!meta) throw new RangeError(`Halaman ${page} tidak valid`);
    return meta;
  }

  surah(number: number): SurahMeta {
    const s = this.idx().surahs[number - 1];
    if (!s) throw new RangeError(`Surah ${number} tidak valid`);
    return s;
  }

  surahAt(page: number): SurahMeta {
    return this.surah(this.pageMeta(page).first.surah);
  }

  juzAt(page: number): JuzMeta {
    return this.idx().juz[this.pageMeta(page).juz - 1];
  }

  pageOf(ref: AyahRef): number | null {
    const idx = this._index();
    if (!idx) return null;
    const s = idx.surahs[ref.surah - 1];
    if (!s || !Number.isInteger(ref.ayah) || ref.ayah < 1 || ref.ayah > s.ayahCount) return null;
    const key = refKey(ref.surah, ref.ayah);
    const pages = idx.pages;
    // Smallest page whose last ayah >= ref → first page when a verse spans two.
    let lo = 0;
    let hi = pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (refKey(pages[mid].last.surah, pages[mid].last.ayah) >= key) hi = mid;
      else lo = mid + 1;
    }
    const p = pages[lo];
    if (refKey(p.last.surah, p.last.ayah) < key || refKey(p.first.surah, p.first.ayah) > key) {
      return null;
    }
    return p.page;
  }

  // ---- page artwork --------------------------------------------------------

  async getPage(page: number): Promise<SVGSVGElement> {
    if (!isValidPage(page)) throw new PageLoadError(page, 'not-found');
    const root = await this.parsedPage(page);
    return document.importNode(root, true) as unknown as SVGSVGElement;
  }

  private parsedPage(page: number): Promise<SVGSVGElement> {
    const hit = this.docs.get(page);
    if (hit) {
      this.docs.delete(page);
      this.docs.set(page, hit);
      return Promise.resolve(hit);
    }
    let pending = this.inflight.get(page);
    if (!pending) {
      pending = this.loadParsed(page).finally(() => this.inflight.delete(page));
      this.inflight.set(page, pending);
    }
    return pending;
  }

  private async loadParsed(page: number): Promise<SVGSVGElement> {
    await this.load();
    const manifest = this.manifest;
    if (!manifest) throw new PageLoadError(page, isOffline() ? 'offline' : 'network');
    const version = manifest.contentVersion;

    let buf: ArrayBuffer | null = null;
    let cached = false;
    try {
      buf = await getPageFromCache(page, version);
    } catch {
      buf = null;
    }
    if (buf && (await verifyPageBuffer(page, buf, manifest))) {
      cached = true;
    } else {
      if (buf) await deletePageFromCache(page, version).catch(() => undefined); // corrupted entry
      buf = await fetchVerifiedPage(page, manifest);
      try {
        await putPageInCache(page, buf, version);
        cached = cacheStorageAvailable();
      } catch {
        cached = false; // quota or unavailable: still serve from network
      }
    }

    const root = parseSafeSvg(page, new TextDecoder('utf-8').decode(buf));
    this.docs.set(page, root);
    while (this.docs.size > DOC_LRU_SIZE) {
      this.docs.delete(this.docs.keys().next().value as number);
    }
    if (cached) void this.touchLru(page, version);
    return root;
  }

  /** Records auto-cache recency in meta and evicts beyond the limit (unless pinned). */
  private touchLru(page: number, version: string): Promise<void> {
    this.lruChain = this.lruChain
      .then(async () => {
        const pkg = (await this.db.meta.get(META_OFFLINE_PACKAGE))?.value as
          | OfflinePackageMeta
          | undefined;
        if (pkg?.pinned && pkg.contentVersion === version) return;
        const stored = (await this.db.meta.get(META_PAGE_LRU))?.value;
        const lru = (Array.isArray(stored) ? (stored as number[]) : []).filter((p) => p !== page);
        lru.push(page);
        while (lru.length > APP_CONFIG.autoCacheLimit) {
          const old = lru.shift()!;
          await deletePageFromCache(old, version);
          this.docs.delete(old);
        }
        await this.db.meta.put({ key: META_PAGE_LRU, value: lru });
      })
      .catch(() => undefined);
    return this.lruChain;
  }

  /** Resolves when pending LRU bookkeeping has been written (used by tests). */
  async settled(): Promise<void> {
    await this.cleanup;
    await this.lruChain;
    while (this.inflight.size) await Promise.allSettled([...this.inflight.values()]);
    await this.lruChain;
  }

  prefetch(pages: number[]): void {
    if (isOffline() || saveDataEnabled()) return;
    const todo = pages.filter((p) => isValidPage(p) && !this.docs.has(p));
    if (!todo.length) return;
    const run = () => {
      void (async () => {
        for (const p of todo) {
          if (isOffline() || saveDataEnabled()) return;
          try {
            await this.parsedPage(p);
          } catch {
            /* best effort */
          }
        }
      })();
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (typeof ric === 'function') ric(run);
    else setTimeout(run, 200);
  }

  async isPageAvailableOffline(page: number): Promise<boolean> {
    if (!isValidPage(page)) return false;
    await this.load();
    const manifest = this.manifest;
    if (!manifest || !cacheStorageAvailable()) return false;
    try {
      const cache = await caches.open(pageCacheName(manifest.contentVersion));
      return !!(await cache.match(pageUrl(page, manifest.contentVersion)));
    } catch {
      return false;
    }
  }

  /** Pages currently in the page cache (diagnostics / tests). */
  async cachedPages(): Promise<number[]> {
    await this.load();
    return this.manifest ? cachedPageNumbers(this.manifest.contentVersion) : [];
  }
}

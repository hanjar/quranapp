import { APP_CONFIG } from '../config';
import { ContentManifest, PAGE_COUNT, PageLoadError } from '../models';

/** Helpers shared by ContentService and OfflineService (cache naming, integrity). */

export const PAGE_CACHE_PREFIX = 'mushaf-pages-';

export function pageCacheName(contentVersion: string): string {
  return `${PAGE_CACHE_PREFIX}${contentVersion}`;
}

export function pageFileKey(page: number): string {
  return `svg/${String(page).padStart(3, '0')}.svg`;
}

export function editionBase(editionId: string = APP_CONFIG.editionId): string {
  return `${APP_CONFIG.contentBase}/${editionId}`;
}

export function pageUrl(page: number, contentVersion: string): string {
  return `${editionBase()}/${pageFileKey(page)}?v=${encodeURIComponent(contentVersion)}`;
}

export function cacheStorageAvailable(): boolean {
  return typeof caches !== 'undefined' && !!caches;
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function saveDataEnabled(): boolean {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return !!conn?.saveData;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  // Copy into a plain Uint8Array: tolerant of cross-realm ArrayBuffers (jsdom).
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buf.slice(0)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the buffer matches the manifest entry for the page. */
export async function verifyPageBuffer(
  page: number,
  buf: ArrayBuffer,
  manifest: ContentManifest,
): Promise<boolean> {
  const entry = manifest.files[pageFileKey(page)];
  if (!entry) return false;
  return (await sha256Hex(buf)) === entry.sha256.toLowerCase();
}

export async function fetchManifest(): Promise<ContentManifest> {
  const res = await fetch(`${editionBase()}/manifest.json`);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return (await res.json()) as ContentManifest;
}

/** Fetches a page from the network and verifies it. Throws PageLoadError. */
export async function fetchVerifiedPage(
  page: number,
  manifest: ContentManifest,
): Promise<ArrayBuffer> {
  if (isOffline()) throw new PageLoadError(page, 'offline', 'Anda sedang offline.');
  let res: Response;
  try {
    res = await fetch(pageUrl(page, manifest.contentVersion));
  } catch {
    throw new PageLoadError(page, isOffline() ? 'offline' : 'network');
  }
  if (res.status === 404) throw new PageLoadError(page, 'not-found');
  if (!res.ok) throw new PageLoadError(page, 'network');
  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    throw new PageLoadError(page, isOffline() ? 'offline' : 'network');
  }
  if (!(await verifyPageBuffer(page, buf, manifest))) {
    throw new PageLoadError(page, 'integrity', `Halaman ${page} gagal diverifikasi.`);
  }
  return buf;
}

export async function putPageInCache(
  page: number,
  buf: ArrayBuffer,
  contentVersion: string,
): Promise<void> {
  if (!cacheStorageAvailable()) return;
  const cache = await caches.open(pageCacheName(contentVersion));
  await cache.put(
    pageUrl(page, contentVersion),
    new Response(buf, { headers: { 'Content-Type': 'image/svg+xml' } }),
  );
}

export async function getPageFromCache(
  page: number,
  contentVersion: string,
): Promise<ArrayBuffer | null> {
  if (!cacheStorageAvailable()) return null;
  const cache = await caches.open(pageCacheName(contentVersion));
  const hit = await cache.match(pageUrl(page, contentVersion));
  return hit ? hit.arrayBuffer() : null;
}

export async function deletePageFromCache(page: number, contentVersion: string): Promise<void> {
  if (!cacheStorageAvailable()) return;
  const cache = await caches.open(pageCacheName(contentVersion));
  await cache.delete(pageUrl(page, contentVersion));
}

/** Page numbers present in the cache for the given content version. */
export async function cachedPageNumbers(contentVersion: string): Promise<number[]> {
  if (!cacheStorageAvailable()) return [];
  const cache = await caches.open(pageCacheName(contentVersion));
  const out: number[] = [];
  for (const req of await cache.keys()) {
    const m = /svg\/(\d{3})\.svg/.exec(req.url);
    if (!m) continue;
    const p = Number(m[1]);
    if (p >= 1 && p <= PAGE_COUNT) out.push(p);
  }
  return out;
}

/** Deletes page caches. With `keepVersion`, only older/other versions go. */
export async function deletePageCaches(keepVersion?: string): Promise<void> {
  if (!cacheStorageAvailable()) return;
  const keep = keepVersion ? pageCacheName(keepVersion) : null;
  for (const name of await caches.keys()) {
    if (name.startsWith(PAGE_CACHE_PREFIX) && name !== keep) await caches.delete(name);
  }
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return !!err && (err.name === 'QuotaExceededError' || err.code === 22);
}

export const META_PAGE_LRU = 'pageLru';
export const META_OFFLINE_PACKAGE = 'offlinePackage';
export interface OfflinePackageMeta {
  pinned: boolean;
  contentVersion: string;
  complete?: boolean;
  persisted?: boolean | null;
}

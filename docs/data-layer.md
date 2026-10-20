# Data layer (content, offline, user data)

Code: `app/src/app/core/{content,offline,storage}/`. Contracts: `core/contracts.ts`.

## Content (`ContentService`)
- `load()` fetches `content/<edition>/{edition,surahs,pages,juz,manifest}.json`; failure sets Indonesian `loadError` (retry by calling `load()` again).
- `pageOf(ref)` binary-searches `pages[].last`; a verse spanning two pages resolves to the first.
- `getPage(n)` order: in-memory parsed LRU (6) -> Cache Storage `mushaf-pages-<contentVersion>` -> network. Every buffer is sha256-verified against the manifest (a bad cache entry is deleted and refetched; a bad network response throws `PageLoadError('integrity')`). The SVG is parsed with `DOMParser` and rejected if it contains `script`, `foreignObject`, `on*` attributes or `javascript:` hrefs. Each call returns a fresh `document.importNode` clone; concurrent calls for a page share one request.
- Error kinds: `offline` (navigator offline / fetch failed while offline), `not-found` (404), `network`, `integrity`.
- Auto cache is bounded to `APP_CONFIG.autoCacheLimit`: recency list in `db.meta['pageLru']`, oldest evicted. Eviction is skipped when `db.meta['offlinePackage'] = {pinned:true, contentVersion}` matches. Caches of other content versions are deleted on `load()`.
- `prefetch(pages)` runs at idle (`requestIdleCallback`, else `setTimeout`) and is skipped offline or with `saveData`.

## Offline (`OfflineService`)
- Explicit full download of 604 pages, concurrency 4, progress from verified pages and manifest bytes. Writes the pin meta first so pages are never evicted mid-download.
- `pause()/resume()`, `retryFailed()` (only missing pages are fetched), `QuotaExceededError` -> state `quota`, going offline mid-run -> `paused`. `navigator.storage.persist()` is requested on `startFullDownload()`; result in `status().persisted`.
- `clearPages()` deletes `mushaf-pages-*` caches and the LRU/pin meta only; bookmarks, position and prefs are untouched.
- Shared helpers (cache names, sha256, fetch+verify) live in `content/page-cache.ts`.

## User data (`UserDataService`)
- Dexie via the `MUSHAF_DB` token (`storage/db-token.ts`); specs provide a fresh `MushafDb`.
- All writes are serialized. When `db.sync['state']` is `enabled` with an `accountId`, each write enqueues an `OutboxOperation` in the same transaction (`storage/outbox.ts`). A new op replaces any pending op for the same entity+entityId, so there is at most one pending position/prefs op.
- Prefs ops are only queued when a synced field changes (`onboardingDone` is local-only).
- Bookmarks: one active bookmark per semantic key; toggling off tombstones, adding again makes a new id. `removeBookmark` returns an undo (valid 6 s, no-op if the key was re-added).
- `savePosition` writes immediately, then at most every 2 s; flushed on `visibilitychange` (hidden) and `pagehide`.
- Export/import: `storage/export-file.ts`. Max 2 MB; format/version/edition checked; every field validated (page 1-604, surah 1-114, ayah >= 1). Bookmarks merge by key (duplicates skipped, new ids assigned). The position is imported only if newer than the local one; preferences only restore onto a never-customised device.

## Testing notes
Specs call `installFakeIndexedDb()` (`storage/testing.ts`) instead of `import 'fake-indexeddb/auto'`, because the auto import only installs globals once when several specs share a bundle chunk. `content/testing.ts` provides a synthetic 604-page fixture, a fake `fetch` and a fake Cache Storage.

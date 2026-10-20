/**
 * Build-time configuration. The sync API is served same-origin under /api
 * (Cloudflare Worker route); `ng serve` proxies /api to `wrangler dev`
 * (see proxy.conf.json). Set syncEnabled=false for a pure local-only build.
 */
export const APP_CONFIG = {
  apiBase: '/api/v1',
  syncEnabled: true,
  contentBase: 'content',
  editionId: 'hafs-kfqc',
  /** Pages prefetched on each side of the visible page(s). */
  prefetchRadius: 2,
  /** Max pages kept in the automatic (non-pinned) page cache. */
  autoCacheLimit: 60,
} as const;

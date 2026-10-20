# Digital Mushaf — Product & Technical Specification
Version 0.1 | 20 October 2026 | Status: Proposed / validate dependencies

## 1. Product vision
A mobile-first, tablet-friendly, distraction-free interactive Quran reader that faithfully reproduces the 604-page Hafs Madinah mushaf using SVG page artwork. Elegant book-like appearance, gesture-first reading, persistent reading position, verse/page bookmarks, optional cloud sync. Tajweed coloring and other riwayat are later-phase options.

### Non-negotiables
- Quranic text must not be edited, algorithmically reflowed, or auto-generated.
- Faithful 604-page fixed-layout reading. A verse MAY cross a printed page boundary; never force a verse to end at the page edge.
- Reading must work anonymously, including bookmarks and last-read page.
- Offline-first after selected pages/assets are cached; no backend request on page turns.
- Accessible alternatives to gestures, especially for critical actions.
- Verify artwork provenance, correctness, redistribution license and correspondence to intended printed edition before shipping.

## 2. Scope and roadmap
### P0 — Core reader
- Hafs as default and initially only verified riwayah.
- Responsive 1-page portrait phone; 2-page tablet landscape when both remain legible; optional 1-page mode on tablet.
- Page number / surah / juz indicators; chapter & juz navigation; direct page entry; page thumbnails optional.
- Tap on empty margin to show/hide controls; tap on a verse to select/highlight and open contextual action sheet; swipe to flip pages; keyboard arrows; buttons in navigation.
- Double tap on page to zoom around touch point; pinch-to-zoom and pan; explicit reset zoom.
- Long press on verse to open action sheet; long press on blank page has no destructive action.
- Verse bookmark, page bookmark, distinct last-read cursor, jump back to reading position.
- Local storage and settings persist across sessions; restore last read page on app launch (first ever launch starts at page 1 or onboarding choice).
- Three paper themes selectable and saved: Photo Sample #EEEDEB, Warm Ivory #F5F1E8 (default), Antique Paper #F2EBDD. Ink #252525 only if artwork permits recoloring without compromising fidelity; otherwise preserve artwork's original ink.
- Reader settings: theme, 1/2 page mode, zoom, gesture help, reduced motion.
- App shell PWA installable; cached reader UI and downloaded pages work offline.

### P1 — Enriched reading & sync
- Translation Bahasa Indonesia as bottom sheet, audio recitation, verse-level playback with optional continuous playback, per-verse share (reference + licensed text), search by surah/verse, searchable Indonesian translation if licensed.
- Cloud account via OAuth / email login only after selecting provider and validating Cloudflare support. Anonymous user can explicitly opt in to sync.
- Sync bookmarks, last-read location, preferences across devices. Export/import JSON, account deletion, data download.

### P2 — Future
- Additional riwayat (Warsh, Qalun, Duri, Shubah) ONLY after independent text/page/verse mapping and audio validation.
- Word tap / word-by-word meaning if exact coordinates and mapping verified.
- Tajweed color overlay with curated authoritative data and expert QA; do not approximate letter coloring by bounding-box heuristics.
- Reading goals, recitation repeat, memorization aids.

## 3. Information architecture
Reader (default) / Browse (Surah, Juz, Page) / Bookmarks (Verses, Pages) / Search / Settings / Account & Sync. In reader, controls are hidden by default after a short idle period, but can be revealed by a single tap in an empty area or explicit accessible button. All pages have accessible navigation and screen-reader labels.

### Interaction precedence / gesture state machine
- Single tap on SVG verse hit region: select verse, subtle highlight, show verse action sheet; do not simultaneously toggle controls.
- Single tap on empty page/margin: toggle reader chrome.
- Double tap (on page): zoom in at tap point, next double tap resets; defer single-tap margin action briefly to avoid accidental toggle.
- Long press on verse (approximately 450–600ms): context sheet with bookmark verse, audio, translation, copy reference; cancel on movement beyond threshold. Long press on blank space: optional help, not bookmark.
- Horizontal swipe while unzoomed: next/previous page in RTL book order (verify physical direction with real users); while zoomed: pan, not page turn.
- Pinch: zoom; wheel/keyboard/button equivalents; avoid browser gesture conflicts. Use pointer events + touch-action strategically.
- Bookmark page via visible bookmark icon in reader chrome; bookmark verse via verse context sheet.
- Tap outside sheet dismisses; Escape/back closes sheet before leaving reader. Disable gestures on open modal.
- Define minimum hit target 44 CSS px where possible, with larger logical hit polygons for small verse fragments.
- On first launch, show dismissible 3-step gesture tutorial; Settings > Help allows replay.

## 4. Architecture
```text
Angular standalone PWA (static output, Cloudflare Pages)
  ├── Reader UI + responsive spread + gesture controller
  ├── SVG page loader (trusted local/CDN static assets)
  ├── SVG hit-map adapter (verse polygons / optional word regions)
  ├── IndexedDB (Dexie or native) + localStorage small preferences
  ├── Service Worker: app shell + versioned asset cache
  └── Optional authenticated sync client
                  │ HTTPS, only sync/login/other dynamic services
Cloudflare Worker API
  ├── Authentication / session validation (provider TBD)
  ├── D1 SQL (users, bookmarks, reading progress, preferences)
  ├── Rate limiting / input validation / CORS / security headers
  └── Optional audio/translation metadata proxy (avoid unless necessary)
```
Cloudflare Pages serves Angular static files, SVG artwork and metadata. Worker requests only for account/sync. If a chosen Pages setup uses Pages Functions, note they count toward Worker execution quotas; deploy static assets separately. D1 free-tier quotas and Worker request limits are subject to current Cloudflare pricing; check before launch. Use KV only if justified; D1 sufficient for small sync records. No R2 needed initially if SVG files fit static asset deployment constraints and licensing permits distribution.

### SVG renderer
- Use vetted Hafs SVG dataset (candidate: quran-ws/quran-svg); inspect viewBox, SVG internal IDs, embedded assets, glyph layers and clickable polygons. Confirm correspondence to target Mushaf Madinah edition before adopting.
- Do not assume SVG art from one source aligns with hitmaps from another. A mapping is valid only after geometry and version matching.
- Use inline SVG or trusted same-origin SVG embedded through a safe renderer when DOM interaction is needed. An <img src='...svg'> alone cannot receive per-verse DOM events.
- Sanitize imported SVG at build time, strip scripts/external references; do not inject untrusted markup at runtime.
- Page spread uses independent SVG viewBoxes and scale-to-fit, preserving aspect ratio. Book-like gutters and frames belong to UI layer, not Quranic glyph geometry.
- Page background theming: first inspect SVG backgrounds. Only remove/replace explicit page background rect if doing so does not affect text or decorative motifs. Never apply global CSS filters that recolor text, diacritics or verse ornaments.
- Prefetch +/-2 pages, cache bounded subset, lazy load more. No download of 604 pages on initial load. Asset hashes and versioned cache; manage offline quota.
- Highlight by overlaying existing verse polygon with translucent fill; don't alter underlying glyph shapes. A verse may have multiple polygons/segments across lines/pages.

### Reading location model
Canonical: `{riwayah:'hafs', surah:2, ayah:5, page:3, updatedAt, deviceId}`. `page` is navigation convenience, surah/ayah is semantic identity. If a verse spans pages, save exact visible page and optionally scroll/zoom state. User may choose page bookmark independent of verse. Persist progress on successful page navigation with throttling, on visibilitychange, and before pagehide (best effort). Never rely solely on unload events.

## 5. Data model (proposed D1)
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  auth_subject TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('verse','page')),
  riwayah TEXT NOT NULL DEFAULT 'hafs',
  surah INTEGER, ayah INTEGER, page INTEGER,
  label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE reading_progress (
  user_id TEXT NOT NULL,
  riwayah TEXT NOT NULL,
  surah INTEGER, ayah INTEGER, page INTEGER NOT NULL,
  updated_at TEXT NOT NULL, device_id TEXT,
  PRIMARY KEY(user_id,riwayah)
);
CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'warm-ivory',
  view_mode TEXT NOT NULL DEFAULT 'auto',
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_bookmarks_user_kind ON bookmarks(user_id,kind,deleted_at);
```
Local IndexedDB mirrors these entities with a stable anonymous device namespace. Add migration versions, schema constraints (surah 1–114, page 1–604, verse ranges per surah), and unique semantic bookmark keys.

### Suggested API
- `GET /api/me` current account/session
- `GET /api/sync?since=...` bookmarks/progress/preferences delta or snapshot
- `PUT /api/bookmarks/:id` idempotent upsert
- `DELETE /api/bookmarks/:id` tombstone for cross-device sync
- `PUT /api/progress` update reading position
- `PUT /api/preferences` sync preferences
- `POST /api/sync/merge` optional batched merge for first login
- `GET /api/export`, `DELETE /api/account` (with confirmation)
Every endpoint authenticated, validates ownership and input, and has rate limits. Do not trust user_id in request body.

### Sync policy
- Local-first optimistic writes, queued offline, retry with exponential backoff.
- Bookmarks: union by stable IDs; tombstones for deletes; updated_at with server timestamps and idempotency keys to avoid duplicate creation.
- Progress: last-server-accepted update by timestamp, but on login with differing local/cloud progress show 'Continue here' vs 'Use cloud position' rather than silently losing reading place.
- Settings: last-write-wins with explicit conflict rules; user can disable cloud sync.
- Avoid unnecessary writes: progress debounce 5–15s or on page settled; batch bookmark changes.

## 6. Security / privacy / accessibility
- Cloudflare-managed TLS, secure session cookies (HttpOnly, Secure, SameSite), CSRF mitigation when cookie-authenticated, strict CSP, no external SVG scripts.
- Never store raw passwords in D1. Use audited auth provider; OAuth redirect flow and callback URLs must be secured.
- Minimize personal data; account deletion and export; clear explanation of local-only vs cloud sync; Indonesian privacy notice and applicable UU PDP considerations.
- Avoid tracking exact verse reading history by default; sync only current location and bookmarks with consent.
- Accessibility: WCAG 2.2 AA target for controls, keyboard navigation, focus management, reduced motion, text alternatives to SVG, no gesture-only required action. Keep text/translation accessible even if SVG artwork itself is not screen-reader-friendly.

## 7. Performance and cost
- Target Core Web Vitals LCP <= 2.5s on typical 4G midrange device after warm cache; CLS <= .1; interactions responsive <= 200ms (targets, not guaranteed).
- Code split audio, translation and account modules. Brotli/gzip SVG and JSON; long-lived immutable cache for hashed assets.
- SVG size/complexity audit on low-end Android. Consider pre-rendered image fallback if SVG rendering too expensive, preserving overlay hitmaps separately.
- Static page turn makes zero Worker calls; guest use can cost no dynamic requests.
- Cloudflare free allowances vary and can change: verify static asset limits, Workers/D1 quotas, custom domain and auth-provider pricing. No blanket promise of permanently free hosting.

## 8. QA and acceptance criteria
- Compare SVG pages 1,2,3,100,300,604 against approved printed mushaf references: text, diacritics, ornament, line boundaries, page boundaries.
- On 360x800 and 390x844 phones: full page visible with optional zoom, no horizontal overflow at base zoom.
- On tablet 768x1024 portrait and 1024x768 landscape: auto layout chooses legible one/two pages; manual override available.
- Verse polygon taps correctly identify first, middle, last verse, split verse and page-spanning verse; test 50+ regions sampled across 604 pages.
- Gestures: tap vs double tap vs long press never cause duplicate actions; page swipe disabled while zoomed.
- Guest bookmarks and progress survive reload, app restart, network loss. Startup resumes last viewed page.
- Cloud sync: two-device conflict, offline bookmark creation/deletion, logout/login, deletion, duplicate prevention.
- All 3 paper themes show clearly without changing Quran glyph colors or diacritics.
- Lighthouse accessibility and keyboard test; no dependence on color alone for selection.

## 9. Delivery plan
Sprint 0 (technical spike): license/source audit; compare reference photo and SVG, confirm hitmaps, page background recoloring; 2-page prototype.
Sprint 1: Angular reader, one/two-page responsive, page navigation, gestures, 3 themes, offline local progress.
Sprint 2: verse selection, bookmarks, browse, settings, PWA caching, accessibility.
Sprint 3: optional auth, D1 sync, account lifecycle, multi-device QA.
Sprint 4: audio/translation and polish. Tajweed + other riwayat remain explicitly deferred.

## 10. Decisions pending
- Confirm exact Hafs SVG artwork/edition and redistribution permissions.
- Choose auth provider (e.g. managed OIDC) and verify free-tier limits and Cloudflare integration.
- Decide whether translations/audio are in MVP or next milestone; licensing and sourcing.
- Confirm physical swipe direction and page pairing with real readers; Arabic RTL conventions and page-number sequencing.
- Confirm theme recoloring works on selected SVG assets without modifying ink.

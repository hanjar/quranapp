# Claude Design Handover — Modern Elegant Digital Mushaf
Copy this entire brief into Claude Design. Create a clickable, responsive, high-fidelity UI prototype from scratch. Design full navigation and all primary flows, not only a landing screen. Do not fabricate Quranic text or use placeholder Arabic that could be mistaken for scripture; use verified Hafs SVG assets when possible, otherwise clearly label a neutral wireframe placeholder and keep the scripture region separate.

## Product goal
Create a refined, calming Quran reading web app for phone and tablet. The experience should feel like holding an elegant printed Madinah mushaf, not a generic SaaS dashboard. The reference is a printed Quran photo with warm off-white paper, graceful Uthmanic Naskh calligraphy, blue ornamental page border, generous breathing room and precise 15-line layout. The core reader uses vetted 604-page Hafs SVG artwork with selectable verse hit polygons. Preserve the page layout exactly; never reflow or redraw Quran text.

## Visual direction
Keywords: modern elegant, editorial restraint, sacred manuscript care, timeless, quiet premium, tactile paper, minimal chrome. Avoid gaudy gold, neon, gradients, excessive glassmorphism, heavy shadows, and generic Material cards everywhere. Prefer refined serif-like editorial headings for Latin UI, clean accessible sans-serif for controls, Quranic glyphs only from approved artwork. Elegant microinteractions with reduced-motion fallback.

### Color system (three switchable reader paper themes)
1. Photo Sample: #EEEDEB — neutral warm off-white
2. Warm Ivory: #F5F1E8 — default, slightly creamy
3. Antique Paper: #F2EBDD — richer parchment
Suggested interface ink #252525, deep forest green #153B32 for sparing interactive accent, subdued bronze #A58B63 for subtle highlights; ensure contrast. Page ink itself must remain unchanged if baked into SVG. Test background replacement only if artwork supports safe removal of its background layer.

### Layout
Phone portrait: 1 page, center, maximize readability; no persistent app header/footer during reading. Tablet portrait: 1 page or optional spread based on legibility. Tablet landscape: 2-page book spread, visible central gutter, pages right-to-left; manually switchable to one-page. Safe areas for Android/iOS, no horizontal scroll at fit-to-page. Use responsive proportions rather than fixed pixel artboards.

## Screen inventory — create ALL screens and interactions
A. First launch: minimal welcome, optional gesture tour, choice of paper theme, 'Start reading' and 'Continue' if local progress exists. No mandatory account.
B. Reader, immersive chrome hidden: page SVG, subtle optional page number, edge swipe affordance, zero visible clutter.
C. Reader, chrome visible: top bar (back/brand, surah + page + juz, search, settings); bottom bar (previous, page selector, next, bookmark page, audio, contents). Auto-hide when reading.
D. Verse selected: translucent highlight over verse polygons; floating/bottom action sheet: bookmark verse, play, translation, copy reference, share. Do not place controls on Quranic text.
E. Browse drawer/sheet with tabs: Surah, Juz, Page; search/filter; jump to page, chapter or verse. Present surah names in Arabic + Indonesian transliteration, but use verified data.
F. Bookmarks: segmented tabs 'Ayat' and 'Halaman', each card shows surah/ayah/page, created date, optional label, jump/remove. Distinguish bookmark from last-read position.
G. Last read / resume: first app launch after previous session opens last viewed page immediately; small unobtrusive 'Lanjut membaca' toast, option to return to previous session if desired.
H. Theme and reading settings: 3 large paper swatches with labels and HEX, one/two-page/auto mode, zoom reset, gestures help, reduced motion, offline status.
I. Search: search surah and verse references; translation search optional/disabled if source not integrated.
J. Audio + translation sheet: play/pause, verse progress, qari selector placeholder until data sourced, translation view. Ensure audio controls do not obstruct text.
K. Account & cloud sync: Guest mode vs 'Aktifkan sinkronisasi'; clear benefits and privacy, login entry, sync status, conflict resolution UI ('Gunakan posisi perangkat ini' vs 'Gunakan posisi cloud'), sign out, export data, delete account.
L. Offline/download status: offline-ready pages, storage usage, retry state, no misleading full-604-page offline guarantee.
M. Empty/error states: no bookmarks, offline without cached page, unavailable artwork, sync conflict, unavailable audio, account disconnected.

## Exact gestures and controls
- Tap blank margin toggles full navigation; tap verse selects verse and shows action sheet.
- Double tap page zooms around finger; double tap again resets.
- Long press verse opens action sheet. Long press blank area should not create bookmarks.
- Swipe horizontal flips page when not zoomed; pan when zoomed; pinch zoom.
- Provide visible button equivalents for page turns, bookmarks and zoom. Never require gestures exclusively.
- Dismiss sheets with back/Escape; don't make single tap and double tap both trigger on same gesture.
- Keyboard and accessibility: 44px targets, focus states, high contrast, screen-reader descriptions, reduced motion.

## Navigation system
Reader is home. From reader chrome: Contents, Bookmarks, Search, Settings, Account. On mobile use bottom sheets and full-height drawers; on tablet use side panel that does not obscure both pages if avoidable. Navigation must be usable from the first design iteration, with working prototype transitions for every screen. Never add a permanently visible large navigation bar in immersive mode.

## Prototype requirements
- Build interactive components and realistic transitions; no static screenshot-only output.
- Use actual SVG page asset(s) if permitted and available; demonstrate pages 2 and 3 and a two-page spread.
- Design state variants: chrome hidden/visible, verse selected, zoomed, bookmark active, offline, guest, signed in, sync conflict.
- Test 360x800, 390x844, 768x1024, 1024x768, and 1280x800.
- Demonstrate theme switching with all three colors, preserve selected theme across screens.
- Design in Indonesian, short natural labels. Arabic only from verified sources.
- Show interaction flows: launch > resume page > select verse > bookmark > navigate > return; theme change; enable cloud sync > resolve conflict.
- Supply design tokens, typography scale, spacing, component inventory, gesture specification, responsive behavior, and developer handoff notes suitable for Angular implementation.

## Important implementation constraints
Frontend Angular PWA on Cloudflare Pages. SVG fixed-layout pages, overlays for verse interaction. Anonymous IndexedDB/local storage; optional Worker + D1 for authenticated sync. Do not propose backend calls for every page turn. The visual layer must not alter the sacred text, page divisions or diacritics. Tajweed coloring and multi-riwayah are lower priority and should not dominate the initial design.

## Deliverables requested from Claude Design
1. Clickable high-fidelity phone + tablet prototype, complete navigation.
2. Three fully realized reader themes.
3. All screens A–M with key empty/error/sync states.
4. Responsive design rules and component specifications.
5. Interaction map / gesture state machine and accessibility equivalents.
6. Angular-friendly handoff: design tokens, component naming, states, dimensions, transitions, assets list.
7. Clearly flag assumptions and anything needing verification against approved Quran SVG assets.

Success means a reader can open the app and resume reading instantly, enjoy uncluttered Quran pages, discover controls intuitively, bookmark a verse/page, navigate easily, and optionally sync across devices — all with a modern, elegant printed-mushaf aesthetic.

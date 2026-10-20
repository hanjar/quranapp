# Reader (`app/src/app/features/reader/`)

Route component `ReaderShell` (`reader-shell.ts`) for `/hal/:page`; relies on
`withComponentInputBinding()` for the `page` input (string).

## Pieces
| File | Role |
| --- | --- |
| `reader-shell.*` | Layout (single/spread), page validation, position saving, prefetch, keyboard, zoom/pan, chrome auto-hide, pointer plumbing |
| `page-view.*` | One page: paper + CSS blue frame, SVG inserted with DOM APIs, states (loading / offline / error), accessible verse buttons |
| `gesture-controller.ts` | Pure TS pointer arbitration with an injectable clock |
| `reader-logic.ts` | Pure helpers: page param parsing, spread decision/pairing, next/prev targets, prefetch set, zoom/pan maths, SVG viewBox fit |
| `chrome-top.ts`, `chrome-bottom.ts` | Top and bottom bars (no audio button) |

## Behaviour
- Spread: `auto` = landscape and width >= 900; `spread` = width >= 700; `single` never. Pairs are `[odd, odd+1]`
  rendered right to left. The route page stays ACTIVE (`/hal/4` shows [3,4], `currentPage` = 4, `aria-current="page"`
  and an emphasised page number on page 4). Position, bookmark toggle and title use the active page; tapping a verse
  on the other page of the pair makes it active (replaceUrl). next/prev move by pair.
- Next = higher page: swipe left-to-right (dx > 0), ArrowLeft, left-most bottom button. Prev is the mirror.
- Position: `UserDataApi.savePosition(page)` only after the primary page rendered successfully.
- Prefetch: `APP_CONFIG.prefetchRadius` pages each side.
- Gestures (`GestureController`): tap deferred 260 ms; double tap < 280 ms and < 30 px = zoom 2x at point / reset
  (never also a tap); hold 500 ms on a verse = select (never also a tap); hold on blank = nothing; move > 10 px cancels
  the hold; horizontal drag > 50 px unzoomed = page turn, zoomed = pan; two pointers = pinch (1x-3x). Gestures are
  ignored while `ReaderUiService.gesturesBlocked()`. `touch-action: none` is set on the stage only.
- Zoom lives in `ReaderUiService.zoom`; pan is local. Transform `translate() scale()` on `.zoomer`, pan clamped,
  reset on page/layout change. Buttons: `+`/`-` (visible with chrome), zoom pill "N x - Atur ulang zoom", `+`/`-` keys.
- Chrome auto-hides after 4.5 s of inactivity unless `prefs.controlsAlwaysVisible`, a sheet/tour is open, or focus is
  inside the chrome. Edge bars hint at hidden chrome. A visually hidden "Tampilkan kontrol" button is the keyboard
  equivalent of tapping the margin.
- Escape chain: tour, sheet, zoom, chrome (the handler skips events with `defaultPrevented`, and calls
  `preventDefault()` when it acts).
- Verse states are CSS classes on `.ayahPolygon`: `is-selected` (fill + stroke ring), `is-bookmarked`, `is-focus`
  (keyboard focus of the matching hidden button). Glyph paths are never modified.
- Accessibility: art container is `role="img"` with `Halaman N, <surah>`; a visually hidden list of `Ayat S:A`
  buttons calls `ReaderUiService.selectVerse`.

## Tests
`reader-logic.spec.ts`, `gesture-controller.spec.ts` (fake clock), `reader-shell.spec.ts` (fake Content/UserData/
Offline/Sync services).

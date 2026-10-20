# Sheets: host + navigation (verse, browse, bookmarks, search)

Code: `app/src/app/features/sheets/`. Place `<app-sheet-host />` (`SheetHost`, `sheet-host.ts`) once in the root template.

## SheetHost
- Renders scrim + `role="dialog"` for `ReaderUiService.sheet()` and switches content with `@switch`
  (verse, browse, bookmarks, search, settings, offline, account, about).
- Layout is pure CSS: bottom sheet (max 88%, verse max 52%, grab handle) below 768 px; 400 px right panel from 768 px.
  The verse sheet has no scrim (page stays visible/interactive) and `aria-modal="false"`.
- Transitions use `--mf-dur-base`; safe-area insets applied. Content stays mounted during the close transition.
- Escape closes. Focus moves to the heading on open, returns to the previously focused element on close; Tab is trapped (not for the verse sheet).
- Body is an unpadded scroll area: each content component pads itself (`:host`).

## SheetHistory (`sheet-history.ts`)
Opening pushes a same-URL history entry; Back/Android back pops it and closes the sheet. UI close calls `history.back()`.
Content components navigate with `history.closeThen(() => ui.goToPage(...))` so the router's `pushState` does not race the pop
(also guarantees `closeSheet()` clearing `selectedVerse` happens before `goToPage(..., {highlight})` sets it).

## Content components
- `VerseSheet`: Tandai/Ditandai (toast + Urungkan), Salin, Bagikan (Web Share, fallback copy), Tutup. Salin and Bagikan share the same text: `QS. Al-Hasyr 59:3 (hal. 545)`, Arabic (Latin if the Arabic file is unavailable), `"<terjemahan>" (Terjemahan Kemenag RI)`, then the deep link `<origin>/59/3`. Shared links `/{surah}/{ayah}` (and `/{surah}`) are resolved by `core/verse-link.ts` and redirect to `/hal/{page}` with the ayah highlighted.
- `BrowseSheet`: tabs Surah/Juz/Halaman bound to `ui.browseTab`; filter by name/number/Arabic; page tab validates 1–604 (`parsePageInput`), invalid input shows an inline message and never navigates.
- `BookmarksSheet`: "Posisi terakhir" card from `userData.position()`, Ayat/Halaman segments, delete with toast + Urungkan (undo from `removeBookmark`). No folders.
- `SearchSheet` + `parseSearch` (`search-parser.ts`, pure): surah names (case/hyphen/diacritic-insensitive, with or without `Al-`/`An-`, English and Arabic), `n`, `2:255` / `2.255`, `hal 50` / `halaman 50`, `juz 30`. Exact ayah page via `ContentApi.pageOf`.

## Pure helpers (`nav-helpers.ts`)
`formatDate` ("12 Okt 2026"), `filterSurahs`, `filterJuz`, `parsePageInput`, `verseReference`.

Tests: `search-parser.spec.ts`, `nav-helpers.spec.ts` (`ng test --include "src/app/features/sheets/**/*.spec.ts"`).

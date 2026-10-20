# Content pipeline

The Mushaf pages are NOT committed. `scripts/build-content.mjs` downloads a pinned upstream
commit, validates it, and writes `app/public/content/hafs-kfqc/` (gitignored, served at
`content/hafs-kfqc/...`).

## Dataset

- Upstream: <https://github.com/quranpedia/quran-svg>, path `mushafs/hafs/kfqc`
  (Hafs, King Fahd Complex Madinah mushaf), 604 pages.
- Pinned commit of the current build: `b4155f07e4aea087d2c458069acff9f7c7e749f6`
  (`contentVersion` = `b4155f07e4ae`). The script resolves `main` unless `--commit` is given;
  pin the commit explicitly for reproducible CI/deploys.
- Files used: `svg/001..604.svg`, `json/001..604.json`, `json/surah.json`.
  `NNN-surahK.svg` variants are ignored.

## Output (`app/public/content/hafs-kfqc/`)

| File | Content |
|---|---|
| `svg/NNN.svg` | upstream SVG, byte-for-byte |
| `pages.json` | `PageMeta[]` (first/last ayah, surahs, juz, juzStarts) derived from per-page json |
| `juz.json` | `JuzMeta[]`, canonical Hafs juz start ayahs; page = first page containing it |
| `surahs.json` | `SurahMeta[]`; Arabic/English names, ayahCount, startPage from upstream; endPage derived; Indonesian transliteration from the design prototype |
| `edition.json` | `Edition` (source, licence, attribution) |
| `latin.json` | `LatinFile`: Indonesian Latin transliteration per ayah (`"s:a"` keys, 6236 entries), Kemenag RI via EQuran.id API v2 (`GET /api/v2/surat/{1..114}`, `ayat[].teksLatin`) |
| `arabic.json` | `ArabicFile`: Unicode Arabic text per ayah (`"s:a"` keys, 6236 entries), Teks Arab Kemenag RI from the same EQuran.id responses (`ayat[].teksArab`). Verbatim (trim/whitespace/NFC only); used only for Salin/Bagikan, never rendered on the mushaf page. 1,426,148 bytes. Lazy service-worker group with latin/translation |
| `translation-id.json` | `TranslationFile`: Indonesian translation per ayah (Terjemahan Kemenag RI, edisi penyempurnaan 2019), same EQuran.id responses as latin (`ayat[].teksIndonesia`), 6236 entries |
| `manifest.json` | sha256 + bytes of every file, `totalBytes` |

Current full build: 608 files, 372,955,568 bytes (355.7 MB), largest page 585 (774 KB).

## Rebuild / verify

```
node scripts/build-content.mjs                    # latest main, all 604 pages
node scripts/build-content.mjs --commit <40-hex>  # reproducible
node scripts/build-content.mjs --pages 1-10       # quick partial build (manifest has "partial": true)
node scripts/build-content.mjs --skip-latin       # offline build without latin.json
node scripts/build-content.mjs --skip-translation # omit translation-id.json (flags are independent)
node scripts/build-content.mjs --latin-refresh    # ignore today's latin cache
node scripts/verify-content.mjs [dir]             # re-hash output against manifest.json (CI/deploy)
node --test scripts/test/*.test.mjs               # unit tests
```

Raw downloads are cached in `.content-cache/<sha>/` (gitignored); re-runs skip existing files.
Output is written to a temp folder and swapped in only after every check passes.

## Latin transliteration

Fetched with concurrency 4 and retries, cached in `.content-cache/latin/<YYYY-MM-DD>/`. Validation: 114 surahs, ayah count per surah equals `surahs.json`, total 6236, every value a non-empty string of at most 2000 chars. Normalisation is limited to stripping HTML tags (build fails on `<script`), collapsing whitespace and Unicode NFC; diacritics and wording are kept verbatim, nothing is generated. Current file: 771,927 bytes.

## Translation

Built from the same cached EQuran.id responses as latin (one fetch). Validation: 6236 total, per-surah counts equal to `surahs.json`, non-empty, at most 6000 chars. Normalisation: HTML tags stripped (their text kept; build fails on `<script`), whitespace collapsed, NFC. Entries with probable footnote markers (digit glued to a letter, or superscript digits) are counted and warned about but never altered; currently 0. Current file: 1,176,426 bytes.

## Checks that fail the build

SVG security (never silently stripped): `<script`, `<foreignObject`, `<image`, `<iframe`,
embed/object/media, `<!ENTITY`, `on*=` attributes, `javascript:`, `href`/`xlink:href` not starting
with `#`, `url(` outside `#`, `<style>` with `@import`; and at least one `.ayahPolygon` path with
integer `surah`/`ayah`.
Integrity: 604 pages, 114 surahs, sum of ayahCount = 6236, every ayah 1..ayahCount on at least one
page, no unknown ayahs, pages monotonic by first ayah, 30 juz with ascending pages. A verse that
continues onto the next page legitimately appears on both pages.

## What we do NOT do to the text

No re-shaping, re-typesetting, recolouring, glyph editing, or SVG optimisation: the Qur'anic glyph
paths are served exactly as published (the manifest hashes prove it). All metadata is derived from
upstream data, except the Indonesian transliteration list and the juz start table (constants in
`scripts/lib/derive.mjs`). No translation, tafsir, or other text is added.

## Licensing

See `/NOTICE.md`. Artwork (c) King Fahd Glorious Qur'an Printing Complex (free for digital use, not
for commercial printing of physical mushafs); polygons/metadata CC BY 4.0 from quranpedia/quran-svg.

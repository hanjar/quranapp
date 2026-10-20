# NOTICE

Mushaf Digital application code is released under the MIT license (see LICENSE). The generated Qur'an
content is NOT part of this repository; it is fetched at build time (see `docs/CONTENT.md`) and
remains under its original terms:

1. **Mushaf artwork (SVG page glyphs)** - (c) King Fahd Glorious Qur'an Printing Complex, Madinah
   (Mushaf Madinah, Hafs). Made available for digital use; it must not be used for commercial
   printing of physical mushafs. The artwork is distributed unmodified. Verify current terms with the
   publisher before any commercial distribution.
2. **Ayah polygons and page/surah metadata** - from
   <https://github.com/quranpedia/quran-svg> (also known as quran-ws), licensed CC BY 4.0
   (<https://creativecommons.org/licenses/by/4.0/>). The upstream project waives in-product
   attribution; we nevertheless credit it here and in `edition.json`. Pinned commit:
   `b4155f07e4aea087d2c458069acff9f7c7e749f6`. Our derived `pages.json`, `juz.json`, `surahs.json`
   are adaptations of that data.
3. **Indonesian surah transliteration** (e.g. "Al-Baqarah") - taken from this project's own design
   prototype (`desain/Mushaf Digital.dc.html`); it is not upstream data and is not an official
   transliteration standard. Corrections are welcome.
4. **Juz start ayahs** - the standard Hafs juz division, entered as a constant and cross-checked
   against the upstream page data at build time.
5. **Arabic UI font** - Amiri (SIL Open Font License) where used for surah names.
6. **Latin transliteration per ayah (`latin.json`)** - Transliterasi Kemenag RI (Kementerian Agama RI, quran.kemenag.go.id), obtained via the EQuran.id API v2 (<https://equran.id/apidev>). Data belongs to Kemenag RI; use is non-commercial with attribution, pending written permission from LPMQ. Text is reproduced verbatim (whitespace/NFC normalisation only).
7. **Indonesian translation per ayah (`translation-id.json`)** - "Al-Qur'an dan Terjemahannya", edisi penyempurnaan 2019, Kementerian Agama RI (quran.kemenag.go.id), obtained via the EQuran.id API v2 (<https://equran.id/apidev>). Data belongs to Kemenag RI; use is non-commercial with attribution, pending written permission from LPMQ. Text is reproduced verbatim (HTML-tag stripping, whitespace and NFC normalisation only).
8. **Recitation audio** - Mishary Rasyid Alafasy, verse-by-verse recordings streamed at runtime from the Al Quran Cloud / Islamic Network CDN (<https://alquran.cloud/cdn>, terms: <https://alquran.cloud/terms-and-conditions>), with the byte-identical EQuran.id CDN as fallback. For offline listening the same recordings are re-encoded (Opus 24/32 kbps) or copied unchanged (MP3 64 kbps) by scripts/build-audio.mjs and served from the project's own storage (audio.hanjar.net). Recordings remain the property of the reciter/rights holders; non-commercial use with attribution.
9. **Tafsir per ayah (`tafsir/{surah}.json`)** - Tafsir Kemenag RI, Kementerian Agama RI (quran.kemenag.go.id), obtained via the EQuran.id API v2 (`/tafsir/{n}`). Data belongs to Kemenag RI; use is non-commercial with attribution, pending written permission from LPMQ. Text is reproduced verbatim (HTML stripped to plain paragraphs).

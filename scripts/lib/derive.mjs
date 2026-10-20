// Pure derivation functions (no I/O). Shapes follow app/src/app/core/models.ts.

/** Canonical Hafs juz start ayahs [surah, ayah], index 0 = juz 1. */
export const JUZ_STARTS = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1],
];

/**
 * Indonesian transliteration of the 114 surah names.
 * Provenance: copied verbatim from the `const NAMES="..."` line of the project design prototype
 * `desain/Mushaf Digital.dc.html`. It is NOT upstream data; see NOTICE.md.
 */
export const NAMES_LATIN =
  "Al-Fatihah|Al-Baqarah|Ali 'Imran|An-Nisa'|Al-Ma'idah|Al-An'am|Al-A'raf|Al-Anfal|At-Taubah|Yunus|Hud|Yusuf|Ar-Ra'd|Ibrahim|Al-Hijr|An-Nahl|Al-Isra'|Al-Kahf|Maryam|Taha|Al-Anbiya'|Al-Hajj|Al-Mu'minun|An-Nur|Al-Furqan|Asy-Syu'ara'|An-Naml|Al-Qasas|Al-'Ankabut|Ar-Rum|Luqman|As-Sajdah|Al-Ahzab|Saba'|Fatir|Yasin|As-Saffat|Sad|Az-Zumar|Gafir|Fussilat|Asy-Syura|Az-Zukhruf|Ad-Dukhan|Al-Jasiyah|Al-Ahqaf|Muhammad|Al-Fath|Al-Hujurat|Qaf|Az-Zariyat|At-Tur|An-Najm|Al-Qamar|Ar-Rahman|Al-Waqi'ah|Al-Hadid|Al-Mujadalah|Al-Hasyr|Al-Mumtahanah|As-Saff|Al-Jumu'ah|Al-Munafiqun|At-Tagabun|At-Talaq|At-Tahrim|Al-Mulk|Al-Qalam|Al-Haqqah|Al-Ma'arij|Nuh|Al-Jinn|Al-Muzzammil|Al-Muddassir|Al-Qiyamah|Al-Insan|Al-Mursalat|An-Naba'|An-Nazi'at|'Abasa|At-Takwir|Al-Infitar|Al-Mutaffifin|Al-Insyiqaq|Al-Buruj|At-Tariq|Al-A'la|Al-Gasyiyah|Al-Fajr|Al-Balad|Asy-Syams|Al-Lail|Ad-Duha|Asy-Syarh|At-Tin|Al-'Alaq|Al-Qadr|Al-Bayyinah|Az-Zalzalah|Al-'Adiyat|Al-Qari'ah|At-Takasur|Al-'Asr|Al-Humazah|Al-Fil|Quraisy|Al-Ma'un|Al-Kausar|Al-Kafirun|An-Nasr|Al-Lahab|Al-Ikhlas|Al-Falaq|An-Nas".split(
    '|',
  );

/** Comparison of two {surah, ayah} refs. */
export function cmpRef(a, b) {
  return a.surah - b.surah || a.ayah - b.ayah;
}

/** Juz number (1-30) containing a ref, using JUZ_STARTS. */
export function juzOf(ref, starts = JUZ_STARTS) {
  let juz = 1;
  for (let i = 0; i < starts.length; i++) {
    if (cmpRef(ref, { surah: starts[i][0], ayah: starts[i][1] }) >= 0) juz = i + 1;
  }
  return juz;
}

/** Normalised, sorted, de-duplicated ayah refs from one upstream page json. */
export function pageAyahs(entries, page = '?') {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error(`page ${page}: empty ayah list`);
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (!Number.isInteger(e?.surahNumber) || !Number.isInteger(e?.ayahNumber)) {
      throw new Error(`page ${page}: invalid ayah entry ${JSON.stringify(e)}`);
    }
    const k = `${e.surahNumber}:${e.ayahNumber}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ surah: e.surahNumber, ayah: e.ayahNumber });
  }
  return out.sort(cmpRef);
}

/** PageMeta[] from an array (index 0 = startPage) of per-page upstream ayah lists. */
export function derivePages(pageEntries, startPage = 1, starts = JUZ_STARTS) {
  return pageEntries.map((entries, i) => {
    const page = startPage + i;
    const ayahs = pageAyahs(entries, page);
    const first = ayahs[0];
    const last = ayahs[ayahs.length - 1];
    const juzStarts = [];
    starts.forEach(([s, a], j) => {
      if (ayahs.some((r) => r.surah === s && r.ayah === a)) juzStarts.push(j + 1);
    });
    return {
      page,
      first,
      last,
      surahs: [...new Set(ayahs.map((r) => r.surah))].sort((x, y) => x - y),
      juz: juzOf(first, starts),
      juzStarts,
    };
  });
}

/** JuzMeta[]: page = first page that contains the juz start ayah. Throws if absent. */
export function deriveJuz(pageEntries, startPage = 1, starts = JUZ_STARTS) {
  const lists = pageEntries.map((e, i) => pageAyahs(e, startPage + i));
  return starts.map(([surah, ayah], i) => {
    const idx = lists.findIndex((l) => l.some((r) => r.surah === surah && r.ayah === ayah));
    if (idx < 0) throw new Error(`juz ${i + 1}: start ayah ${surah}:${ayah} not found on any page`);
    return { number: i + 1, start: { surah, ayah }, page: startPage + idx };
  });
}

/** SurahMeta[] from upstream surah.json + derived pages. endPage = last page listing the surah. */
export function deriveSurahs(upstream, pages, names = NAMES_LATIN, starts = JUZ_STARTS) {
  return [...upstream]
    .sort((a, b) => a.number - b.number)
    .map((s) => {
      const on = pages.filter((p) => p.surahs.includes(s.number)).map((p) => p.page);
      return {
        number: s.number,
        nameArabic: s.nameArabic,
        nameLatin: names[s.number - 1] ?? s.nameEnglish,
        nameEnglish: s.nameEnglish,
        ayahCount: s.ayahCount,
        startPage: s.pageNumber,
        endPage: on.length ? Math.max(...on) : s.pageNumber,
        juz: juzOf({ surah: s.number, ayah: 1 }, starts),
      };
    });
}

/**
 * Integrity checks. Returns list of error strings (empty = ok).
 * pageAyahLists: per-page normalised ayah lists (from pageAyahs).
 */
export function checkIntegrity({ surahs, pages, juz, pageAyahLists, partial }) {
  const errs = [];
  if (!partial) {
    if (pages.length !== 604) errs.push(`expected 604 pages, got ${pages.length}`);
    if (surahs.length !== 114) errs.push(`expected 114 surahs, got ${surahs.length}`);
    const total = surahs.reduce((n, s) => n + s.ayahCount, 0);
    if (total !== 6236) errs.push(`sum of ayahCount is ${total}, expected 6236`);
    if (juz.length !== 30) errs.push(`expected 30 juz, got ${juz.length}`);
    const covered = new Set();
    for (const l of pageAyahLists) for (const r of l) covered.add(`${r.surah}:${r.ayah}`);
    for (const s of surahs) {
      for (let a = 1; a <= s.ayahCount; a++) {
        if (!covered.has(`${s.number}:${a}`)) errs.push(`ayah ${s.number}:${a} not on any page`);
      }
    }
    for (const k of covered) {
      const [sn, an] = k.split(':').map(Number);
      const s = surahs[sn - 1];
      if (!s || an < 1 || an > s.ayahCount) errs.push(`page data has unknown ayah ${k}`);
    }
    for (let i = 1; i < juz.length; i++) {
      if (juz[i].page < juz[i - 1].page) errs.push(`juz ${juz[i].number}: page not ascending`);
    }
  }
  for (let i = 1; i < pages.length; i++) {
    if (cmpRef(pages[i].first, pages[i - 1].first) < 0) {
      errs.push(`page ${pages[i].page}: first ayah precedes first of previous page`);
    }
  }
  return errs;
}

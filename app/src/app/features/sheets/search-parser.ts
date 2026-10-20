import { AyahRef, SurahMeta } from '../../core/models';

/** Everything the parser needs from the content layer (kept tiny so specs can fake it). */
export interface SearchContext {
  surahs: readonly SurahMeta[];
  /** Start page of a juz (1–30) or null when unknown. */
  juzStartPage(juz: number): number | null;
  /** Exact page of an ayah, or null for an invalid ref. */
  pageOf(ref: AyahRef): number | null;
  surahAt(page: number): SurahMeta;
  juzAt(page: number): number;
}

export interface SearchResult {
  title: string;
  sub: string;
  page: number;
  /** Set when the query named a specific ayah. */
  highlight?: AyahRef;
}

const MAX_NAME_RESULTS = 10;

/** lowercase, drop diacritics (Latin + Arabic harakat), keep letters only. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
}

/** "Al-Baqarah" -> "Baqarah" (only when a hyphen/space prefix exists). */
function withoutPrefix(name: string): string {
  return name.replace(/^[^-\s]+[-\s]+/u, '');
}

/** 0 = best match, null = no match. */
export function nameMatchRank(surah: SurahMeta, query: string): number | null {
  const nq = normalizeName(query);
  if (!nq) return null;
  if (/\p{Script=Arabic}/u.test(query)) {
    return normalizeName(surah.nameArabic).includes(nq) ? 1 : null;
  }
  let best: number | null = null;
  for (const name of [surah.nameLatin, surah.nameEnglish]) {
    const full = normalizeName(name);
    const bare = normalizeName(withoutPrefix(name));
    let rank: number | null = null;
    if (full === nq || bare === nq) rank = 0;
    else if (full.startsWith(nq) || bare.startsWith(nq)) rank = 1;
    else if (full.includes(nq)) rank = 2;
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function surahResult(s: SurahMeta): SearchResult {
  return {
    title: `${s.number}. ${s.nameLatin}`,
    sub: `${s.ayahCount} ayat · Hal. ${s.startPage} · Juz ${s.juz}`,
    page: s.startPage,
  };
}

function pageResult(page: number, ctx: SearchContext): SearchResult {
  return { title: `Halaman ${page}`, sub: `${ctx.surahAt(page).nameLatin} · Juz ${ctx.juzAt(page)}`, page };
}

export function parseSearch(raw: string, ctx: SearchContext): SearchResult[] {
  const q = raw.trim();
  if (!q || ctx.surahs.length === 0) return [];
  let m: RegExpMatchArray | null;

  // 2:255 / 2.255 / 2 : 255
  if ((m = q.match(/^(\d{1,3})\s*[:.]\s*(\d{1,3})$/))) {
    const sn = +m[1];
    const ay = +m[2];
    const s = ctx.surahs[sn - 1];
    if (!s || ay < 1 || ay > s.ayahCount) return [];
    const page = ctx.pageOf({ surah: sn, ayah: ay });
    if (page === null) return [];
    return [
      {
        title: `${s.nameLatin} · Ayat ${ay}`,
        sub: `Surah ${sn} · Hal. ${page} · Juz ${ctx.juzAt(page)}`,
        page,
        highlight: { surah: sn, ayah: ay },
      },
    ];
  }

  // hal 50 / halaman 50 / h. 50
  if ((m = q.match(/^(?:halaman|hal|h)\.?\s*(\d{1,4})$/i))) {
    const p = +m[1];
    return p >= 1 && p <= 604 ? [pageResult(p, ctx)] : [];
  }

  // juz 30
  if ((m = q.match(/^juz\s*(\d{1,3})$/i))) {
    const j = +m[1];
    const page = j >= 1 && j <= 30 ? ctx.juzStartPage(j) : null;
    if (page === null) return [];
    return [{ title: `Juz ${j}`, sub: `Mulai hal. ${page} · ${ctx.surahAt(page).nameLatin}`, page }];
  }

  // bare number: surah n and page n
  if (/^\d{1,4}$/.test(q)) {
    const n = +q;
    const out: SearchResult[] = [];
    const s = ctx.surahs[n - 1];
    if (s) out.push(surahResult(s));
    if (n >= 1 && n <= 604) out.push(pageResult(n, ctx));
    return out;
  }

  // names (Latin, English, Arabic)
  return ctx.surahs
    .map((s) => ({ s, rank: nameMatchRank(s, q) }))
    .filter((x): x is { s: SurahMeta; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.s.number - b.s.number)
    .slice(0, MAX_NAME_RESULTS)
    .map(({ s }) => surahResult(s));
}

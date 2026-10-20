// Pure helpers for the QCF V4 (tajweed) page layout files. No I/O.
// Source: Quran.com API v4 /verses/by_page/{n}?mushaf=19 (King Fahd Complex layout, QCF V4 glyph codes).

export const QCF_FORMAT = 'mushaf-qcf';
export const QCF_VERSION = 1;
export const MAX_LINES = 15;
export const AYAH_TOTAL = 6236;

export const QCF_SOURCE = {
  layout: 'Quran.com API v4, mushaf=19 (King Fahd Complex, 15 lines)',
  fonts: 'https://verses.quran.foundation/fonts/quran/hafs/v4/colrv1/woff2/p{page}.woff2',
  note: 'Fonts are not bundled; they are loaded at runtime from the Quran Foundation CDN.',
};

export const apiUrl = (page) =>
  `https://api.quran.com/api/v4/verses/by_page/${page}?words=true&word_fields=code_v2,line_number&mushaf=19&per_page=50&fields=verse_key`;

/**
 * The API lists a verse under the page it starts on (or inconsistently near boundaries), so a request for
 * page N may contain words that live on N+1 and omit others. Regroup every word by its own page_number
 * (deduplicated by word id) into per-page payloads.
 */
export function groupByPage(payloads) {
  const pages = new Map();
  const seen = new Set();
  for (const pl of payloads) {
    for (const v of pl.verses ?? []) {
      for (const w of v.words ?? []) {
        const id = w.id ?? `${v.verse_key}/${w.position}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const pg = w.page_number;
        if (!Number.isInteger(pg)) throw new Error(`${v.verse_key}: word without page_number`);
        if (!pages.has(pg)) pages.set(pg, new Map());
        const m = pages.get(pg);
        if (!m.has(v.verse_key)) m.set(v.verse_key, { verse_key: v.verse_key, words: [] });
        m.get(v.verse_key).words.push(w);
      }
    }
  }
  const out = new Map();
  for (const [pg, m] of pages) {
    const verses = [...m.values()];
    for (const v of verses) v.words.sort((a, b) => a.position - b.position);
    out.set(pg, { verses });
  }
  return out;
}

/**
 * Converts the API payload (all pages of verses merged) into a compact page layout.
 * lines: [{n, type:'text'|'surah'|'bism', surah?, words?:[{code, verse, type?:'end'}]}]
 * Header lines are not in the API: they are the empty line(s) just before the first word of ayah 1
 * (1 line: surah name, for surah 1 and 9; 2 lines: name + basmalah otherwise; if only one line is free the
 * 'surah' line carries bism:true and shows the basmalah inside its frame).
 */
export function buildQcfPage(payload, page) {
  const byLine = new Map();
  for (const v of payload.verses ?? []) {
    const key = v.verse_key;
    if (!/^\d+:\d+$/.test(key ?? '')) throw new Error(`page ${page}: bad verse_key ${key}`);
    for (const w of v.words ?? []) {
      if (w.page_number !== undefined && w.page_number !== page) continue; // verse continues on another page
      const n = w.line_number;
      if (!Number.isInteger(n) || n < 1 || n > MAX_LINES) throw new Error(`page ${page}: bad line_number ${n}`);
      if (typeof w.code_v2 !== 'string' || !w.code_v2) throw new Error(`page ${page}: missing code_v2 (${key})`);
      const kind = w.char_type_name === 'end' ? 'end' : 'word';
      if (kind === 'word' && w.char_type_name !== 'word') throw new Error(`page ${page}: unknown char type ${w.char_type_name}`);
      if (!byLine.has(n)) byLine.set(n, []);
      const word = { code: w.code_v2, verse: key };
      if (kind === 'end') word.type = 'end';
      byLine.get(n).push(word);
    }
  }
  const lines = new Map();
  for (const [n, words] of byLine) lines.set(n, { n, type: 'text', words });
  // Header lines.
  for (const [n, words] of [...byLine]) {
    const first = words[0];
    const [s, a] = first.verse.split(':').map(Number);
    if (a !== 1 || hasEarlierWord(byLine, n, s)) continue; // header only before the first word of ayah 1
    const need = s === 1 || s === 9 ? 1 : 2;
    if (need === 2 && n === 2 && !lines.has(1)) {
      // Layout has a single free line (e.g. page 77): the basmalah shares the surah-name frame.
      lines.set(1, { n: 1, type: 'surah', surah: s, bism: true });
      continue;
    }
    const bismLine = need === 2 ? n - 1 : null;
    const nameLine = n - need;
    if (nameLine < 1 || lines.has(nameLine) || (bismLine && lines.has(bismLine))) {
      throw new Error(`page ${page}: no room for surah ${s} header before line ${n}`);
    }
    lines.set(nameLine, { n: nameLine, type: 'surah', surah: s });
    if (bismLine) lines.set(bismLine, { n: bismLine, type: 'bism', surah: s });
  }
  return {
    format: QCF_FORMAT,
    version: QCF_VERSION,
    page,
    lines: [...lines.values()].sort((x, y) => x.n - y.n),
  };
}

function hasEarlierWord(byLine, n, surah) {
  for (const [ln, words] of byLine) {
    if (ln >= n) continue;
    if (words.some((w) => w.verse.startsWith(`${surah}:`))) return true;
  }
  return false;
}

/** Validates the 604 built pages; returns a list of error strings. */
export function validateQcf(pages, surahs) {
  const errs = [];
  if (pages.length !== 604) errs.push(`expected 604 pages, got ${pages.length}`);
  const seen = new Set();
  pages.forEach((p, i) => {
    if (p.page !== i + 1) errs.push(`index ${i}: page number ${p.page}`);
    if (p.lines.length > MAX_LINES) errs.push(`page ${p.page}: ${p.lines.length} lines`);
    const nums = p.lines.map((l) => l.n);
    if (new Set(nums).size !== nums.length) errs.push(`page ${p.page}: duplicate line numbers`);
    for (const l of p.lines) {
      if (l.type === 'text') {
        if (!l.words?.length) errs.push(`page ${p.page} line ${l.n}: empty text line`);
        for (const w of l.words ?? []) {
          const [s, a] = w.verse.split(':').map(Number);
          if (w.type === 'end') seen.add(`${s}:${a}`);
          seen.add(`${s}:${a}`);
        }
      } else if (l.type !== 'surah' && l.type !== 'bism') errs.push(`page ${p.page}: bad type ${l.type}`);
    }
  });
  let total = 0;
  for (const s of surahs) {
    for (let a = 1; a <= s.ayahCount; a++) {
      total++;
      if (!seen.has(`${s.number}:${a}`)) errs.push(`missing ayah ${s.number}:${a}`);
    }
  }
  if (total !== AYAH_TOTAL) errs.push(`surahs.json totals ${total} ayahs`);
  if (seen.size !== AYAH_TOTAL) errs.push(`distinct ayahs ${seen.size} != ${AYAH_TOTAL}`);
  // Each surah header must be present exactly once.
  const headers = new Map();
  for (const p of pages) for (const l of p.lines) if (l.type === 'surah') headers.set(l.surah, (headers.get(l.surah) ?? 0) + 1);
  for (let s = 1; s <= 114; s++) if (headers.get(s) !== 1) errs.push(`surah ${s} header count ${headers.get(s) ?? 0}`);
  return errs;
}

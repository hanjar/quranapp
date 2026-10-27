/**
 * Parser for the private Tafsir Ibnu Katsir text (curated AI translation). The text is
 * Markdown-ish: "=== s:a-b ===" section lines, blank-line paragraphs, *italic* / **bold**,
 * {{QS:s:a(-b)}} (a whole ayah, shown as the Kemenag translation), {{QS:s:a|arab}} (part of
 * an ayah), {{QS:?|arab}} (not identified) and [[RAGU: note]] (needs review). Rendered with
 * Angular bindings only, never innerHTML.
 */

export type Inline =
  | { t: 'text'; v: string; em?: boolean; strong?: boolean }
  | { t: 'qs'; s: number; from: number; to: number }
  | { t: 'frag'; s: number; from: number; to: number; arabic: string }
  | { t: 'unknown'; arabic: string }
  | { t: 'ragu'; note: string };

export type Block =
  | { kind: 'section'; label: string; s: number | null; from: number; to: number }
  | { kind: 'p'; parts: Inline[] };

export interface TafsirFile {
  format: 'mushaf-tafsir-ik';
  version: 1;
  surah: number;
  chunks: { id: string; verses: string; text: string }[];
}

const TOKEN = /\{\{QS:([^}]*)\}\}|\[\[RAGU(?::\s*((?:(?!\]\]).)*?))?\s*\]\]/g;
const REF = /^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/;

/** "2:1-5" → {s, from, to}; anything else → null. */
export function parseRef(ref: string): { s: number; from: number; to: number } | null {
  const m = ref.trim().match(REF);
  if (!m) return null;
  const from = Number(m[2]);
  return { s: Number(m[1]), from, to: m[3] ? Number(m[3]) : from };
}

/** Splits **bold** and *italic* runs; unmatched asterisks stay as text. */
export function emphasis(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'text', v: m[1], strong: true });
    else out.push({ t: 'text', v: m[2]!, em: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(...emphasis(text.slice(last, m.index)));
    last = m.index! + m[0].length;
    if (m[1] === undefined) {
      out.push({ t: 'ragu', note: (m[2] ?? '').trim() });
      continue;
    }
    const bar = m[1].indexOf('|');
    const ref = bar >= 0 ? m[1].slice(0, bar) : m[1];
    const arabic = bar >= 0 ? m[1].slice(bar + 1).trim() : '';
    const r = parseRef(ref);
    if (!r) out.push({ t: 'unknown', arabic: arabic || m[1] });
    else if (arabic) out.push({ t: 'frag', ...r, arabic });
    else out.push({ t: 'qs', ...r });
  }
  if (last < text.length) out.push(...emphasis(text.slice(last)));
  return out;
}

/** Whole surah → blocks; a section repeated at a chunk boundary is shown once. */
export function parseTafsir(file: Pick<TafsirFile, 'chunks'>): Block[] {
  const blocks: Block[] = [];
  let lastLabel = '';
  for (const c of file.chunks) {
    for (const para of c.text.split(/\n\s*\n/)) {
      const p = para.trim();
      if (!p) continue;
      const h = p.match(/^=== (.+) ===$/);
      if (h) {
        const label = h[1]!.trim();
        if (label === lastLabel) continue;
        lastLabel = label;
        const r = parseRef(label);
        blocks.push({
          kind: 'section',
          label,
          s: r?.s ?? null,
          from: r?.from ?? 0,
          to: r?.to ?? 0,
        });
        continue;
      }
      blocks.push({ kind: 'p', parts: parseInline(p.replace(/\s*\n\s*/g, ' ')) });
    }
  }
  return blocks;
}

/** Index of the section block covering `ayah`, or -1. */
export function sectionIndexFor(blocks: readonly Block[], ayah: number): number {
  let best = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind !== 'section' || !b.from) continue;
    if (ayah >= b.from && ayah <= b.to) return i;
    if (b.from <= ayah) best = i;
  }
  return best;
}

/** Tafsir Kemenag (one text per ayah) → the same blocks: an "Ayat n" section, then its paragraphs. */
export function kemenagBlocks(surah: number, ayahs: Record<string, string>): Block[] {
  const blocks: Block[] = [];
  const keys = Object.keys(ayahs)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  for (const a of keys) {
    blocks.push({ kind: 'section', label: `${surah}:${a}`, s: surah, from: a, to: a });
    for (const para of ayahs[String(a)]!.split(/\n+/)) {
      const p = para.trim();
      if (p) blocks.push({ kind: 'p', parts: [{ t: 'text', v: p }] });
    }
  }
  return blocks;
}

/** One aligned row of the side-by-side view: the ayat [from, to] and each source's blocks for them. */
export interface CompareRow {
  from: number;
  to: number;
  left: Block[];
  right: Block[];
}

interface Group {
  from: number;
  to: number;
  blocks: Block[];
}

/** A source's blocks cut at its own-surah sections; blocks before the first one go to `lead`. */
function groupsOf(surah: number, blocks: readonly Block[]): { groups: Group[]; lead: Block[] } {
  const groups: Group[] = [];
  const lead: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'section' && b.s === surah && b.from) {
      groups.push({ from: b.from, to: Math.max(b.from, b.to), blocks: [b] });
    } else if (groups.length) groups[groups.length - 1]!.blocks.push(b);
    else lead.push(b);
  }
  return { groups, lead };
}

/**
 * Aligns two tafsir sources for reading side by side. Each source is cut into groups at its own
 * sections (`s === surah`); overlapping ayah ranges of both sides are merged into rows, so a
 * ranged Ibnu Katsir section lines up with the per-ayah Kemenag ones it covers. Blocks before a
 * source's first own section join the first row.
 */
export function compareRows(surah: number, left: Block[], right: Block[]): CompareRow[] {
  const l = groupsOf(surah, left);
  const r = groupsOf(surah, right);
  const spans = [...l.groups, ...r.groups]
    .map((g) => ({ from: g.from, to: g.to }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp.from <= last.to) last.to = Math.max(last.to, sp.to);
    else merged.push({ ...sp });
  }
  const rows: CompareRow[] = merged.map((m) => ({ ...m, left: [], right: [] }));
  const place = (groups: Group[], side: 'left' | 'right') => {
    for (const g of groups) {
      const row = rows.find((x) => g.from >= x.from && g.from <= x.to);
      row?.[side].push(...g.blocks);
    }
  };
  place(l.groups, 'left');
  place(r.groups, 'right');
  if (rows.length) {
    rows[0]!.left.unshift(...l.lead);
    rows[0]!.right.unshift(...r.lead);
  }
  return rows;
}

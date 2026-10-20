/** Pure helpers for the QCF V4 (tajweed) renderer. No Angular, no DOM. */

export const QCF_FONT_BASE = 'https://verses.quran.foundation/fonts/quran/hafs/v4/colrv1/woff2';
export const QCF_ORIGIN = 'https://verses.quran.foundation';
export const QCF_ATTRIBUTION = 'Font & tata letak: King Fahd Complex (QCF V4) via Quran Foundation';

export const qcfFontUrl = (page: number): string => `${QCF_FONT_BASE}/p${page}.woff2`;
export const qcfFamily = (page: number): string => `mf-qcf-p${page}`;

export interface QcfWord {
  code: string;
  verse: string;
  type?: 'end';
}
export interface QcfLine {
  n: number;
  type: 'text' | 'surah' | 'bism';
  surah?: number;
  /** Surah-name line that also carries the basmalah (only one free line on the page). */
  bism?: boolean;
  words?: QcfWord[];
}
export interface QcfLayout {
  format: 'mushaf-qcf';
  version: number;
  page: number;
  lines: QcfLine[];
}

export function isQcfLayout(v: unknown, page: number): v is QcfLayout {
  const o = v as QcfLayout | null;
  return (
    !!o &&
    o.format === 'mushaf-qcf' &&
    o.page === page &&
    Array.isArray(o.lines) &&
    o.lines.length > 0 &&
    o.lines.length <= 15 &&
    o.lines.every((l) => Number.isInteger(l.n) && l.n >= 1 && l.n <= 15)
  );
}

/** Unique verses in reading order. */
export function layoutVerses(layout: QcfLayout): { surah: number; ayah: number }[] {
  const seen = new Set<string>();
  const out: { surah: number; ayah: number }[] = [];
  for (const l of layout.lines) {
    for (const w of l.words ?? []) {
      if (seen.has(w.verse)) continue;
      seen.add(w.verse);
      const [surah, ayah] = w.verse.split(':').map(Number);
      out.push({ surah, ayah });
    }
  }
  return out;
}

/** Pages 1-2 have 8 lines spread over the whole block, narrower than the other pages. */
export const isQcfCover = (page: number): boolean => page <= 2;

export function gridRows(layout: QcfLayout): number {
  return isQcfCover(layout.page) ? Math.max(8, ...layout.lines.map((l) => l.n)) : 15;
}

/** Lines whose natural width is below this share of the widest line are centred instead of stretched. */
export const CENTER_BELOW = 0.72;
export const DEFAULT_MAX_EM = 8;

export interface QcfMetrics {
  /** Width (em) of the widest line. */
  maxEm: number;
  /** Line number -> width in em. */
  lineEm: Record<number, number>;
}

/** Whether a text line should be centred (short line, e.g. the last of a surah) instead of justified. */
export function isCenteredLine(line: QcfLine, m: QcfMetrics | null, cover: boolean): boolean {
  if (line.type !== 'text') return false;
  if (cover) return true;
  if (!m) return false;
  const w = m.lineEm[line.n];
  return w !== undefined && w < m.maxEm * CENTER_BELOW;
}

export function computeMetrics(lineEm: Record<number, number>): QcfMetrics {
  const vals = Object.values(lineEm).filter((v) => v > 0);
  return { maxEm: vals.length ? Math.max(...vals) : DEFAULT_MAX_EM, lineEm };
}

export interface TajweedRule {
  label: string;
  color: string;
}

/** Legend from the Quran.com tajweed scheme (Indonesian rule names). */
export const TAJWEED_LEGEND: readonly TajweedRule[] = [
  { label: 'Ghunnah', color: '#FF7E1E' },
  { label: "Ikhfa'", color: '#9400A8' },
  { label: "Ikhfa' Syafawi", color: '#D500B7' },
  { label: 'Idgham bi Ghunnah', color: '#169777' },
  { label: 'Idgham bila Ghunnah', color: '#169200' },
  { label: 'Idgham Syafawi', color: '#58B800' },
  { label: 'Iqlab', color: '#26BFFD' },
  { label: 'Qalqalah', color: '#DD0008' },
  { label: "Mad Thabi'i (2 harakat)", color: '#537FFF' },
  { label: 'Mad Jaiz (2/4/6)', color: '#4050FF' },
  { label: 'Mad Wajib Muttasil', color: '#000EBC' },
  { label: 'Mad Lazim (6)', color: '#2144C1' },
  { label: 'Hamzah wasal, lam syamsiyyah, huruf tidak dibaca', color: '#AAAAAA' },
];

/**
 * CSS for the COLR palettes of one page font. The CPAL table of these fonts has palette 0 (light
 * backgrounds) and palette 1 (dark backgrounds); the base ink entries (0, 13, 14) are overridden
 * to the theme's text ink.
 */
export function paletteCss(family: string): string {
  const ink = (c: string) => `0 ${c}, 13 ${c}, 14 ${c}`;
  const rule = (name: string, base: number, c: string) =>
    `@font-palette-values --mf-qcf-${name} { font-family: "${family}"; base-palette: ${base}; override-colors: ${ink(c)}; }`;
  return [
    rule('day', 0, '#231f20'),
    rule('hc', 0, '#000000'),
    rule('night', 1, '#e6e0d4'),
    rule('hcnight', 1, '#ffffff'),
  ].join('\n');
}

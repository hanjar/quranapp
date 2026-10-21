import {
  BUILTIN_PAPER_THEMES,
  BuiltinPaperTheme,
  CUSTOM_THEME_LIMIT,
  CUSTOM_THEME_NAME_MAX,
  CustomTheme,
  PaperTheme,
  Preferences,
} from './models';

/** Pure helpers for user-made colour themes (validation, contrast, CSS variables). */

const HEX6 = /^#[0-9a-f]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export type ThemeColorKey =
  'paper' | 'surround' | 'frameInk' | 'frameInkInner' | 'ayahOrnament' | 'textInk';
export type ThemeColors = Pick<CustomTheme, ThemeColorKey>;

export const THEME_COLOR_KEYS: readonly ThemeColorKey[] = [
  'paper',
  'surround',
  'frameInk',
  'frameInkInner',
  'ayahOrnament',
  'textInk',
];

/** Krem Madinah as colours: the starting point of a new theme and the target of "Kembalikan". */
export const BASE_THEME_COLORS: ThemeColors = {
  paper: '#fffdf6',
  surround: '#f1e9d2',
  frameInk: '#ae3033',
  frameInkInner: '#d7c388',
  ayahOrnament: '#a07a2c',
  textInk: '#231f20',
};

/** `#rgb` / `rgb` / `#RRGGBB` -> lowercase `#rrggbb`, or null when it is not a hex colour. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let t = v.trim().toLowerCase();
  if (t.startsWith('#')) t = t.slice(1);
  if (/^[0-9a-f]{3}$/.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX6.test(v);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mixes `from` toward `to` by `t` (0..1). */
export function mixHex(from: string, to: string, t: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return toHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as [number, number, number]);
}

/** The raised surface used for UI panels (`--mf-surface-paper`): a lighter step of the paper. */
export function surfacePaper(paper: string): string {
  return luminance(paper) < 0.18 ? mixHex(paper, '#ffffff', 0.08) : mixHex(paper, '#ffffff', 0.6);
}

export interface ContrastCheck {
  key: 'text' | 'ornament' | 'frameOuter' | 'frameInner';
  label: string;
  ratio: number;
  min: number;
  ok: boolean;
}

/** Contrast of the text ink, ayah ornament and borders against the paper. Warnings, never blocks. */
export function contrastChecks(c: ThemeColors): ContrastCheck[] {
  const row = (
    key: ContrastCheck['key'],
    label: string,
    fg: string,
    min: number,
  ): ContrastCheck => {
    const ratio = Math.round(contrastRatio(fg, c.paper) * 100) / 100;
    return { key, label, ratio, min, ok: ratio >= min };
  };
  return [
    row('text', 'Teks', c.textInk, 4.5),
    row('ornament', 'Ornamen nomor ayat', c.ayahOrnament, 3),
    row('frameOuter', 'Border luar', c.frameInk, 3),
    row('frameInner', 'Border dalam', c.frameInkInner, 3),
  ];
}

/** The CSS variables a custom theme sets inline on <html> (day mode only). */
export function customThemeVars(t: ThemeColors): Record<string, string> {
  const [r, g, b] = rgb(t.frameInkInner);
  return {
    '--mf-paper': t.paper,
    '--mf-surface-paper': surfacePaper(t.paper),
    '--mf-surround': t.surround,
    '--mf-frame-ink': t.frameInk,
    '--mf-frame-ink-inner': t.frameInkInner,
    '--mf-ayah-ornament': t.ayahOrnament,
    '--mf-text-ink': t.textInk,
    '--mf-line-rule': `rgb(${r} ${g} ${b} / 0.6)`,
  };
}

export const CUSTOM_THEME_VAR_NAMES: readonly string[] = Object.keys(
  customThemeVars(BASE_THEME_COLORS),
);

export function customPaperId(id: string): PaperTheme {
  return `custom:${id}`;
}

/** The theme id inside `custom:<id>`, or null for a built-in paper. */
export function customIdOf(paper: string): string | null {
  return paper.startsWith('custom:') ? paper.slice('custom:'.length) : null;
}

export function isPaperThemeId(v: unknown): v is PaperTheme {
  if (typeof v !== 'string') return false;
  if ((BUILTIN_PAPER_THEMES as readonly string[]).includes(v)) return true;
  const id = customIdOf(v);
  return id !== null && ID_RE.test(id);
}

export interface ResolvedPaper {
  /** Value for html[data-paper]: the built-in id, or the default 'sepia' when the custom theme is missing. */
  builtin: BuiltinPaperTheme;
  custom: CustomTheme | null;
}

/** Resolves the active paper; a `custom:` id that no longer exists falls back to Krem Madinah. */
export function resolvePaper(p: Pick<Preferences, 'paperTheme' | 'customThemes'>): ResolvedPaper {
  const id = customIdOf(p.paperTheme);
  if (id === null) return { builtin: p.paperTheme as BuiltinPaperTheme, custom: null };
  const custom = p.customThemes.find((t) => t.id === id) ?? null;
  return { builtin: 'sepia', custom };
}

/** Lenient parse of stored/imported/synced themes: bad entries dropped, ids unique, capped. */
export function parseCustomThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTheme[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= CUSTOM_THEME_LIMIT) break;
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = o['id'];
    const name = typeof o['name'] === 'string' ? o['name'].trim() : '';
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
    if (!name || name.length > CUSTOM_THEME_NAME_MAX) continue;
    const colors = {} as Record<ThemeColorKey, string>;
    let ok = true;
    for (const k of THEME_COLOR_KEYS) {
      const hex = normalizeHex(o[k]);
      if (hex === null || o[k] !== hex) ok = false;
      else colors[k] = hex;
    }
    if (!ok) continue;
    seen.add(id);
    out.push({ id, name, ...colors });
  }
  return out;
}

/** Validates a draft before saving; returns an Indonesian message or null. */
export function validateThemeDraft(name: string, colors: ThemeColors): string | null {
  const n = name.trim();
  if (!n) return 'Beri nama tema.';
  if (n.length > CUSTOM_THEME_NAME_MAX)
    return `Nama tema paling banyak ${CUSTOM_THEME_NAME_MAX} huruf.`;
  for (const k of THEME_COLOR_KEYS) {
    if (!isHexColor(colors[k])) return 'Ada warna yang belum valid. Gunakan format #rrggbb.';
  }
  return null;
}

export function newCustomThemeId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `t${rnd}`;
}

/** "Tema saya 1", "Tema saya 2", ... first number not used by an existing name. */
export function defaultThemeName(existing: readonly CustomTheme[]): string {
  const used = new Set(existing.map((t) => t.name.toLocaleLowerCase('id')));
  for (let i = 1; i <= CUSTOM_THEME_LIMIT + 1; i++) {
    const name = `Tema saya ${i}`;
    if (!used.has(name.toLocaleLowerCase('id'))) return name;
  }
  return `Tema saya ${existing.length + 1}`;
}

/** Curated swatches per field. */
export const COLOR_SWATCHES: Record<ThemeColorKey, { name: string; hex: string }[]> = {
  paper: [
    { name: 'Krem Madinah', hex: '#fffdf6' },
    { name: 'Gading', hex: '#f5f1e8' },
    { name: 'Sepia', hex: '#f4ecd8' },
    { name: 'Biru muda', hex: '#eef4fb' },
    { name: 'Hijau muda', hex: '#eef6ee' },
    { name: 'Putih', hex: '#ffffff' },
  ],
  surround: [
    { name: 'Krem tua', hex: '#f1e9d2' },
    { name: 'Gading tua', hex: '#e8e2d4' },
    { name: 'Sepia tua', hex: '#e2d3b3' },
    { name: 'Biru pucat', hex: '#d6e2f2' },
    { name: 'Hijau pucat', hex: '#d3e5d3' },
    { name: 'Abu', hex: '#dddbd6' },
  ],
  frameInk: [
    { name: 'Merah Madinah', hex: '#ae3033' },
    { name: 'Biru klasik', hex: '#1f4e8c' },
    { name: 'Hijau tua', hex: '#1d6b4a' },
    { name: 'Cokelat sepia', hex: '#6e4a24' },
    { name: 'Ungu', hex: '#5b3a8a' },
    { name: 'Hitam', hex: '#231f20' },
  ],
  frameInkInner: [
    { name: 'Emas Madinah', hex: '#a07a2c' },
    { name: 'Emas tua', hex: '#7e6020' },
    { name: 'Biru sedang', hex: '#3f73b5' },
    { name: 'Hijau sedang', hex: '#3d8a63' },
    { name: 'Cokelat muda', hex: '#8a6a3f' },
    { name: 'Abu tua', hex: '#6b6b6b' },
  ],
  ayahOrnament: [
    { name: 'Emas', hex: '#a07a2c' },
    { name: 'Emas tua', hex: '#7e6020' },
    { name: 'Merah Madinah', hex: '#ae3033' },
    { name: 'Biru klasik', hex: '#1f4e8c' },
    { name: 'Hijau tua', hex: '#1d6b4a' },
    { name: 'Cokelat sepia', hex: '#6e4a24' },
  ],
  textInk: [
    { name: 'Tinta bawaan', hex: '#231f20' },
    { name: 'Hitam', hex: '#000000' },
    { name: 'Biru tua', hex: '#10243f' },
    { name: 'Hijau tua', hex: '#12301f' },
    { name: 'Cokelat tua', hex: '#3b2a17' },
    { name: 'Abu tua', hex: '#333333' },
  ],
};

export interface ThemeStarter {
  id: string;
  name: string;
  colors: ThemeColors;
}

/** Whole-theme starting points. */
export const THEME_STARTERS: readonly ThemeStarter[] = [
  { id: 'madinah', name: 'Merah & emas', colors: BASE_THEME_COLORS },
  {
    id: 'biru',
    name: 'Biru klasik',
    colors: {
      paper: '#f6f9fd',
      surround: '#d6e2f2',
      frameInk: '#1f4e8c',
      frameInkInner: '#3f73b5',
      ayahOrnament: '#1f4e8c',
      textInk: '#10243f',
    },
  },
  {
    id: 'hijau',
    name: 'Hijau',
    colors: {
      paper: '#f5faf4',
      surround: '#d3e5d3',
      frameInk: '#1d6b4a',
      frameInkInner: '#3d8a63',
      ayahOrnament: '#1d6b4a',
      textInk: '#12301f',
    },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    colors: {
      paper: '#f4ecd8',
      surround: '#e2d3b3',
      frameInk: '#6e4a24',
      frameInkInner: '#8a6a3f',
      ayahOrnament: '#6e4a24',
      textInk: '#3b2a17',
    },
  },
];

export function pickColors(t: ThemeColors): ThemeColors {
  return {
    paper: t.paper,
    surround: t.surround,
    frameInk: t.frameInk,
    frameInkInner: t.frameInkInner,
    ayahOrnament: t.ayahOrnament,
    textInk: t.textInk,
  };
}

export function sameColors(a: ThemeColors, b: ThemeColors): boolean {
  return THEME_COLOR_KEYS.every((k) => a[k] === b[k]);
}

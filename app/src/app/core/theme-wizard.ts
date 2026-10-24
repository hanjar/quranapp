import { ThemeColors, contrastRatio, luminance, mixHex } from './custom-theme';

/**
 * Theme wizard: one or two favourite colours → three readable mushaf themes.
 * A light favourite becomes the paper, a deep one the frame and ornaments; the paper of a deep
 * colour is a pale tint of it. Every result keeps text ≥ 7:1 and frame/ornament ≥ 3:1 on the paper.
 */

export interface ThemeSuggestion {
  id: 'lembut' | 'seimbang' | 'tegas';
  label: string;
  colors: ThemeColors;
}

type Hsl = [number, number, number];

function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToHex([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v + m)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Darkens `fg` (same hue) until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  let [h, s, l] = hexToHsl(fg);
  let out = fg;
  for (let i = 0; i < 40 && contrastRatio(out, bg) < min; i++) {
    l = Math.max(0, l - 0.025);
    out = hslToHex([h, s, l]);
  }
  return out;
}

/** True for colours that work as a paper (light enough to read dark ink on). */
export function isLight(hex: string): boolean {
  return luminance(hex) > 0.45;
}

/** Accent (frame) colour that goes with a light paper: same hue, deep. Near-greys get a warm brown. */
function accentFor(paper: string): string {
  const [h, s] = hexToHsl(paper);
  if (s < 0.12) return '#6d4c2f';
  return hslToHex([h, clamp(s, 0.45, 0.75), 0.3]);
}

function build(paper: string, surround: string, accent: string, inkBase: string): ThemeColors {
  const frameInk = ensureContrast(accent, paper, 3.2);
  const ayahOrnament = ensureContrast(mixHex(accent, '#000000', 0.1), paper, 3.2);
  const frameInkInner = ensureContrast(mixHex(accent, paper, 0.45), paper, 3);
  const textInk = ensureContrast(mixHex(inkBase, accent, 0.06), paper, 7);
  return { paper, surround, frameInk, frameInkInner, ayahOrnament, textInk };
}

/**
 * Three themes from the favourite colours (1 or 2; extra ones ignored). With two, the lighter
 * is the paper and the deeper the accent.
 */
export function suggestThemes(favourites: readonly string[]): ThemeSuggestion[] {
  const picks = favourites.slice(0, 2);
  if (!picks.length) return [];
  const sorted = [...picks].sort((a, b) => luminance(b) - luminance(a));
  const light = sorted.find(isLight) ?? null;
  const deep = sorted.find((c) => c !== light && !isLight(c)) ?? (light ? null : sorted[0]!);

  let basePaper: string;
  let accent: string;
  if (light && deep) {
    basePaper = light;
    accent = deep;
  } else if (light) {
    basePaper = light;
    accent = accentFor(light);
  } else {
    accent = deep!;
    const [h, s] = hexToHsl(accent);
    basePaper = hslToHex([h, Math.min(s, 0.45), 0.95]);
  }
  const [ph, ps, pl] = hexToHsl(basePaper);
  // Very bright pure colours (lemon, white) are softened a little so the page does not glare.
  const paper = hslToHex([ph, Math.min(ps, 0.6), clamp(pl, 0.86, 0.975)]);
  const ink = '#1f1c1a';

  const soft = hslToHex([ph, Math.min(ps, 0.4), clamp(pl + 0.015, 0.9, 0.98)]);
  const [ah, as] = hexToHsl(accent);
  return [
    {
      id: 'lembut',
      label: 'Lembut',
      colors: build(soft, mixHex(soft, accent, 0.08), mixHex(accent, soft, 0.15), ink),
    },
    {
      id: 'seimbang',
      label: 'Seimbang',
      colors: build(paper, mixHex(paper, accent, 0.16), accent, ink),
    },
    {
      id: 'tegas',
      label: 'Tegas',
      colors: build(
        paper,
        mixHex(paper, accent, 0.32),
        hslToHex([ah, clamp(as + 0.1, 0, 0.9), clamp(hexToHsl(accent)[2] - 0.06, 0.12, 0.4)]),
        '#141210',
      ),
    },
  ];
}

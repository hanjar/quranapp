import { describe, expect, it } from 'vitest';
import {
  BASE_THEME_COLORS,
  COLOR_SWATCHES,
  CUSTOM_THEME_VAR_NAMES,
  THEME_COLOR_KEYS,
  THEME_STARTERS,
  contrastChecks,
  contrastRatio,
  customIdOf,
  customThemeVars,
  defaultThemeName,
  isPaperThemeId,
  normalizeHex,
  parseCustomThemes,
  resolvePaper,
  surfacePaper,
  validateThemeDraft,
} from './custom-theme';
import { CUSTOM_THEME_LIMIT, CustomTheme } from './models';

const theme = (id: string, over: Partial<CustomTheme> = {}): CustomTheme => ({
  id,
  name: `Tema ${id}`,
  ...BASE_THEME_COLORS,
  ...over,
});

describe('hex helpers', () => {
  it('normalizes hex input', () => {
    expect(normalizeHex('#FFFDF6')).toBe('#fffdf6');
    expect(normalizeHex(' abc ')).toBe('#aabbcc');
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex('#gggggg')).toBeNull();
    expect(normalizeHex(5)).toBeNull();
  });

  it('every swatch and starter is a valid hex', () => {
    for (const k of THEME_COLOR_KEYS)
      for (const s of COLOR_SWATCHES[k]) expect(normalizeHex(s.hex)).toBe(s.hex);
    for (const s of THEME_STARTERS)
      for (const k of THEME_COLOR_KEYS) expect(normalizeHex(s.colors[k])).toBe(s.colors[k]);
  });
});

describe('contrast', () => {
  it('matches known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('flags text below 4.5 and ornament/frames below 3, without blocking', () => {
    const checks = contrastChecks({
      ...BASE_THEME_COLORS,
      textInk: '#bbbbbb',
      ayahOrnament: '#fff8e0',
    });
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by['text']!.ok).toBe(false);
    expect(by['text']!.min).toBe(4.5);
    expect(by['ornament']!.ok).toBe(false);
    expect(by['ornament']!.min).toBe(3);
    expect(by['frameOuter']!.ok).toBe(true);
    expect(validateThemeDraft('Tema', { ...BASE_THEME_COLORS, textInk: '#bbbbbb' })).toBeNull();
  });

  it('every starter has readable text and ornament', () => {
    for (const s of THEME_STARTERS) {
      const by = Object.fromEntries(contrastChecks(s.colors).map((c) => [c.key, c]));
      expect(by['text']!.ok, s.id).toBe(true);
      expect(by['ornament']!.ok, s.id).toBe(true);
    }
  });
});

describe('css variables', () => {
  it('covers every editable token and derives the surface paper', () => {
    const v = customThemeVars(BASE_THEME_COLORS);
    expect(v['--mf-paper']).toBe('#fffdf6');
    expect(v['--mf-surround']).toBe('#f1e9d2');
    expect(v['--mf-frame-ink']).toBe('#ae3033');
    expect(v['--mf-frame-ink-inner']).toBe('#d7c388');
    expect(v['--mf-ayah-ornament']).toBe('#a07a2c');
    expect(v['--mf-text-ink']).toBe('#231f20');
    expect(v['--mf-surface-paper']).toBe(surfacePaper('#fffdf6'));
    expect(Object.keys(v)).toEqual([...CUSTOM_THEME_VAR_NAMES]);
  });

  it('surface paper is lighter than the paper (only slightly for dark papers)', () => {
    expect(contrastRatio(surfacePaper('#f5f1e8'), '#f5f1e8')).toBeGreaterThan(1);
    expect(luminanceOrder(surfacePaper('#f5f1e8'), '#f5f1e8')).toBe(true);
    const dark = surfacePaper('#101010');
    expect(luminanceOrder(dark, '#101010')).toBe(true);
    expect(contrastRatio(dark, '#101010')).toBeLessThan(1.3);
  });
});

function luminanceOrder(lighter: string, darker: string): boolean {
  return contrastRatio(lighter, '#000000') > contrastRatio(darker, '#000000');
}

describe('paper ids', () => {
  it('accepts built-in and custom ids', () => {
    expect(isPaperThemeId('cream')).toBe(true);
    expect(isPaperThemeId('custom:abc_1-2')).toBe(true);
    expect(isPaperThemeId('custom:')).toBe(false);
    expect(isPaperThemeId('custom:a b')).toBe(false);
    expect(isPaperThemeId('neon')).toBe(false);
    expect(customIdOf('custom:xyz')).toBe('xyz');
    expect(customIdOf('ivory')).toBeNull();
  });

  it('resolves a missing custom theme to Krem Madinah', () => {
    const t = theme('a');
    expect(resolvePaper({ paperTheme: 'custom:a', customThemes: [t] })).toEqual({
      builtin: 'cream',
      custom: t,
    });
    expect(resolvePaper({ paperTheme: 'custom:gone', customThemes: [t] })).toEqual({
      builtin: 'cream',
      custom: null,
    });
    expect(resolvePaper({ paperTheme: 'photo', customThemes: [t] })).toEqual({
      builtin: 'photo',
      custom: null,
    });
  });
});

describe('parseCustomThemes', () => {
  it('keeps valid themes and drops bad ones', () => {
    const out = parseCustomThemes([
      theme('a'),
      theme('a'), // duplicate id
      theme('b', { paper: 'red' }),
      { ...theme('c'), paper: '#FFFDF6' }, // not normalised
      theme('bad id'),
      theme('d', { name: ' ' }),
      theme('e', { name: 'x'.repeat(31) }),
      null,
      'x',
      theme('f'),
    ]);
    expect(out.map((t) => t.id)).toEqual(['a', 'f']);
    expect(parseCustomThemes('nope')).toEqual([]);
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => theme(`t${i}`));
    expect(parseCustomThemes(many)).toHaveLength(CUSTOM_THEME_LIMIT);
  });
});

describe('draft', () => {
  it('validates name and colours', () => {
    expect(validateThemeDraft('Tema saya', BASE_THEME_COLORS)).toBeNull();
    expect(validateThemeDraft('  ', BASE_THEME_COLORS)).toMatch(/nama/i);
    expect(validateThemeDraft('x'.repeat(31), BASE_THEME_COLORS)).toMatch(/30/);
    expect(validateThemeDraft('ok', { ...BASE_THEME_COLORS, paper: '#xyz' })).toMatch(/warna/i);
  });

  it('suggests the first unused default name', () => {
    expect(defaultThemeName([])).toBe('Tema saya 1');
    expect(
      defaultThemeName([theme('a', { name: 'Tema saya 1' }), theme('b', { name: 'tema saya 2' })]),
    ).toBe('Tema saya 3');
  });
});

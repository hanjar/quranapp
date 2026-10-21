import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_THEME_COLORS, CUSTOM_THEME_VAR_NAMES } from './custom-theme';
import { CustomTheme } from './models';
import { fakeUserData } from './testing-prefs';
import { ThemeService } from './theme.service';

const mine: CustomTheme = {
  id: 'mine',
  name: 'Tema saya 1',
  ...BASE_THEME_COLORS,
  paper: '#eef4fb',
  surround: '#d6e2f2',
  frameInk: '#1f4e8c',
};

const html = () => document.documentElement;
const varsSet = () => CUSTOM_THEME_VAR_NAMES.filter((k) => html().style.getPropertyValue(k) !== '');

describe('ThemeService custom themes', () => {
  beforeEach(() => {
    CUSTOM_THEME_VAR_NAMES.forEach((k) => html().style.removeProperty(k));
    html().removeAttribute('data-night');
    TestBed.resetTestingModule();
  });

  function setup(initial: Parameters<typeof fakeUserData>[0]) {
    const d = fakeUserData(initial);
    TestBed.configureTestingModule({ providers: [d.provider] });
    const svc = TestBed.inject(ThemeService);
    TestBed.tick();
    return { d, svc };
  }

  it('sets the CSS variables inline for the active custom theme', () => {
    setup({ paperTheme: 'custom:mine', customThemes: [mine] });
    expect(html().style.getPropertyValue('--mf-paper')).toBe('#eef4fb');
    expect(html().style.getPropertyValue('--mf-surround')).toBe('#d6e2f2');
    expect(html().style.getPropertyValue('--mf-frame-ink')).toBe('#1f4e8c');
    expect(html().style.getPropertyValue('--mf-surface-paper')).not.toBe('');
    expect(html().dataset['paper']).toBe('sepia');
  });

  it('removes them when switching back to a built-in paper', () => {
    const { d } = setup({ paperTheme: 'custom:mine', customThemes: [mine] });
    expect(varsSet().length).toBe(CUSTOM_THEME_VAR_NAMES.length);
    d.prefs.update((p) => ({ ...p, paperTheme: 'photo' }));
    TestBed.tick();
    expect(varsSet()).toEqual([]);
    expect(html().dataset['paper']).toBe('photo');
  });

  it('night mode and high contrast override the custom theme', () => {
    const { d } = setup({ paperTheme: 'custom:mine', customThemes: [mine], nightMode: 'on' });
    expect(varsSet()).toEqual([]);
    expect(html().dataset['night']).toBe('on');
    d.prefs.update((p) => ({ ...p, nightMode: 'off', highContrast: true }));
    TestBed.tick();
    expect(varsSet()).toEqual([]);
    d.prefs.update((p) => ({ ...p, highContrast: false }));
    TestBed.tick();
    expect(varsSet().length).toBe(CUSTOM_THEME_VAR_NAMES.length);
  });

  it('a deleted active theme falls back to the default Sepia with no inline vars', () => {
    const { d } = setup({ paperTheme: 'custom:mine', customThemes: [mine] });
    d.prefs.update((p) => ({ ...p, customThemes: [] }));
    TestBed.tick();
    expect(varsSet()).toEqual([]);
    expect(html().dataset['paper']).toBe('sepia');
  });

  it('edited colours apply live', () => {
    const { d } = setup({ paperTheme: 'custom:mine', customThemes: [mine] });
    d.prefs.update((p) => ({ ...p, customThemes: [{ ...mine, paper: '#ffffff' }] }));
    TestBed.tick();
    expect(html().style.getPropertyValue('--mf-paper')).toBe('#ffffff');
  });
});

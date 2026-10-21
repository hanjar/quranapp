import { DEFAULT_PREFERENCES } from '../models';
import { validatePreferences } from './export-file';
import { prefsPayload } from '../sync/outbox';

const base = {
  paperTheme: 'cream',
  uiTheme: 'segar',
  layoutMode: 'auto',
  controlsAlwaysVisible: true,
  motion: 'system',
  highContrast: false,
};

describe('validatePreferences: device settings', () => {
  it('older exports without the fields get defaults', () => {
    expect(validatePreferences(base)).toMatchObject({
      lineRules: false, showLatin: false, translationScale: 1, audioMode: 'surah', audioFollow: true, pageRenderer: 'classic',
    });
  });

  it('accepts valid values and falls back on invalid ones', () => {
    expect(
      validatePreferences({ ...base, lineRules: true, showLatin: true, translationScale: 1.5, audioMode: 'page', audioFollow: false, pageRenderer: 'qcf-tajweed' }),
    ).toMatchObject({ lineRules: true, showLatin: true, translationScale: 1.45, audioMode: 'page', audioFollow: false, pageRenderer: 'qcf-tajweed' });
    expect(validatePreferences({ ...base, lineRules: 'on', translationScale: 'x', audioMode: 'juz', pageRenderer: 'z' })).toMatchObject({
      lineRules: false, translationScale: 1, audioMode: 'surah', pageRenderer: 'classic',
    });
  });
});

describe('validatePreferences: custom themes', () => {
  const theme = { id: 't1', name: 'Tema saya 1', paper: '#fffdf6', surround: '#f1e9d2', frameInk: '#ae3033', frameInkInner: '#d7c388', ayahOrnament: '#a07a2c', textInk: '#231f20' };

  it('older exports get no custom themes', () => {
    expect(validatePreferences(base).customThemes).toEqual([]);
  });

  it('keeps valid themes, accepts a custom: paper, drops invalid entries', () => {
    const v = validatePreferences({ ...base, paperTheme: 'custom:t1', customThemes: [theme, { ...theme, id: 't2', paper: 'red' }] });
    expect(v.paperTheme).toBe('custom:t1');
    expect(v.customThemes.map((t) => t.id)).toEqual(['t1']);
  });

  it('rejects an unknown paper id', () => {
    expect(() => validatePreferences({ ...base, paperTheme: 'neon' })).toThrow();
  });

  it('the sync payload carries the themes', () => {
    expect(prefsPayload({ ...DEFAULT_PREFERENCES, customThemes: [theme] })['customThemes']).toEqual([theme]);
  });
});

describe('sync outbox prefs payload', () => {
  it('carries the synced device settings', () => {
    const p = prefsPayload({ ...DEFAULT_PREFERENCES, lineRules: true, audioMode: 'ayah', pageRenderer: 'qcf-tajweed', translationScale: 1.3 });
    expect(p).toMatchObject({ lineRules: true, showLatin: false, translationScale: 1.3, audioMode: 'ayah', audioFollow: true, pageRenderer: 'qcf-tajweed' });
  });
});

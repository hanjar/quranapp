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

describe('sync outbox prefs payload', () => {
  it('carries the synced device settings', () => {
    const p = prefsPayload({ ...DEFAULT_PREFERENCES, lineRules: true, audioMode: 'ayah', pageRenderer: 'qcf-tajweed', translationScale: 1.3 });
    expect(p).toMatchObject({ lineRules: true, showLatin: false, translationScale: 1.3, audioMode: 'ayah', audioFollow: true, pageRenderer: 'qcf-tajweed' });
  });
});

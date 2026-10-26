import { mergePrefs, newerIn } from './prefs-merge';

describe('mergePrefs', () => {
  it('keeps a setting the other device never touched (the lost custom theme)', () => {
    const phone = {
      paperTheme: 'custom:t1',
      customThemes: [{ id: 't1' }],
      updatedAt: 100,
      fieldTimes: { paperTheme: 100, customThemes: 100 },
    };
    const pc = { paperTheme: 'blue', customThemes: [], updatedAt: 200, fieldTimes: { paperTheme: 200 } };
    const m = mergePrefs(phone, pc);
    expect(m['paperTheme']).toBe('blue');
    expect(m['customThemes']).toEqual([{ id: 't1' }]);
    expect(m['fieldTimes']).toEqual({ paperTheme: 200, customThemes: 100 });
    expect(m['updatedAt']).toBe(200);
  });

  it('older payloads without fieldTimes count as changed at updatedAt', () => {
    const legacy = { lineRules: false, updatedAt: 50 };
    const modern = { lineRules: true, updatedAt: 40, fieldTimes: { lineRules: 40 } };
    expect(mergePrefs(modern, legacy)['lineRules']).toBe(false);
    expect(mergePrefs(legacy, { lineRules: true, updatedAt: 60, fieldTimes: { lineRules: 60 } })['lineRules']).toBe(true);
  });

  it('merges extra settings per key', () => {
    const a = { extra: { pageSound: 'grab', wake: '10' }, updatedAt: 1, fieldTimes: { 'extra.pageSound': 10, 'extra.wake': 30 } };
    const b = { extra: { pageSound: 'off' }, updatedAt: 2, fieldTimes: { 'extra.pageSound': 20 } };
    const m = mergePrefs(a, b);
    expect(m['extra']).toEqual({ pageSound: 'off', wake: '10' });
  });

  it('newerIn tells when local has something the cloud lacks', () => {
    const local = { a: 1, updatedAt: 5, fieldTimes: { a: 5 } };
    expect(newerIn(local, { a: 0, updatedAt: 3, fieldTimes: { a: 3 } })).toBe(true);
    expect(newerIn(local, { a: 1, updatedAt: 9, fieldTimes: { a: 9 } })).toBe(false);
    expect(newerIn({ extra: { x: 1 }, updatedAt: 5, fieldTimes: { 'extra.x': 5 } }, { updatedAt: 1, fieldTimes: {} })).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LineRulesService } from './line-rules.service';
import { fakeUserData } from './testing-prefs';

describe('LineRulesService', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-line-rules');
    TestBed.resetTestingModule();
  });

  it('defaults to off', () => {
    TestBed.configureTestingModule({ providers: [fakeUserData().provider] });
    const s = TestBed.inject(LineRulesService);
    TestBed.tick();
    expect(s.enabled()).toBe(false);
    expect(document.documentElement.hasAttribute('data-line-rules')).toBe(false);
  });

  it('reads the synced pref and applies the attribute', () => {
    const d = fakeUserData({ lineRules: true });
    TestBed.configureTestingModule({ providers: [d.provider] });
    const s = TestBed.inject(LineRulesService);
    s.applyNow();
    expect(s.enabled()).toBe(true);
    expect(document.documentElement.getAttribute('data-line-rules')).toBe('on');
    d.prefs.update((p) => ({ ...p, lineRules: false }));
    TestBed.tick();
    expect(document.documentElement.hasAttribute('data-line-rules')).toBe(false);
  });

  it('set() writes through setPrefs', () => {
    const d = fakeUserData();
    TestBed.configureTestingModule({ providers: [d.provider] });
    TestBed.inject(LineRulesService).set(true);
    expect(d.setPrefs).toHaveBeenCalledWith({ lineRules: true });
    expect(document.documentElement.getAttribute('data-line-rules')).toBe('on');
  });
});

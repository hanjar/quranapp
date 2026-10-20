import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LineRulesService } from './line-rules.service';

describe('LineRulesService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-line-rules');
    TestBed.resetTestingModule();
  });

  it('defaults to off', () => {
    const s = TestBed.inject(LineRulesService);
    expect(s.enabled()).toBe(false);
    expect(document.documentElement.hasAttribute('data-line-rules')).toBe(false);
  });

  it('persists and applies the attribute', () => {
    TestBed.inject(LineRulesService).set(true);
    expect(document.documentElement.getAttribute('data-line-rules')).toBe('on');
    expect(localStorage.getItem('mf-line-rules')).toBe('on');
    TestBed.resetTestingModule();
    expect(TestBed.inject(LineRulesService).enabled()).toBe(true);
  });
});

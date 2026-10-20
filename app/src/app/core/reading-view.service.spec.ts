import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FONT_SCALES, ReadingViewService, snapScale } from './reading-view.service';

describe('snapScale', () => {
  it('snaps to the nearest allowed step and falls back to 1', () => {
    expect(snapScale('1.5')).toBe(1.45);
    expect(snapScale('abc')).toBe(1);
    expect(snapScale(null)).toBe(1);
    expect(snapScale(9)).toBe(FONT_SCALES[FONT_SCALES.length - 1]);
  });
});

describe('ReadingViewService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('defaults to mushaf, no latin, scale 1', () => {
    const s = TestBed.inject(ReadingViewService);
    expect(s.mode()).toBe('mushaf');
    expect(s.showLatin()).toBe(false);
    expect(s.fontScale()).toBe(1);
  });

  it('persists and restores per device', () => {
    const a = TestBed.inject(ReadingViewService);
    a.toggleMode();
    a.setShowLatin(true);
    a.larger();
    expect(localStorage.getItem('mf-view-mode')).toBe('translation');
    expect(localStorage.getItem('mf-tr-latin')).toBe('1');
    expect(localStorage.getItem('mf-tr-size')).toBe('1.15');
    TestBed.resetTestingModule();
    const b = TestBed.inject(ReadingViewService);
    expect(b.mode()).toBe('translation');
    expect(b.showLatin()).toBe(true);
    expect(b.fontScale()).toBe(1.15);
  });

  it('clamps font scale at both ends', () => {
    const s = TestBed.inject(ReadingViewService);
    for (let i = 0; i < 10; i++) s.larger();
    expect(s.canLarger()).toBe(false);
    for (let i = 0; i < 10; i++) s.smaller();
    expect(s.canSmaller()).toBe(false);
    expect(s.fontScale()).toBe(0.9);
  });
});

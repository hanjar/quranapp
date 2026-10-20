import { describe, expect, it } from 'vitest';
import { modeLabel, modeShortLabel, nextMode, nowPlayingTitle } from './audio-labels';

describe('audio labels', () => {
  it('labels modes', () => {
    expect(modeLabel('ayah')).toBe('Satu ayat');
    expect(modeLabel('page')).toBe('Sampai akhir halaman');
    expect(modeLabel('surah')).toBe('Sampai akhir surah');
  });
  it('cycles modes', () => {
    expect(nextMode('ayah')).toBe('page');
    expect(nextMode('page')).toBe('surah');
    expect(nextMode('surah')).toBe('ayah');
  });
  it('titles', () => {
    expect(nowPlayingTitle('Al-Baqarah', 5, false)).toBe('Al-Baqarah · Ayat 5');
    expect(nowPlayingTitle('Al-Baqarah', 1, true)).toBe('Basmalah · sebelum Al-Baqarah 1');
  });
});

describe('modeShortLabel', () => {
  it('gives compact chip labels', () => {
    expect(modeShortLabel('surah')).toBe('Surah');
    expect(modeShortLabel('page')).toBe('Halaman');
    expect(modeShortLabel('ayah')).toBe('1 ayat');
  });
});

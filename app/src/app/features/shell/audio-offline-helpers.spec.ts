import { describe, expect, it } from 'vitest';
import {
  bytesProgress,
  downloadButtonState,
  changeQualityWarning,
  offlineAudioSummary,
  rowState,
  surahMatches,
  surahsFullyStored,
  totalStored,
  variantLabel,
} from './audio-offline-helpers';

describe('audio offline helpers', () => {
  it('labels variants', () => {
    expect(variantLabel('opus24')).toBe('Hemat');
    expect(variantLabel('opus32')).toBe('Standar');
    expect(variantLabel('mp364')).toBe('Kompatibel');
  });
  it('rowState', () => {
    expect(rowState(0, 10)).toEqual({ kind: 'none' });
    expect(rowState(10, 10)).toEqual({ kind: 'done' });
    expect(rowState(5, 10)).toEqual({ kind: 'partial', percent: 50 });
    expect(rowState(999, 1000)).toEqual({ kind: 'partial', percent: 99 });
    expect(rowState(0, 0)).toEqual({ kind: 'none' });
  });
  it('counts stored surahs', () => {
    expect(surahsFullyStored([7, 3, 0], [7, 286, 200])).toBe(1);
    expect(surahsFullyStored([], [7])).toBe(0);
    expect(totalStored([7, 3, 0])).toBe(10);
  });
  it('searches surahs', () => {
    const s = { number: 2, nameLatin: 'Al-Baqarah' };
    expect(surahMatches(s, '')).toBe(true);
    expect(surahMatches(s, 'baqar')).toBe(true);
    expect(surahMatches(s, 'al baq')).toBe(true);
    expect(surahMatches(s, '2')).toBe(true);
    expect(surahMatches(s, 'yasin')).toBe(false);
  });
  it('downloadButtonState', () => {
    expect(downloadButtonState(7, 7, false).kind).toBe('done');
    expect(downloadButtonState(7, 7, true).kind).toBe('done');
    expect(downloadButtonState(2, 10, true)).toMatchObject({ kind: 'busy', fraction: 0.2 });
    expect(downloadButtonState(2, 10, false).kind).toBe('idle');
    expect(downloadButtonState(0, 0, false).kind).toBe('idle');
  });
  it('summary + copy', () => {
    expect(offlineAudioSummary('opus24', 3, 100)).toBe('Hemat · 3 surah tersimpan');
    expect(offlineAudioSummary('opus24', 0, 5)).toBe('Hemat · sebagian tersimpan');
    expect(offlineAudioSummary('opus24', 0, 0)).toBe('Belum ada yang tersimpan');
    expect(changeQualityWarning(5 * 1024 * 1024)).toBe(
      'Audio tersimpan (5,0 MB) akan dihapus dan perlu diunduh ulang.',
    );
    expect(bytesProgress(1024 * 1024, 2 * 1024 * 1024)).toBe('1,0 MB dari 2,0 MB');
  });
});

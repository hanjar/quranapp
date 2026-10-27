import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QARI,
  QARIS,
  globalAyahNumber,
  needsBasmalah,
  nextAyah,
  prevAyah,
  qariById,
  shouldContinue,
} from './audio-logic';

// Real Hafs counts for the surahs these tests touch; the rest only need to sum correctly.
const counts = Array.from({ length: 114 }, () => 10);
counts[0] = 7;
counts[1] = 286;
counts[8] = 129;
counts[113] = 6;

describe('globalAyahNumber', () => {
  it('numbers ayahs across surahs', () => {
    expect(globalAyahNumber({ surah: 1, ayah: 1 }, counts)).toBe(1);
    expect(globalAyahNumber({ surah: 1, ayah: 7 }, counts)).toBe(7);
    expect(globalAyahNumber({ surah: 2, ayah: 1 }, counts)).toBe(8);
    expect(globalAyahNumber({ surah: 2, ayah: 255 }, counts)).toBe(262);
  });
});

describe('nextAyah / prevAyah', () => {
  it('crosses surah boundaries and stops at the ends', () => {
    expect(nextAyah({ surah: 1, ayah: 7 }, counts)).toEqual({ surah: 2, ayah: 1 });
    expect(nextAyah({ surah: 114, ayah: 6 }, counts)).toBeNull();
    expect(prevAyah({ surah: 2, ayah: 1 }, counts)).toEqual({ surah: 1, ayah: 7 });
    expect(prevAyah({ surah: 1, ayah: 1 }, counts)).toBeNull();
  });
});

describe('shouldContinue', () => {
  const pageOf = (r: { surah: number; ayah: number }) => (r.ayah <= 5 ? 10 : 11);
  const start = { ref: { surah: 2, ayah: 1 }, page: 10 };
  it('ayah mode never continues', () => {
    expect(shouldContinue('ayah', start, { surah: 2, ayah: 2 }, pageOf)).toBe(false);
  });
  it('surah mode continues within the surah only', () => {
    expect(shouldContinue('surah', start, { surah: 2, ayah: 200 }, pageOf)).toBe(true);
    expect(shouldContinue('surah', start, { surah: 3, ayah: 1 }, pageOf)).toBe(false);
  });
  it('page mode continues while the next ayah is on the start page', () => {
    expect(shouldContinue('page', start, { surah: 2, ayah: 5 }, pageOf)).toBe(true);
    expect(shouldContinue('page', start, { surah: 2, ayah: 6 }, pageOf)).toBe(false);
  });
  it('stops at the end of the mushaf', () => {
    expect(shouldContinue('surah', start, null, pageOf)).toBe(false);
  });
});

describe('needsBasmalah', () => {
  it('precedes ayah 1 except in Al-Fatihah and At-Taubah', () => {
    expect(needsBasmalah({ surah: 2, ayah: 1 })).toBe(true);
    expect(needsBasmalah({ surah: 1, ayah: 1 })).toBe(false);
    expect(needsBasmalah({ surah: 9, ayah: 1 })).toBe(false);
    expect(needsBasmalah({ surah: 2, ayah: 2 })).toBe(false);
  });
});

describe('qari urls', () => {
  const alafasy = QARIS[0];
  const ghamdi = qariById('ghamdi');

  it('builds Alafasy primary and fallback urls', () => {
    expect(alafasy.primary(4914, { surah: 55, ayah: 13 })).toBe(
      'https://cdn.islamic.network/quran/audio/128/ar.alafasy/4914.mp3',
    );
    expect(alafasy.fallback({ surah: 55, ayah: 13 })).toBe(
      'https://cdn.equran.id/audio-partial/Misyari-Rasyid-Al-Afasi/055013.mp3',
    );
  });

  it('builds Al-Ghamdi primary and fallback urls per ayah', () => {
    expect(ghamdi.primary(262, { surah: 2, ayah: 255 })).toBe(
      'https://everyayah.com/data/Ghamadi_40kbps/002255.mp3',
    );
    expect(ghamdi.fallback({ surah: 2, ayah: 255 })).toBe(
      'https://mirrors.quranicaudio.com/everyayah/Ghamadi_40kbps/002255.mp3',
    );
  });

  it('builds the Al-Ghamdi own R2 opus copy url per ayah', () => {
    expect(ghamdi.own?.({ surah: 2, ayah: 255 })).toBe(
      'https://audio.hanjar.net/ghamdi/opus32/002255.webm',
    );
  });

  it('gives Alafasy no own url (it uses the existing R2 copy path)', () => {
    expect(alafasy.own).toBeUndefined();
  });

  it('gives the default qari for unknown or missing ids', () => {
    expect(qariById(null).id).toBe('alafasy');
    expect(qariById('nope').id).toBe('alafasy');
    expect(qariById('ghamdi').offline).toBe(false);
    expect(DEFAULT_QARI.offline).toBe(true);
  });
});

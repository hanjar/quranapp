import { AudioMode, AyahRef } from '../models';

export type { AudioMode };

/** One qari for now (owner's choice, D19). Recordings are per ayah, so verse timing is exact. */
export const QARI = {
  id: 'alafasy',
  name: 'Mishary Rasyid Alafasy',
  /** Al Quran Cloud CDN (Islamic Network): global ayah number 1..6236. */
  primary: (globalAyah: number) =>
    `https://cdn.islamic.network/quran/audio/128/ar.alafasy/${globalAyah}.mp3`,
  /** EQuran.id CDN — byte-identical recordings, used when the primary fails. */
  fallback: (ref: AyahRef) =>
    `https://cdn.equran.id/audio-partial/Misyari-Rasyid-Al-Afasi/${pad3(ref.surah)}${pad3(ref.ayah)}.mp3`,
  attribution: 'Mishary Rasyid Alafasy · audio via Al Quran Cloud (Islamic Network)',
} as const;

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Global ayah number (1..6236) from per-surah ayah counts (index 0 = surah 1). */
export function globalAyahNumber(ref: AyahRef, ayahCounts: readonly number[]): number {
  let n = 0;
  for (let s = 1; s < ref.surah; s++) n += ayahCounts[s - 1];
  return n + ref.ayah;
}

/** Next ayah in mushaf order, or null after 114:6. */
export function nextAyah(ref: AyahRef, ayahCounts: readonly number[]): AyahRef | null {
  if (ref.ayah < ayahCounts[ref.surah - 1]) return { surah: ref.surah, ayah: ref.ayah + 1 };
  if (ref.surah < 114) return { surah: ref.surah + 1, ayah: 1 };
  return null;
}

/** Previous ayah in mushaf order, or null before 1:1. */
export function prevAyah(ref: AyahRef, ayahCounts: readonly number[]): AyahRef | null {
  if (ref.ayah > 1) return { surah: ref.surah, ayah: ref.ayah - 1 };
  if (ref.surah > 1) return { surah: ref.surah - 1, ayah: ayahCounts[ref.surah - 2] };
  return null;
}

/**
 * Should playback continue from `current` to `next`, given where it started?
 * - ayah: never; surah: while in the same surah; page: while `next` is on the start page.
 */
export function shouldContinue(
  mode: AudioMode,
  start: { ref: AyahRef; page: number },
  next: AyahRef | null,
  pageOf: (ref: AyahRef) => number | null,
): boolean {
  if (!next || mode === 'ayah') return false;
  if (mode === 'surah') return next.surah === start.ref.surah;
  return pageOf(next) === start.page;
}

/**
 * Basmalah is recited before ayah 1 of every surah except Al-Fatihah (where it
 * IS ayah 1) and At-Taubah (which has none). The 1:1 recording is reused.
 */
export function needsBasmalah(ref: AyahRef): boolean {
  return ref.ayah === 1 && ref.surah !== 1 && ref.surah !== 9;
}

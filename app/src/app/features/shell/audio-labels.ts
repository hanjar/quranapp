import type { AudioMode } from '../../core/audio/audio-logic';

export const AUDIO_MODES: { id: AudioMode; label: string; short: string }[] = [
  { id: 'ayah', label: 'Satu ayat', short: '1 ayat' },
  { id: 'page', label: 'Sampai akhir halaman', short: 'Halaman' },
  { id: 'surah', label: 'Sampai akhir surah', short: 'Surah' },
];

/** Compact label for the mini player chip ("Surah", "Halaman", "1 ayat"). */
export function modeShortLabel(mode: AudioMode): string {
  return AUDIO_MODES.find((m) => m.id === mode)?.short ?? '';
}

export function modeLabel(mode: AudioMode): string {
  return AUDIO_MODES.find((m) => m.id === mode)?.label ?? '';
}

/** Cycles Satu ayat -> halaman -> surah -> Satu ayat. */
export function nextMode(mode: AudioMode): AudioMode {
  const i = AUDIO_MODES.findIndex((m) => m.id === mode);
  return AUDIO_MODES[(i + 1) % AUDIO_MODES.length].id;
}

/** "Al-Baqarah · Ayat 5" or "Basmalah · sebelum Al-Baqarah 5". */
export function nowPlayingTitle(surahName: string, ayah: number, basmalah: boolean): string {
  return basmalah ? `Basmalah · sebelum ${surahName} ${ayah}` : `${surahName} · Ayat ${ayah}`;
}

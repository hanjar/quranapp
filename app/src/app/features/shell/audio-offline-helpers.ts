import type { AudioVariant } from '../../core/audio/audio-offline.api';
import { formatMb } from './format';

export const VARIANT_INFO: Record<AudioVariant, { label: string; format: string }> = {
  opus24: { label: 'Hemat', format: 'Opus 24 kbps' },
  opus32: { label: 'Standar', format: 'Opus 32 kbps' },
  mp364: { label: 'Kompatibel', format: 'MP3 64 kbps' },
};

export function variantLabel(v: AudioVariant): string {
  return VARIANT_INFO[v].label;
}

export type RowState = { kind: 'none' } | { kind: 'partial'; percent: number } | { kind: 'done' };

/** State chip of a juz/surah row from stored/total ayah counts. */
export function rowState(done: number, total: number): RowState {
  if (total > 0 && done >= total) return { kind: 'done' };
  if (done <= 0 || total <= 0) return { kind: 'none' };
  return { kind: 'partial', percent: Math.min(99, Math.max(1, Math.floor((done / total) * 100))) };
}

/** Number of surahs whose every ayah is stored (perSurah index 0 = surah 1). */
export function surahsFullyStored(
  perSurah: readonly number[],
  ayahCounts: readonly number[],
): number {
  let n = 0;
  for (let i = 0; i < ayahCounts.length; i++) {
    if (ayahCounts[i] > 0 && (perSurah[i] ?? 0) >= ayahCounts[i]) n++;
  }
  return n;
}

export interface DownloadButtonState {
  kind: 'idle' | 'busy' | 'done';
  fraction: number;
  label: string;
}

/** Mini-player "save this surah" control: download icon, ring while downloading, check when stored. */
export function downloadButtonState(
  done: number,
  total: number,
  active: boolean,
): DownloadButtonState {
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  if (total > 0 && done >= total) {
    return { kind: 'done', fraction: 1, label: 'Surah ini sudah tersimpan untuk offline' };
  }
  if (active) {
    return { kind: 'busy', fraction, label: `Mengunduh surah ini, ${Math.floor(fraction * 100)}%` };
  }
  return { kind: 'idle', fraction, label: 'Simpan surah ini untuk offline' };
}

export function totalStored(perSurah: readonly number[]): number {
  return perSurah.reduce((a, b) => a + b, 0);
}

/** Case/diacritic-insensitive match on number or latin name ("baqarah", "al baqarah", "2"). */
export function surahMatches(s: { number: number; nameLatin: string }, query: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const q = norm(query);
  if (!q) return true;
  return norm(s.nameLatin).includes(q) || String(s.number) === query.trim();
}

/** Settings row status, e.g. "Hemat · 3 surah tersimpan" or "Belum ada yang tersimpan". */
export function offlineAudioSummary(
  variant: AudioVariant,
  storedSurahs: number,
  storedAyahs: number,
): string {
  if (storedAyahs <= 0) return 'Belum ada yang tersimpan';
  return storedSurahs > 0
    ? `${variantLabel(variant)} · ${storedSurahs} surah tersimpan`
    : `${variantLabel(variant)} · sebagian tersimpan`;
}

export function changeQualityWarning(usedBytes: number): string {
  return `Audio tersimpan (${formatMb(usedBytes)}) akan dihapus dan perlu diunduh ulang.`;
}

/** "42%" style text for bytes progress. */
export function bytesProgress(done: number, total: number): string {
  return `${formatMb(done)} dari ${formatMb(total)}`;
}

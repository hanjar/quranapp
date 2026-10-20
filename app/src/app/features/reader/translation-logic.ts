import { PageMeta } from '../../core/models';

export interface PageAyah {
  surah: number;
  ayah: number;
  /** First ayah of its surah: render the surah heading before it. */
  startsSurah: boolean;
  /** Show a Bismillah line before the heading's first ayah (all surahs except 1 and 9). */
  bismillah: boolean;
}

/** Every ayah on a page in reading order, across surah boundaries. */
export function pageAyahs(meta: PageMeta, ayahCount: (surah: number) => number): PageAyah[] {
  const out: PageAyah[] = [];
  for (const s of meta.surahs) {
    const from = s === meta.first.surah ? meta.first.ayah : 1;
    const to = s === meta.last.surah ? meta.last.ayah : ayahCount(s);
    for (let a = from; a <= to; a++) {
      const starts = a === 1;
      out.push({ surah: s, ayah: a, startsSurah: starts, bismillah: starts && s !== 1 && s !== 9 });
    }
  }
  return out;
}

/** True when the user prefers no motion (OS setting or in-app override). */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  const m = document.documentElement.dataset['motion'];
  if (m === 'reduce') return true;
  if (m === 'no-preference') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

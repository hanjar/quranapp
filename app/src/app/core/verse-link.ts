import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { ContentApi } from './contracts';
import { AyahRef } from './models';
import { ReaderUiService } from './reader-ui.service';

export interface VerseLinkTarget {
  page: number;
  /** The ayah to select/highlight on arrival; null for a bare surah link. */
  highlight: AyahRef | null;
}

/** Strict positive-integer parse: "3" -> 3; "", "0", "3a", "-1", "1e2" -> null. */
export function parseLinkNumber(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/**
 * `/{surah}/{ayah}` -> the page that contains the ayah (+ highlight);
 * `/{surah}` -> the first page of the surah. null when the numbers are not valid.
 * Lookups need the content index to be loaded.
 */
export function resolveVerseLink(
  content: Pick<ContentApi, 'pageOf' | 'surah'>,
  surahRaw: string | null | undefined,
  ayahRaw?: string | null,
): VerseLinkTarget | null {
  const surah = parseLinkNumber(surahRaw);
  if (surah === null || surah > 114) return null;
  if (ayahRaw === undefined || ayahRaw === null) {
    return { page: content.surah(surah).startPage, highlight: null };
  }
  const ayah = parseLinkNumber(ayahRaw);
  if (ayah === null) return null;
  const page = content.pageOf({ surah, ayah });
  return page === null ? null : { page, highlight: { surah, ayah } };
}

/**
 * Route guard for `/:surah/:ayah` and `/:surah` (shared links). Waits for the content
 * index, then replaces the URL with `/hal/{page}` and selects the ayah so it is
 * highlighted exactly as after a search. Invalid numbers fall back to the resume route.
 */
export const verseLinkRedirect: CanActivateFn = async (route) => {
  const content = inject(ContentApi);
  const ui = inject(ReaderUiService);
  const router = inject(Router);
  await content.load();
  if (!content.index()) return new RedirectCommand(router.parseUrl('/'), { replaceUrl: true });
  const target = resolveVerseLink(content, route.paramMap.get('surah'), route.paramMap.get('ayah'));
  if (!target) return new RedirectCommand(router.parseUrl('/'), { replaceUrl: true });
  ui.zoom.set(1);
  ui.selectedVerse.set(target.highlight ? { ...target.highlight, page: target.page } : null);
  return new RedirectCommand(router.parseUrl(`/hal/${target.page}`), { replaceUrl: true });
};

/** Pure layout helpers for the shareable verse image. No DOM. */

import type { QcfLayout } from '../reader/qcf-logic';

export type CardFormat = 'post' | 'story';

/** Pixel size of each format (Instagram / WhatsApp friendly). */
export const CARD_SIZE: Record<CardFormat, { w: number; h: number }> = {
  post: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

export interface GlyphWord {
  /** Glyph string in the page's QCF font. */
  code: string;
  /** Font family of the page the word sits on. */
  family: string;
  /** True for the ayah-number ornament. */
  end?: boolean;
}

/**
 * The words of `key` ("2:255") on one QCF page, in reading order, and whether the ayah ends on
 * this page (its number ornament is here).
 */
export function wordsOnPage(
  layout: QcfLayout,
  family: string,
  key: string,
): { words: GlyphWord[]; ended: boolean } {
  const words: GlyphWord[] = [];
  let ended = false;
  for (const line of layout.lines) {
    for (const w of line.words ?? []) {
      if (w.verse !== key) continue;
      words.push({ code: w.code, family, ...(w.type === 'end' ? { end: true } : {}) });
      if (w.type === 'end') ended = true;
    }
  }
  return { words, ended };
}

/**
 * Greedy line breaking: items (widths, in reading order) into lines no wider than `max`, with
 * `gap` between items. Returns index ranges [start, end).
 */
export function wrap(widths: readonly number[], max: number, gap: number): [number, number][] {
  const lines: [number, number][] = [];
  let start = 0;
  let w = 0;
  for (let i = 0; i < widths.length; i++) {
    const add = (i > start ? gap : 0) + widths[i]!;
    if (i > start && w + add > max) {
      lines.push([start, i]);
      start = i;
      w = widths[i]!;
    } else w += add;
  }
  if (start < widths.length) lines.push([start, widths.length]);
  return lines;
}

/** Splits text into words for measuring (keeps punctuation attached). */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** File name for the shared image, e.g. "QS-2-255.png". */
export function cardFileName(surah: number, ayah: number): string {
  return `QS-${surah}-${ayah}.png`;
}

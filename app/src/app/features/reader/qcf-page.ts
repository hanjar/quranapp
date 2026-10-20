import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ContentApi } from '../../core/contracts';
import { QcfPageData } from '../../core/content/qcf.service';
import { QcfLine, gridRows, isCenteredLine, isQcfCover } from './qcf-logic';
import { cartouchePath } from './surah-header';

interface WordView {
  code: string;
  surah: number;
  ayah: number;
  key: string;
}
interface LineView {
  n: number;
  type: QcfLine['type'];
  surah: number;
  bism: boolean;
  centered: boolean;
  words: WordView[];
}

/** Cartouche geometry in a 94 x 10 box (a header line is ~9.4 times wider than tall). */
const BOX_W = 94;
const BOX_H = 10;
const PETALS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * One mushaf page drawn with the QCF V4 per-page font: 15 lines, each justified to the text
 * width. Every word is a hit target (`data-surah` / `data-ayah`) like the verse polygons of the
 * SVG renderer, and carries the same selected / bookmarked / playing / focus states.
 */
@Component({
  selector: 'mf-qcf-page',
  templateUrl: './qcf-page.html',
  styleUrl: './qcf-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-cover]': 'cover()' },
})
export class QcfPage {
  private readonly content = inject(ContentApi);

  readonly data = input.required<QcfPageData>();
  readonly selectedKey = input<string | null>(null);
  readonly playingKey = input<string | null>(null);
  readonly focusKey = input<string | null>(null);
  readonly bookmarked = input<ReadonlySet<string>>(new Set());

  protected readonly petals = PETALS;
  protected readonly cover = computed(() => isQcfCover(this.data().layout.page));
  protected readonly rows = computed(() => gridRows(this.data().layout));
  protected readonly family = computed(() => `"${this.data().family}", serif`);

  protected readonly lines = computed<LineView[]>(() => {
    const { layout, metrics } = this.data();
    const cover = isQcfCover(layout.page);
    return layout.lines.map((l) => ({
      n: l.n,
      type: l.type,
      surah: l.surah ?? 0,
      bism: !!l.bism,
      centered: isCenteredLine(l, metrics, cover),
      words: (l.words ?? []).map((w) => {
        const [surah, ayah] = w.verse.split(':').map(Number);
        return { code: w.code, surah, ayah, key: w.verse };
      }),
    }));
  });

  protected surahName(n: number): string {
    return this.content.index() ? this.content.surah(n).nameArabic : '';
  }

  /** Cartouche outlines; a header that also carries the basmalah uses a shorter frame. */
  protected frame(bism: boolean, inset = 0): string {
    const h = bism ? 6.4 : BOX_H - 1.6;
    return cartouchePath(0.6, bism ? 0.4 : 0.8, BOX_W - 1.2, h, inset * h);
  }

  protected rosetteX(bism: boolean, side: number): number {
    const h = bism ? 6.4 : BOX_H - 1.6;
    const off = Math.min(h * 0.62, (BOX_W - 1.2) / 4) * 0.62 + h * 0.08;
    return side === 1 ? 0.6 + off : BOX_W - 0.6 - off;
  }

  protected rosetteY(bism: boolean): number {
    return bism ? 0.4 + 3.2 : BOX_H / 2;
  }

  protected rosetteR(bism: boolean): number {
    return (bism ? 6.4 : BOX_H - 1.6) * 0.3;
  }
}

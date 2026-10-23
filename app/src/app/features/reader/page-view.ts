import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { BookmarkToggleService } from '../../core/bookmark-toggle.service';
import { ContentApi, OfflineApi, UserDataApi } from '../../core/contracts';
import { AyahRef, PageLoadError, PageLoadErrorKind } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { AudioService } from '../../core/audio/audio.service';
import { QcfPageData, QcfService } from '../../core/content/qcf.service';
import { PageRendererId, PageRendererService } from '../../core/page-renderer.service';
import { QCF_ATTRIBUTION, layoutVerses } from './qcf-logic';
import { QcfPage } from './qcf-page';
import { decorateLineRules } from './line-rules';
import { decorateSurahHeaders } from './surah-header';
import { lastLine, parseRects } from './verse-ribbon';
import { VerseStateContext, isCoverPage, paddedViewBox, verseKey, verseStateFlags } from './reader-logic';

/** How far the verse ribbon reaches past the right page edge, % of the page width. */
const RIBBON_OUT = 5.25;
/** How far it overlaps the text (translucent, it marks the line as read), % of the page width. */
const RIBBON_IN = 3;

export type PageState = 'loading' | 'ready' | 'offline' | 'error';

export interface PageLoadResult {
  page: number;
  ok: boolean;
}

/**
 * Renders one mushaf page: paper, CSS frame, the page SVG (inserted via DOM
 * APIs), page number, loading/error states and an accessible verse list.
 */
@Component({
  selector: 'mf-page-view',
  templateUrl: './page-view.html',
  styleUrl: './page-view.scss',
  imports: [QcfPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-cover]': 'cover()',
    '[attr.data-page]': 'page()',
    '[attr.aria-current]': "active() ? 'page' : null",
    '[class.is-active]': 'active()',
    '[class.is-bare]': 'bare()',
    '[attr.data-preview]': "preview() ? '' : null",
  },
})
export class PageView implements OnDestroy {
  private readonly content = inject(ContentApi);
  private readonly offline = inject(OfflineApi);
  private readonly userData = inject(UserDataApi);
  private readonly ui = inject(ReaderUiService);
  private readonly audio = inject(AudioService);
  private readonly qcf = inject(QcfService);
  private readonly renderers = inject(PageRendererService);
  private readonly marks = inject(BookmarkToggleService);
  /** Page bookmark shown as a ribbon hanging over the top of the page, like a printed mushaf. */
  protected readonly pageMarked = computed(() => !this.preview() && this.marks.isPageBookmarked(this.page()));
  /**
   * Margin tab for the last bookmarked verse on the page (only when the page itself has no
   * ribbon). Percent of the page box; null = none.
   */
  protected readonly sideRibbon = signal<{ top: number; height: number; width: number } | null>(null);

  readonly page = input.required<number>();
  /** True for the active page of a spread pair. */
  readonly active = input(false);
  /** Reader bars are showing: hide the running head and page number and use the frame-only page shape. */
  readonly bare = input(false);
  readonly selected = input<AyahRef | null>(null);
  /** Set of `surah:ayah` keys that are bookmarked. */
  readonly bookmarked = input<ReadonlySet<string>>(new Set());

  /** Forces a renderer (the style preview); null = the reader's setting. */
  readonly renderer = input<PageRendererId | null>(null);
  /** Static preview (style picker): no verse list, no interaction. */
  readonly preview = input(false);

  /** Emitted once per load attempt (success or failure). */
  readonly loadResult = output<PageLoadResult>();

  private readonly art = viewChild.required<ElementRef<HTMLElement>>('art');

  protected readonly state = signal<PageState>('loading');
  protected readonly errorKind = signal<PageLoadErrorKind | null>(null);
  protected readonly verses = signal<AyahRef[]>([]);
  protected readonly lastCachedPage = signal<number | null>(null);
  private readonly svgEl = signal<SVGSVGElement | null>(null);
  protected readonly qcfData = signal<QcfPageData | null>(null);
  protected readonly qcfCredit = QCF_ATTRIBUTION;
  /** Renderer in use: the QCF style falls back to the classic SVG once it failed to load. */
  protected readonly mode = computed<PageRendererId>(() => {
    const m = this.renderer() ?? this.renderers.style();
    return m === 'qcf-tajweed' && this.renderers.failed() ? 'classic' : m;
  });
  protected readonly selectedKey = computed(() => {
    const s = this.selected();
    return s ? verseKey(s.surah, s.ayah) : null;
  });
  protected readonly playingKey = computed(() => {
    const p = this.audio.highlight();
    return p ? verseKey(p.surah, p.ayah) : null;
  });
  protected readonly focusKey = signal<string | null>(null);
  private readonly retryTick = signal(0);
  private token = 0;

  protected readonly cover = computed(() => isCoverPage(this.page()));

  protected readonly label = computed(() => {
    const p = this.page();
    const idx = this.content.index();
    if (!idx) return `Halaman ${p}`;
    const names = this.content
      .pageMeta(p)
      .surahs.map((n) => this.content.surah(n).nameLatin)
      .join(' dan ');
    return names ? `Halaman ${p}, ${names}` : `Halaman ${p}`;
  });

  /** Running head like a printed mushaf: surah(s) on the page and the juz. */
  protected readonly header = computed(() => {
    const p = this.page();
    if (!this.content.index()) return null;
    const meta = this.content.pageMeta(p);
    const surahs = meta.surahs
      .map((n) => `${n} · ${this.content.surah(n).nameLatin}`)
      .join(' – ');
    return { surahs, juz: `Juz ${meta.juz}` };
  });

  constructor() {
    effect(() => {
      const svg = this.svgEl();
      const bm = this.bookmarked();
      const show = !this.pageMarked() && !this.preview();
      untracked(() => this.layoutSideRibbons(svg, show ? bm : new Set()));
    });
    effect((onCleanup) => {
      const svg = this.svgEl();
      const page = this.art().nativeElement.parentElement;
      if (!svg || !page || typeof ResizeObserver === 'undefined') return;
      // The page box can change shape (rotation, bars): re-measure the tabs.
      const ro = new ResizeObserver(() =>
        this.layoutSideRibbons(svg, this.pageMarked() || this.preview() ? new Set() : this.bookmarked()),
      );
      ro.observe(page);
      onCleanup(() => ro.disconnect());
    });
    effect(() => {
      const p = this.page();
      this.retryTick();
      this.mode();
      untracked(() => void this.load(p));
    });
    effect(() => {
      const svg = this.svgEl();
      const sel = this.selected();
      const bm = this.bookmarked();
      const focus = this.focusKey();
      const playing = this.audio.highlight();
      if (!svg) return;
      applyVerseStates(svg, {
        selectedKey: sel ? verseKey(sel.surah, sel.ayah) : null,
        bookmarked: bm,
        focusKey: focus,
        playingKey: playing ? verseKey(playing.surah, playing.ayah) : null,
      });
    });
  }

  /** Places the tab level with the line where the last bookmarked ayah on the page ends. */
  private layoutSideRibbons(svg: SVGSVGElement | null, keys: ReadonlySet<string>): void {
    const page = this.art().nativeElement.parentElement;
    if (!svg || !page || !keys.size) {
      if (this.sideRibbon()) this.sideRibbon.set(null);
      return;
    }
    const box = page.getBoundingClientRect();
    const ctm = svg.getScreenCTM?.();
    if (!ctm || box.height <= 0) return;
    // Polygons come in reading order, so the last match is the furthest bookmark.
    let last: ReturnType<typeof lastLine> = null;
    // Right edge of the text block: a short ayah may start mid-line, so not its own edge.
    let blockRight = -Infinity;
    let minLine = Infinity;
    for (const el of svg.querySelectorAll<SVGPathElement>('.ayahPolygon')) {
      const rects = parseRects(el.getAttribute('d') ?? '');
      for (const r of rects) {
        blockRight = Math.max(blockRight, r.x2);
        if (r.y2 - r.y1 > 10) minLine = Math.min(minLine, r.y2 - r.y1);
      }
      const k = verseKey(Number(el.getAttribute('surah')), Number(el.getAttribute('ayah')));
      if (keys.has(k)) last = lastLine(rects) ?? last;
    }
    if (!last) {
      this.sideRibbon.set(null);
      return;
    }
    const at = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(ctm);
    // A rectangle can cover several full lines: keep only the last one. Lines differ a
    // little in height, so allow 30% over the shortest line (two lines are about 2x).
    const lineH = minLine * 1.3;
    const top = at(blockRight, Math.max(last.y1, last.y2 - lineH));
    const bottom = at(blockRight, last.y2);
    // From a little inside the text block (RIBBON_IN) out past the page edge (RIBBON_OUT).
    const inner = ((box.right - top.x) / box.width) * 100;
    this.sideRibbon.set({
      top: ((top.y - box.top) / box.height) * 100,
      height: ((bottom.y - top.y) / box.height) * 100,
      width: Math.max(inner, 0) + RIBBON_IN + RIBBON_OUT,
    });
  }

  ngOnDestroy(): void {
    this.token++;
  }

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  protected pick(v: AyahRef): void {
    this.ui.selectVerse({ surah: v.surah, ayah: v.ayah, page: this.page() });
  }

  protected setFocus(v: AyahRef | null): void {
    this.focusKey.set(v ? verseKey(v.surah, v.ayah) : null);
  }

  protected key(v: AyahRef): string {
    return verseKey(v.surah, v.ayah);
  }

  protected openLastCached(): void {
    const p = this.lastCachedPage();
    if (p) this.ui.goToPage(p);
  }

  protected openOfflineStatus(): void {
    this.ui.openSheet('offline');
  }

  protected isOnline(): boolean {
    return this.offline.status().online;
  }

  private async load(page: number): Promise<void> {
    const token = ++this.token;
    const host = this.art().nativeElement;
    this.state.set('loading');
    this.errorKind.set(null);
    this.svgEl.set(null);
    this.qcfData.set(null);
    this.verses.set([]);
    host.replaceChildren();
    if (this.mode() === 'qcf-tajweed') {
      try {
        const data = await this.qcf.load(page);
        if (token !== this.token) return;
        this.qcfData.set(data);
        this.verses.set(layoutVerses(data.layout));
        this.state.set('ready');
        this.loadResult.emit({ page, ok: true });
        this.qcf.prefetch([page + 1, page - 1]);
      } catch {
        if (token !== this.token) return;
        // The effect re-runs with the classic renderer (mode() flips) and the toast tells the reader once.
        this.renderers.reportFailure();
      }
      return;
    }
    try {
      const svg = await this.content.getPage(page);
      if (token !== this.token) return;
      host.replaceChildren(svg);
      prepareSvg(svg, isCoverPage(page));
      if (!isCoverPage(page)) decorateLineRules(svg, decorateSurahHeaders(svg));
      this.verses.set(collectVerses(svg));
      this.svgEl.set(svg);
      this.state.set('ready');
      this.loadResult.emit({ page, ok: true });
    } catch (e) {
      if (token !== this.token) return;
      const kind = e instanceof PageLoadError ? e.kind : 'network';
      this.errorKind.set(kind);
      this.state.set(kind === 'offline' ? 'offline' : 'error');
      if (kind === 'offline') void this.findLastCached(token, page);
      this.loadResult.emit({ page, ok: false });
    }
  }

  private async findLastCached(token: number, failedPage: number): Promise<void> {
    this.lastCachedPage.set(null);
    const last = this.userData.position()?.page;
    if (!last || last === failedPage) return;
    try {
      if (await this.content.isPageAvailableOffline(last)) {
        if (token === this.token) this.lastCachedPage.set(last);
      }
    } catch {
      /* best effort */
    }
  }
}

/** Fit the svg into its box; pages 1-2 are re-framed to their content. */
export function prepareSvg(svg: SVGSVGElement, cover: boolean): void {
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('mf-page-svg');
  if (!cover) return;
  try {
    const box = svg.getBBox();
    if (box.width > 0 && box.height > 0) {
      const vb = paddedViewBox(box);
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    }
  } catch {
    /* getBBox unavailable (tests) or not rendered: keep the original viewBox */
  }
}

export function collectVerses(svg: SVGSVGElement): AyahRef[] {
  const seen = new Set<string>();
  const out: AyahRef[] = [];
  svg.querySelectorAll('.ayahPolygon').forEach((el) => {
    const surah = Number(el.getAttribute('surah'));
    const ayah = Number(el.getAttribute('ayah'));
    if (!Number.isInteger(surah) || !Number.isInteger(ayah) || surah < 1 || ayah < 1) return;
    const k = verseKey(surah, ayah);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ surah, ayah });
  });
  return out;
}

/** Toggles state classes on verse polygons. Never touches glyph paths. */
export function applyVerseStates(svg: SVGSVGElement, ctx: VerseStateContext): void {
  svg.querySelectorAll('.ayahPolygon').forEach((el) => {
    const k = verseKey(Number(el.getAttribute('surah')), Number(el.getAttribute('ayah')));
    const flags = verseStateFlags(k, ctx);
    for (const [cls, on] of Object.entries(flags)) el.classList.toggle(cls, on);
  });
}

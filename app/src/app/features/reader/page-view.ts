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
import { ContentApi, OfflineApi, UserDataApi } from '../../core/contracts';
import { AyahRef, PageLoadError, PageLoadErrorKind } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { AudioService } from '../../core/audio/audio.service';
import { VerseStateContext, isCoverPage, paddedViewBox, verseKey, verseStateFlags } from './reader-logic';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-cover]': 'cover()',
    '[attr.data-page]': 'page()',
    '[attr.aria-current]': "active() ? 'page' : null",
    '[class.is-active]': 'active()',
  },
})
export class PageView implements OnDestroy {
  private readonly content = inject(ContentApi);
  private readonly offline = inject(OfflineApi);
  private readonly userData = inject(UserDataApi);
  private readonly ui = inject(ReaderUiService);
  private readonly audio = inject(AudioService);

  readonly page = input.required<number>();
  /** True for the active page of a spread pair. */
  readonly active = input(false);
  readonly selected = input<AyahRef | null>(null);
  /** Set of `surah:ayah` keys that are bookmarked. */
  readonly bookmarked = input<ReadonlySet<string>>(new Set());

  /** Emitted once per load attempt (success or failure). */
  readonly loadResult = output<PageLoadResult>();

  private readonly art = viewChild.required<ElementRef<HTMLElement>>('art');

  protected readonly state = signal<PageState>('loading');
  protected readonly errorKind = signal<PageLoadErrorKind | null>(null);
  protected readonly verses = signal<AyahRef[]>([]);
  protected readonly lastCachedPage = signal<number | null>(null);
  private readonly svgEl = signal<SVGSVGElement | null>(null);
  private readonly focusKey = signal<string | null>(null);
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
      const p = this.page();
      this.retryTick();
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
    this.verses.set([]);
    host.replaceChildren();
    try {
      const svg = await this.content.getPage(page);
      if (token !== this.token) return;
      host.replaceChildren(svg);
      prepareSvg(svg, isCoverPage(page));
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

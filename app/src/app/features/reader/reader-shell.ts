import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  viewChild,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { APP_CONFIG } from '../../core/config';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { AyahRef } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { ChromeBottom } from './chrome-bottom';
import { ChromeTop } from './chrome-top';
import { GestureController, GestureIntent, VerseHit } from './gesture-controller';
import { PageLoadResult, PageView } from './page-view';
import {
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  Pan,
  ZOOM_STEP,
  clampPan,
  decideFitWidth,
  decideSpread,
  formatZoom,
  nextTarget,
  parsePageParam,
  prefetchPages,
  prevTarget,
  verseKey,
  visiblePagesFor,
  zoomAt,
} from './reader-logic';

const CHROME_IDLE_MS = 4500;

/**
 * Route component for `/hal/:page`. Owns layout (single/spread), gestures,
 * zoom/pan, keyboard shortcuts and chrome visibility.
 */
@Component({
  selector: 'mf-reader-shell',
  imports: [PageView, ChromeTop, ChromeBottom],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
    '(pointerdown)': 'bumpActivity()',
  },
})
export class ReaderShell {
  protected readonly content = inject(ContentApi);
  protected readonly ui = inject(ReaderUiService);
  private readonly userData = inject(UserDataApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Route param `:page` (bound through withComponentInputBinding). */
  readonly page = input<string | undefined>(undefined);

  // --- layout -------------------------------------------------------------
  private readonly viewport = signal({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  });
  private readonly measured = signal(false);

  protected readonly pageNum = computed(() => parsePageParam(this.page()));
  protected readonly spread = computed(() => {
    const v = this.viewport();
    return decideSpread(this.userData.prefs().layoutMode, v.width, v.height);
  });
  /** Phone landscape: page fills the width and scrolls vertically; zoom is off. */
  protected readonly fitWidth = computed(() => {
    const v = this.viewport();
    return decideFitWidth(this.spread(), v.width, v.height);
  });
  private readonly stageEl = viewChild<ElementRef<HTMLElement>>('stage');
  protected readonly visible = computed(() => visiblePagesFor(this.pageNum() ?? 1, this.spread()), {
    // Switching the active page inside a pair must not look like a page change.
    equal: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
  protected readonly canNext = computed(() => nextTarget(this.visible(), this.spread()) !== null);
  protected readonly canPrev = computed(() => prevTarget(this.visible(), this.spread()) !== null);

  // --- verse states -------------------------------------------------------
  protected readonly selected = computed<AyahRef | null>(() => {
    const s = this.ui.selectedVerse();
    return s ? { surah: s.surah, ayah: s.ayah } : null;
  });
  protected readonly bookmarkedVerses = computed<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const b of this.userData.bookmarks()) {
      if (b.kind === 'verse' && b.surah !== null && b.ayah !== null) {
        set.add(verseKey(b.surah, b.ayah));
      }
    }
    return set;
  });

  // --- chrome -------------------------------------------------------------
  protected readonly chromeShown = computed(
    () => this.ui.chromeVisible() || this.userData.prefs().controlsAlwaysVisible,
  );
  private readonly activity = signal(0);
  private readonly chromeFocus = signal(false);

  // --- zoom / pan ---------------------------------------------------------
  protected readonly pan = signal<Pan>({ x: 0, y: 0 });
  protected readonly animated = signal(true);
  protected readonly zoomed = computed(() => this.ui.zoom() > 1);
  protected readonly zoomLabel = computed(() => formatZoom(this.ui.zoom()));
  protected readonly transform = computed(() => {
    const z = this.ui.zoom();
    if (z <= 1) return 'none';
    const p = this.pan();
    return `translate(${p.x}px, ${p.y}px) scale(${z})`;
  });
  protected readonly canZoomIn = computed(() => !this.fitWidth() && this.ui.zoom() < MAX_ZOOM);
  protected readonly canZoomOut = computed(() => this.ui.zoom() > MIN_ZOOM);

  private pinchBase: { zoom: number; pan: Pan } | null = null;

  private readonly gestures = new GestureController({
    emit: (i) => this.onIntent(i),
    isZoomed: () => this.ui.zoom() > 1,
    isBlocked: () => this.ui.gesturesBlocked(),
  });

  constructor() {
    // Invalid page param -> page 1 (replace history entry).
    effect(() => {
      const raw = this.page();
      if (raw !== undefined && this.pageNum() === null) {
        untracked(() => this.ui.goToPage(1, { replaceUrl: true }));
      }
    });

    // Publish page state to the shared UI service.
    effect(() => {
      const num = this.pageNum();
      if (num === null) return;
      const visible = this.visible();
      untracked(() => {
        // The route page stays the ACTIVE page even when its spread pair is shown.
        this.ui.currentPage.set(num);
        this.ui.visiblePages.set(visible);
      });
    });

    // Reset zoom (and the fit-width scroll position) when the shown pages or layout change.
    effect(() => {
      this.visible();
      this.spread();
      this.fitWidth();
      const stage = this.stageEl()?.nativeElement;
      untracked(() => {
        if (stage) stage.scrollTop = 0;
        this.ui.zoom.set(1);
        this.pan.set({ x: 0, y: 0 });
        this.gestures.dispose();
      });
    });
    effect(() => {
      if (this.ui.zoom() <= 1) untracked(() => this.pan.set({ x: 0, y: 0 }));
    });

    // Prefetch neighbours once metadata is available.
    effect(() => {
      if (!this.content.index()) return;
      const pages = prefetchPages(this.visible(), APP_CONFIG.prefetchRadius);
      untracked(() => this.content.prefetch(pages));
    });

    // Auto-hide chrome after 4.5 s of inactivity.
    effect((onCleanup) => {
      this.activity();
      if (
        !this.ui.chromeVisible() ||
        this.userData.prefs().controlsAlwaysVisible ||
        this.ui.sheetOpen() ||
        this.ui.tourOpen() ||
        this.chromeFocus()
      ) {
        return;
      }
      const id = setTimeout(() => this.ui.chromeVisible.set(false), CHROME_IDLE_MS);
      onCleanup(() => clearTimeout(id));
    });

    afterNextRender(() => {
      const el = this.host.nativeElement;
      const measure = () => {
        const w = el.clientWidth || window.innerWidth;
        const h = el.clientHeight || window.innerHeight;
        this.viewport.set({ width: w, height: h });
        this.measured.set(true);
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        this.destroyRef.onDestroy(() => ro.disconnect());
      }
    });

    this.destroyRef.onDestroy(() => this.gestures.dispose());
  }

  // =========================================================================
  // Page results
  // =========================================================================
  protected onPageResult(r: PageLoadResult): void {
    // Only a successfully rendered primary page updates the saved position.
    if (r.ok && r.page === this.pageNum()) {
      this.userData.savePosition(r.page);
    }
  }

  protected retryIndex(): void {
    void this.content.load();
  }

  // =========================================================================
  // Navigation
  // =========================================================================
  protected goNext(): void {
    const t = nextTarget(this.visible(), this.spread());
    if (t !== null) this.ui.goToPage(t);
  }

  protected goPrev(): void {
    const t = prevTarget(this.visible(), this.spread());
    if (t !== null) this.ui.goToPage(t);
  }

  // =========================================================================
  // Chrome
  // =========================================================================
  protected bumpActivity(): void {
    this.activity.update((n) => n + 1);
  }

  protected toggleChrome(): void {
    this.ui.chromeVisible.update((v) => !v);
  }

  protected onChromeFocusOut(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) this.chromeFocus.set(false);
  }

  protected setChromeFocus(): void {
    this.chromeFocus.set(true);
    this.bumpActivity();
  }

  // =========================================================================
  // Zoom
  // =========================================================================
  private stageSize() {
    const v = this.viewport();
    return { width: v.width, height: v.height };
  }

  private stageOrigin(): { left: number; top: number } {
    const r = this.host.nativeElement.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }

  protected resetZoom(): void {
    this.animated.set(true);
    this.ui.zoom.set(1);
    this.pan.set({ x: 0, y: 0 });
  }

  protected zoomBy(delta: number): void {
    if (this.fitWidth()) return;
    this.animated.set(true);
    const size = this.stageSize();
    const r = zoomAt(
      { zoom: this.ui.zoom(), pan: this.pan() },
      this.ui.zoom() + delta,
      { x: size.width / 2, y: size.height / 2 },
      size,
    );
    this.ui.zoom.set(r.zoom);
    this.pan.set(r.pan);
  }

  /** Bottom-bar zoom button (touch screens): 1x <-> 2x around the centre. */
  protected toggleZoom(): void {
    if (this.ui.zoom() > 1) this.resetZoom();
    else this.zoomBy(DOUBLE_TAP_ZOOM - this.ui.zoom());
  }

  protected zoomIn(): void {
    this.zoomBy(ZOOM_STEP);
  }

  protected zoomOut(): void {
    this.zoomBy(-ZOOM_STEP);
  }

  // =========================================================================
  // Pointer plumbing -> GestureController
  // =========================================================================
  protected onPointerDown(e: PointerEvent): void {
    const target = e.target as Element | null;
    // Buttons inside the page (error states) handle their own clicks.
    if (target?.closest('button, a')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.gestures.pointerDown({
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      button: e.pointerType === 'mouse' ? e.button : 0,
      verse: this.verseAt(target),
    });
  }

  protected onPointerMove(e: PointerEvent): void {
    this.gestures.pointerMove({ id: e.pointerId, x: e.clientX, y: e.clientY });
  }

  protected onPointerUp(e: PointerEvent): void {
    this.gestures.pointerUp({ id: e.pointerId, x: e.clientX, y: e.clientY });
  }

  protected onPointerCancel(e: PointerEvent): void {
    this.gestures.pointerCancel({ id: e.pointerId });
  }

  private verseAt(target: Element | null): VerseHit | null {
    const poly = target?.closest?.('.ayahPolygon');
    if (!poly) return null;
    const surah = Number(poly.getAttribute('surah'));
    const ayah = Number(poly.getAttribute('ayah'));
    const pageEl = poly.closest('mf-page-view');
    const page = Number(pageEl?.getAttribute('data-page'));
    if (!Number.isInteger(surah) || !Number.isInteger(ayah) || !Number.isInteger(page)) return null;
    return { ref: { surah, ayah }, page };
  }

  private onIntent(i: GestureIntent): void {
    this.bumpActivity();
    switch (i.type) {
      case 'tap-verse':
      case 'long-press-verse':
        // A verse on the other page of the pair makes that page active.
        if (i.page !== this.pageNum() && this.visible().includes(i.page)) {
          this.ui.goToPage(i.page, { replaceUrl: true, highlight: i.ref });
        }
        this.ui.selectVerse({ surah: i.ref.surah, ayah: i.ref.ayah, page: i.page });
        break;
      case 'tap-blank':
        if (this.ui.sheet() !== null) this.ui.closeSheet();
        else this.toggleChrome();
        break;
      case 'double-tap': {
        if (this.fitWidth()) break; // already enlarged; zoom would fight the scroll
        this.animated.set(true);
        if (this.ui.zoom() > 1) {
          this.resetZoom();
          break;
        }
        const o = this.stageOrigin();
        const r = zoomAt(
          { zoom: 1, pan: { x: 0, y: 0 } },
          DOUBLE_TAP_ZOOM,
          { x: i.x - o.left, y: i.y - o.top },
          this.stageSize(),
        );
        this.ui.zoom.set(r.zoom);
        this.pan.set(r.pan);
        break;
      }
      case 'swipe':
        if (i.dir === 'next') this.goNext();
        else this.goPrev();
        break;
      case 'pan':
        this.animated.set(false);
        this.pan.update((p) =>
          clampPan({ x: p.x + i.dx, y: p.y + i.dy }, this.ui.zoom(), this.stageSize()),
        );
        break;
      case 'pinch': {
        if (this.fitWidth()) break;
        this.animated.set(false);
        if (i.start || !this.pinchBase) {
          this.pinchBase = { zoom: this.ui.zoom(), pan: this.pan() };
        }
        const o = this.stageOrigin();
        const r = zoomAt(
          this.pinchBase,
          this.pinchBase.zoom * i.scale,
          { x: i.cx - o.left, y: i.cy - o.top },
          this.stageSize(),
        );
        this.ui.zoom.set(r.zoom);
        this.pan.set(r.pan);
        break;
      }
    }
  }

  // =========================================================================
  // Keyboard
  // =========================================================================
  protected onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase();
    const typing =
      tag === 'input' || tag === 'textarea' || tag === 'select' || !!t?.isContentEditable;

    if (e.key === 'Escape') {
      if (typing) return;
      if (this.ui.tourOpen()) this.ui.tourOpen.set(false);
      else if (this.ui.sheet() !== null) this.ui.closeSheet();
      else if (this.ui.zoom() > 1) this.resetZoom();
      else if (this.ui.chromeVisible()) this.ui.chromeVisible.set(false);
      else return;
      e.preventDefault();
      return;
    }
    if (typing || this.ui.gesturesBlocked() || this.ui.sheetOpen()) return;

    switch (e.key) {
      case 'ArrowLeft':
        this.goNext();
        break;
      case 'ArrowRight':
        this.goPrev();
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
      case '_':
        this.zoomOut();
        break;
      default:
        return;
    }
    e.preventDefault();
    this.bumpActivity();
  }
}

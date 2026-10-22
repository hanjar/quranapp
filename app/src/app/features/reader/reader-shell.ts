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
import { PageTurnSoundService } from '../../core/page-turn-sound';
import { APP_CONFIG } from '../../core/config';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { AyahRef } from '../../core/models';
import { ProgressService } from '../../core/progress/progress.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { ReadingViewService } from '../../core/reading-view.service';
import { ChromeBottom } from './chrome-bottom';
import { ChromeTop } from './chrome-top';
import { GestureController, GestureIntent, VerseHit } from './gesture-controller';
import { PageLoadResult, PageView } from './page-view';
import { TranslationPane } from './translation-pane';
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
  imports: [PageView, TranslationPane, ChromeTop, ChromeBottom],
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
  private readonly pageSound = inject(PageTurnSoundService);
  protected readonly rv = inject(ReadingViewService);
  private readonly userData = inject(UserDataApi);
  private readonly tracker = inject(ProgressService).createTracker();
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
  /** Translation reading mode (text) instead of the mushaf image. */
  protected readonly textMode = computed(() => this.rv.mode() === 'translation');
  /** Wide screens in translation mode: mushaf page on one side, its translation on the other. */
  protected readonly textWide = computed(() => {
    const v = this.viewport();
    return (
      this.textMode() && decideSpread(this.userData.prefs().layoutMode, v.width, v.height)
    );
  });
  /** Two mushaf pages side by side (never in translation mode: that is one page + its text). */
  protected readonly spread = computed(() => {
    const v = this.viewport();
    return (
      !this.textMode() && decideSpread(this.userData.prefs().layoutMode, v.width, v.height)
    );
  });
  /** Phone landscape: page fills the width and scrolls vertically; zoom is off. */
  protected readonly fitWidth = computed(() => {
    const v = this.viewport();
    return !this.textMode() && decideFitWidth(this.spread(), v.width, v.height);
  });
  private readonly stageEl = viewChild<ElementRef<HTMLElement>>('stage');
  protected readonly visible = computed(() => visiblePagesFor(this.pageNum() ?? 1, this.spread()), {
    // Switching the active page inside a pair must not look like a page change.
    equal: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
  /** Always enabled: "next" on the last page opens the khatam doa instead of ending. */
  protected readonly canNext = computed(() => true);
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
  /** The menu can always be hidden by the user; the preference only controls auto-hide and the default. */
  protected readonly chromeShown = computed(() => this.ui.chromeVisible());
  /** Persistent menu: lay the page out between the bars instead of under them. */
  protected readonly hasBars = computed(
    () => this.chromeShown() && this.userData.prefs().controlsAlwaysVisible,
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
  protected readonly canZoomIn = computed(() => !this.fitWidth() && !this.textMode() && this.ui.zoom() < MAX_ZOOM);
  protected readonly canZoomOut = computed(() => !this.textMode() && this.ui.zoom() > MIN_ZOOM);

  private pinchBase: { zoom: number; pan: Pan } | null = null;

  private readonly gestures = new GestureController({
    emit: (i) => this.onIntent(i),
    isZoomed: () => this.ui.zoom() > 1,
    isBlocked: () => this.ui.gesturesBlocked(),
  });

  constructor() {
    // Reading progress: the dwell tracker decides which on-screen pages count as read.
    // Re-run on page, spread and mode changes (translation mode shows the same page as text).
    effect(() => {
      const num = this.pageNum();
      if (num === null) return;
      const pages = this.visible();
      this.textMode();
      untracked(() => this.tracker.visible([...pages]));
    });
    this.destroyRef.onDestroy(() => this.tracker.stop());

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
      this.textMode();
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

    // Phone translation mode has no PageView to report a rendered page: save the position here.
    effect(() => {
      const num = this.pageNum();
      if (num === null || !this.textMode() || this.textWide() || !this.content.index()) return;
      untracked(() => this.userData.savePosition(num));
    });

    // Prefetch neighbours once metadata is available.
    effect(() => {
      if (!this.content.index()) return;
      const pages = prefetchPages(this.visible(), APP_CONFIG.prefetchRadius);
      untracked(() => this.content.prefetch(pages));
    });

    // "Selalu tampilkan kontrol" (default on): the menu starts visible, and turning
    // the preference on shows it again.
    effect(() => {
      if (this.userData.prefs().controlsAlwaysVisible) {
        untracked(() => this.ui.chromeVisible.set(true));
      }
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
      this.watchBrowserZoom();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        this.destroyRef.onDestroy(() => ro.disconnect());
      }
    });

    this.destroyRef.onDestroy(() => this.gestures.dispose());
  }

  /**
   * The reader has its own zoom, so a browser pinch zoom (started on a bar or in a sheet)
   * only crops the bars off screen, and the page blocks pinching back out. Undo it on the
   * next touch while no sheet is open.
   */
  private watchBrowserZoom(): void {
    const vv = window.visualViewport;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!vv || !meta) return;
    const base = meta.content;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (vv.scale <= 1.01 || this.ui.sheetOpen()) return;
        meta.content = `${base}, maximum-scale=1`;
        setTimeout(() => (meta.content = base), 300);
      }, 400);
    };
    const ac = new AbortController();
    window.addEventListener('touchend', check, { passive: true, signal: ac.signal });
    vv.addEventListener('resize', check, { signal: ac.signal });
    check();
    this.destroyRef.onDestroy(() => {
      ac.abort();
      clearTimeout(timer);
    });
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
    this.pageSound.play();
    if (t !== null) this.ui.goToPage(t);
    else if (this.userData.prefs().showDoaKhatam) this.ui.openDoaKhatam();
  }

  protected goPrev(): void {
    const t = prevTarget(this.visible(), this.spread());
    if (t === null) return;
    this.pageSound.play();
    this.ui.goToPage(t);
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
    if (this.fitWidth() || this.textMode()) return;
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
    const textAyah = target?.closest?.('.ayah[data-surah]');
    if (textAyah) {
      const surah = Number(textAyah.getAttribute('data-surah'));
      const ayah = Number(textAyah.getAttribute('data-ayah'));
      const page = Number(textAyah.closest('mf-translation-pane')?.getAttribute('data-page'));
      if (!Number.isInteger(surah) || !Number.isInteger(ayah) || !Number.isInteger(page)) return null;
      return { ref: { surah, ayah }, page };
    }
    // QCF (tajweed) renderer: every word span carries its verse.
    const poly = target?.closest?.('.ayahPolygon, .qw[data-surah]');
    if (!poly) return null;
    const surah = Number(poly.getAttribute('surah') ?? poly.getAttribute('data-surah'));
    const ayah = Number(poly.getAttribute('ayah') ?? poly.getAttribute('data-ayah'));
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
        if (this.fitWidth() || this.textMode()) break; // already enlarged / text view; zoom would fight the scroll
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
        if (this.fitWidth() || this.textMode()) break;
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
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase();
    const typing =
      tag === 'input' || tag === 'textarea' || tag === 'select' || !!t?.isContentEditable;

    // Universal search: "/" or Ctrl/Cmd+K (not while typing, not over another sheet).
    const searchKey =
      (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) ||
      ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k');
    if (searchKey && !typing && !this.ui.tourOpen() && this.ui.sheet() === null) {
      e.preventDefault();
      this.ui.openSheet('search');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

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

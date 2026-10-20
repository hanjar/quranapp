import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { PAGE_COUNT } from '../../core/models';
import {
  MUSHAF_STYLES,
  PageRendererId,
  PageRendererService,
} from '../../core/page-renderer.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { PageView } from '../reader/page-view';
import { SheetHistory } from './sheet-history';
import { TajweedLegend } from './tajweed-legend';

/**
 * Full-screen preview of a mushaf style on a real page. Uses a native modal <dialog> (top layer:
 * above every sheet and toast, focus trapped by the browser). Esc and the browser Back button both
 * mean "Batal"; "Pakai tampilan ini" applies the style. Hosted by the settings style section.
 */
@Component({
  selector: 'mf-mushaf-preview',
  imports: [PageView, TajweedLegend],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mushaf-preview.scss',
  templateUrl: './mushaf-preview.html',
})
export class MushafPreview implements OnDestroy {
  private readonly ui = inject(ReaderUiService);
  private readonly renderers = inject(PageRendererService);
  private readonly history = inject(SheetHistory);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  /** Style being previewed; null = closed. */
  protected readonly styleId = signal<PageRendererId | null>(null);
  protected readonly page = signal(1);
  protected readonly legendOpen = signal(false);
  private opener: HTMLElement | null = null;
  private shown = false;

  protected readonly style = computed(
    () => MUSHAF_STYLES.find((s) => s.id === this.styleId()) ?? null,
  );
  protected readonly isCurrent = computed(() => this.styleId() === this.renderers.style());
  protected readonly hasTajweed = computed(() => this.styleId() === 'qcf-tajweed');
  /** The book is right-to-left: the left chevron goes to the NEXT (higher) page, like the reader's bar. */
  protected readonly canNext = computed(() => this.page() < PAGE_COUNT);
  protected readonly canPrev = computed(() => this.page() > 1);

  constructor() {
    effect(() => {
      const dlg = this.dialog()?.nativeElement;
      if (!dlg || this.shown) return;
      this.shown = true;
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
      this.title()?.nativeElement.focus();
    });
  }

  /** Opens the preview for a style, starting at the page being read. */
  open(id: PageRendererId): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.page.set(this.ui.currentPage());
    this.legendOpen.set(false);
    this.shown = false;
    this.styleId.set(id);
    this.history.overlayOpened(() => this.finish(false, false));
  }

  protected cancel(): void {
    this.finish(false, true);
  }

  protected apply(): void {
    this.finish(true, true);
  }

  protected go(delta: number): void {
    this.page.update((p) => Math.max(1, Math.min(PAGE_COUNT, p + delta)));
  }

  /** Keys are handled here so the reader (arrows) and the sheet host (Escape) behind never see them. */
  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const t = e.target as HTMLElement | null;
      if (t?.closest('button, a, input, select, textarea')) {
        // keep native keyboard behaviour on controls but never leak to the reader
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.go(e.key === 'ArrowLeft' ? 1 : -1);
    }
  }

  ngOnDestroy(): void {
    if (this.styleId()) this.history.overlayClosed();
  }

  private finish(apply: boolean, popHistory: boolean): void {
    const id = this.styleId();
    if (!id) return;
    const dlg = this.dialog()?.nativeElement;
    this.styleId.set(null);
    this.shown = false;
    if (dlg?.open && typeof dlg.close === 'function') dlg.close();
    if (popHistory) this.history.overlayClosed();
    if (apply) {
      this.renderers.set(id);
      const label = MUSHAF_STYLES.find((s) => s.id === id)?.shortLabel ?? '';
      this.ui.showToast({ message: `Tampilan mushaf: ${label}` });
    }
    const back = this.opener;
    this.opener = null;
    setTimeout(() => back?.focus(), 0);
  }
}

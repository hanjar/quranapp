import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { SearchContext, SearchResult, parseSearch } from './search-parser';
import { SheetHistory } from './sheet-history';

@Component({
  selector: 'app-search-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      class="mf-input q"
      type="search"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
      (keydown.enter)="openFirst()"
      placeholder="Surah, 2:255, hal 50, juz 30"
      aria-label="Cari surah atau rujukan ayat"
      autocomplete="off"
      enterkeyhint="search"
    />
    <div class="hints">
      @for (h of hints; track h) {
        <button type="button" class="chip" (click)="query.set(h)">{{ h }}</button>
      }
    </div>
    <div class="results" aria-live="polite">
      @for (r of results(); track r.title + r.page) {
        <button type="button" class="res" (click)="open(r)">
          <span class="rt">{{ r.title }}</span>
          <span class="rs">{{ r.sub }}</span>
        </button>
      }
      @if (query().trim() && results().length === 0) {
        <div class="none">Tidak ditemukan. Coba nama surah atau format 2:255.</div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; padding: var(--mf-space-1) var(--mf-space-5) var(--mf-space-6); color: var(--ui-ink); }
    .q { min-height: 48px; border-radius: 24px; font-size: 15.5px; }
    .hints { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { min-height: var(--mf-tap); padding: 0 14px; border-radius: 22px; border: 1px solid var(--ui-line); background: transparent; font-size: 13px; color: var(--ui-ink); }
    .results { display: flex; flex-direction: column; }
    .res { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 56px; padding: 8px 4px; border: none; border-bottom: 1px solid var(--ui-hair); background: transparent; text-align: left; color: var(--ui-ink); }
    .res:hover { background: color-mix(in srgb, var(--ui-ink) 4%, transparent); }
    .rt { font-size: 15px; font-weight: 500; }
    .rs { font-size: 12.5px; color: var(--ui-muted); }
    .none { padding: 20px 4px; font-size: 14px; color: var(--ui-muted); }
  `,
})
export class SearchSheet {
  private readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly history = inject(SheetHistory);

  protected readonly hints = ['Yasin', '2:255', 'hal 50', 'juz 30'];
  protected readonly query = signal('');

  private readonly ctx = computed<SearchContext | null>(() => {
    const index = this.content.index();
    if (!index) return null;
    return {
      surahs: index.surahs,
      juzStartPage: (n) => index.juz[n - 1]?.page ?? null,
      pageOf: (ref) => this.content.pageOf(ref),
      surahAt: (p) => this.content.surahAt(p),
      juzAt: (p) => this.content.juzAt(p).number,
    };
  });

  protected readonly results = computed<SearchResult[]>(() => {
    const ctx = this.ctx();
    return ctx ? parseSearch(this.query(), ctx) : [];
  });

  protected open(r: SearchResult): void {
    this.history.navigateTo(r.page, { highlight: r.highlight ?? null });
  }

  protected openFirst(): void {
    const r = this.results()[0];
    if (r) this.open(r);
  }
}

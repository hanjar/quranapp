import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentApi } from '../../core/contracts';
import { PAGE_COUNT } from '../../core/models';
import { BrowseTab, ReaderUiService } from '../../core/reader-ui.service';
import { filterJuz, filterSurahs, parsePageInput } from './nav-helpers';
import { SheetHistory } from './sheet-history';

@Component({
  selector: 'app-browse-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mf-segmented" role="tablist" aria-label="Jenis daftar isi">
      @for (t of tabs; track t.id) {
        <button type="button" role="tab" [attr.aria-selected]="ui.browseTab() === t.id" (click)="setTab(t.id)">{{ t.label }}</button>
      }
    </div>

    @if (ui.browseTab() !== 'page') {
      <input
        class="mf-input"
        type="search"
        [value]="filter()"
        (input)="filter.set($any($event.target).value)"
        [placeholder]="ui.browseTab() === 'surah' ? 'Cari nama, nomor, atau huruf Arab' : 'Nomor juz'"
        aria-label="Saring"
        autocomplete="off"
      />
    }

    @switch (ui.browseTab()) {
      @case ('surah') {
        <div class="list">
          @for (s of surahRows(); track s.number) {
            <button type="button" class="row" [class.current]="s.number === currentSurah()" [attr.aria-current]="s.number === currentSurah() ? 'true' : null" (click)="open(s.startPage)">
              <span class="num">{{ s.number }}</span>
              <span class="main">
                <span class="name">{{ s.nameLatin }}</span>
                <span class="info">{{ s.ayahCount }} ayat · Hal. {{ s.startPage }} · Juz {{ s.juz }}</span>
              </span>
              <span class="ar" lang="ar" dir="rtl">{{ s.nameArabic }}</span>
            </button>
          } @empty {
            <div class="empty">Tidak ada surah yang cocok.</div>
          }
        </div>
      }
      @case ('juz') {
        <div class="juzgrid">
          @for (j of juzRows(); track j.number) {
            <button type="button" class="juz" [class.current]="j.number === currentJuz()" [attr.aria-current]="j.number === currentJuz() ? 'true' : null" (click)="open(j.page)">
              <span class="jn">Juz {{ j.number }}</span>
              <span class="info">Hal. {{ j.page }} · {{ j.surahName }}</span>
            </button>
          } @empty {
            <div class="empty">Tidak ada juz yang cocok.</div>
          }
        </div>
      }
      @case ('page') {
        <form class="pagetab" (submit)="$event.preventDefault(); goPage()" novalidate>
          <label class="field">
            Nomor halaman (1–{{ pageCount }})
            <input
              class="mf-input big"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [value]="pageInput()"
              (input)="onPageInput($any($event.target).value)"
              [attr.aria-invalid]="pageError() ? 'true' : null"
              aria-describedby="browse-page-info"
            />
          </label>
          <input
            type="range"
            min="1"
            [max]="pageCount"
            dir="rtl"
            [value]="validPage() ?? ui.currentPage()"
            (input)="onPageInput($any($event.target).value)"
            aria-label="Geser nomor halaman"
          />
          <div id="browse-page-info" class="info" [class.err]="pageError()" [attr.role]="pageError() ? 'alert' : null">
            {{ pageError() ? 'Masukkan angka 1–' + pageCount + '.' : pageInfo() }}
          </div>
          <button type="submit" class="mf-btn mf-btn--primary go">Buka halaman {{ validPage() ?? '' }}</button>
        </form>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; padding: var(--mf-space-1) var(--mf-space-5) var(--mf-space-6); color: var(--ui-ink); }
    .list { display: flex; flex-direction: column; }
    .row { display: flex; align-items: center; gap: 14px; min-height: 60px; padding: 6px 8px; border: none; border-bottom: 1px solid var(--ui-hair); background: transparent; text-align: left; color: var(--ui-ink); }
    .row:hover, .row.current { background: color-mix(in srgb, var(--ui-primary) 6%, transparent); }
    .num { width: 28px; font-size: 13px; color: var(--ui-accent-ink); font-weight: 600; text-align: center; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .name { font-size: 15.5px; font-weight: 500; }
    .info { font-size: 12.5px; color: var(--ui-muted); }
    .ar { font-family: 'Amiri', serif; font-size: 20px; }
    .empty { padding: 24px 8px; font-size: 14px; color: var(--ui-muted); text-align: center; }
    .juzgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
    .juz { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 60px; padding: 10px 12px; border-radius: var(--mf-radius-md); border: 1px solid var(--ui-line); background: var(--ui-surface); text-align: left; color: var(--ui-ink); }
    .juz.current { border-color: var(--ui-primary); border-width: 2px; padding: 9px 11px; }
    .jn { font-size: 15px; font-weight: 500; }
    .pagetab { display: flex; flex-direction: column; gap: 16px; padding-top: 4px; }
    .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ui-ink2); }
    .big { min-height: 56px; font-size: 24px; font-family: var(--ui-display); }
    input[type='range'] { width: 100%; min-height: var(--mf-tap); }
    .info.err { color: var(--mf-danger); font-weight: 500; }
    .go { min-height: 50px; }
  `,
})
export class BrowseSheet {
  protected readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly history = inject(SheetHistory);

  protected readonly pageCount = PAGE_COUNT;
  protected readonly tabs: Array<{ id: BrowseTab; label: string }> = [
    { id: 'surah', label: 'Surah' },
    { id: 'juz', label: 'Juz' },
    { id: 'page', label: 'Halaman' },
  ];

  protected readonly filter = signal('');
  protected readonly pageInput = signal(String(this.ui.currentPage()));
  private readonly attempted = signal(false);

  protected readonly surahRows = computed(() => filterSurahs(this.content.index()?.surahs ?? [], this.filter()));

  protected readonly juzRows = computed(() => {
    const index = this.content.index();
    if (!index) return [];
    return filterJuz(index.juz, this.filter()).map((j) => ({
      number: j.number,
      page: j.page,
      surahName: index.surahs[j.start.surah - 1]?.nameLatin ?? '',
    }));
  });

  protected readonly currentSurah = computed(() =>
    this.content.index() ? this.content.surahAt(this.ui.currentPage()).number : 0,
  );
  protected readonly currentJuz = computed(() =>
    this.content.index() ? this.content.juzAt(this.ui.currentPage()).number : 0,
  );

  protected readonly validPage = computed(() => parsePageInput(this.pageInput()));
  protected readonly pageError = computed(
    () => this.validPage() === null && (this.pageInput().trim() !== '' || this.attempted()),
  );
  protected readonly pageInfo = computed(() => {
    const p = this.validPage();
    if (p === null || !this.content.index()) return 'Masukkan angka 1–' + PAGE_COUNT;
    return `${this.content.surahAt(p).nameLatin} · Juz ${this.content.juzAt(p).number}`;
  });

  protected setTab(tab: BrowseTab): void {
    this.ui.browseTab.set(tab);
    this.filter.set('');
  }

  protected onPageInput(raw: string): void {
    this.attempted.set(false);
    this.pageInput.set(raw);
  }

  protected open(page: number): void {
    this.history.closeThen(() => this.ui.goToPage(page));
  }

  protected goPage(): void {
    const p = this.validPage();
    if (p === null) {
      this.attempted.set(true);
      return;
    }
    this.open(p);
  }
}

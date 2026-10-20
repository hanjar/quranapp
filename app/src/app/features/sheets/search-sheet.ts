import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AudioOfflineApi } from '../../core/audio/audio-offline.api';
import { TranslationService } from '../../core/content/translation.service';
import { ContentApi, SyncApi, UserDataApi } from '../../core/contracts';
import { InstallService } from '../../core/install.service';
import { ReaderUiService } from '../../core/reader-ui.service';
import { ReadingViewService } from '../../core/reading-view.service';
import { WakeLockService } from '../../core/wake-lock.service';
import {
  FeatureAction,
  FeatureEntry,
  FeatureEnv,
  popularFeatures,
  searchFeatures,
} from './feature-registry';
import { SearchContext, SearchResult, parseSearch } from './search-parser';
import { SheetHistory } from './sheet-history';
import {
  Segment,
  TranslationIndex,
  canSearchTranslation,
  indexTranslation,
  isReferenceQuery,
  searchBookmarks,
  searchTranslation,
  toBookmarkRows,
} from './universal-search';

interface Item {
  id: string;
  title: string;
  sub: string;
  segments?: Segment[];
  run: () => void;
}

interface Section {
  key: string;
  heading: string;
  items: (Item & { idx: number })[];
}

@Component({
  selector: 'app-search-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      #box
      class="mf-input q"
      type="search"
      role="combobox"
      aria-autocomplete="list"
      aria-controls="sr-list"
      [attr.aria-expanded]="flat().length > 0"
      [attr.aria-activedescendant]="active() >= 0 ? 'sr-opt-' + active() : null"
      [value]="query()"
      (input)="onInput($any($event.target).value)"
      (keydown)="onKeydown($event)"
      placeholder="Cari ayat, penanda, atau fitur…"
      aria-label="Cari ayat, penanda, atau fitur"
      autocomplete="off"
      enterkeyhint="search"
    />
    <div class="hints">
      @for (h of hints; track h) {
        <button type="button" class="chip" (click)="onInput(h)">{{ h }}</button>
      }
    </div>
    <div id="sr-list" class="results" role="listbox" aria-label="Hasil pencarian">
      @for (sec of sections(); track sec.key) {
        <div role="group" [attr.aria-labelledby]="'sr-h-' + sec.key">
          <div class="gh" [id]="'sr-h-' + sec.key">
            {{ sec.heading }} <span class="cnt">{{ sec.items.length }}</span>
          </div>
          @for (it of sec.items; track it.id) {
            <div
              role="option"
              class="res"
              [id]="'sr-opt-' + it.idx"
              [class.on]="it.idx === active()"
              [attr.aria-selected]="it.idx === active()"
              (click)="it.run()"
              (pointermove)="active.set(it.idx)"
            >
              <span class="rt">
                @if (it.segments; as segs) {
                  @for (seg of segs; track $index) {
                    @if (seg.hit) {
                      <mark>{{ seg.text }}</mark>
                    } @else {
                      {{ seg.text }}
                    }
                  }
                } @else {
                  {{ it.title }}
                }
              </span>
              <span class="rs">{{ it.sub }}</span>
            </div>
          }
        </div>
      }
    </div>
    @if (trLoading()) {
      <div class="note" role="status">Memuat terjemahan…</div>
    }
    @if (trUnavailable()) {
      <div class="note" role="status">
        Terjemahan belum bisa dimuat. Sambungkan ke internet sekali untuk mencari di terjemahan.
      </div>
    }
    @if (query().trim() && flat().length === 0 && !trLoading()) {
      <div class="none" role="status">
        Tidak ditemukan. Coba nama surah, format 2:255, atau kata seperti "tema" atau "unduh".
      </div>
    }
    <div class="mf-visually-hidden" aria-live="polite">{{ liveText() }}</div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: var(--mf-space-1) var(--mf-space-5) var(--mf-space-6);
      color: var(--ui-ink);
    }
    .q {
      min-height: 48px;
      border-radius: 24px;
      font-size: 15.5px;
    }
    .hints {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      min-height: var(--mf-tap);
      padding: 0 14px;
      border-radius: 22px;
      border: 1px solid var(--ui-line);
      background: transparent;
      font-size: 13px;
      color: var(--ui-ink);
    }
    .results {
      display: flex;
      flex-direction: column;
    }
    .gh {
      margin: 10px 4px 2px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ui-muted);
    }
    .cnt {
      font-weight: 400;
      margin-left: 4px;
    }
    .res {
      box-sizing: border-box;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-height: 56px;
      padding: 8px 4px;
      border-bottom: 1px solid var(--ui-hair);
      text-align: left;
      color: var(--ui-ink);
      cursor: pointer;
    }
    .res:hover {
      background: color-mix(in srgb, var(--ui-ink) 4%, transparent);
    }
    .res.on {
      background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
      outline: 2px solid var(--ui-primary);
      outline-offset: -2px;
    }
    .rt {
      font-size: 15px;
      font-weight: 500;
    }
    .rs {
      font-size: 12.5px;
      color: var(--ui-muted);
    }
    mark {
      background: color-mix(in srgb, var(--ui-accent) 35%, transparent);
      color: inherit;
      border-radius: 2px;
    }
    .note {
      padding: 8px 4px;
      font-size: 13px;
      color: var(--ui-muted);
    }
    .none {
      padding: 20px 4px;
      font-size: 14px;
      color: var(--ui-muted);
    }
  `,
})
export class SearchSheet {
  private readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly history = inject(SheetHistory);
  private readonly userData = inject(UserDataApi);
  private readonly translation = inject(TranslationService);
  private readonly install = inject(InstallService);
  private readonly audioOffline = inject(AudioOfflineApi);
  private readonly sync = inject(SyncApi);
  private readonly wake = inject(WakeLockService);
  private readonly rv = inject(ReadingViewService);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  protected readonly hints = ['Yasin', '2:255', 'hal 50', 'juz 30'];
  protected readonly query = signal('');
  /** Index of the highlighted option (-1 = none yet). */
  protected readonly active = signal(-1);

  private readonly trIndex = signal<TranslationIndex | null>(null);
  private readonly trState = signal<'idle' | 'loading' | 'failed'>('idle');
  private audioRequested = false;

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

  private readonly env = computed<FeatureEnv>(() => ({
    installable: this.install.state() !== 'installed',
    audioOffline: this.audioOffline.supported().length > 0 && !!this.audioOffline.manifest(),
    sync: this.sync.available,
    wakeLock: this.wake.supported,
  }));

  private readonly refResults = computed<SearchResult[]>(() => {
    const ctx = this.ctx();
    return ctx ? parseSearch(this.query(), ctx) : [];
  });

  private readonly bookmarkRows = computed(() => {
    const index = this.content.index();
    if (!index) return [];
    return toBookmarkRows(this.userData.bookmarks(), this.userData.folders(), {
      surahName: (n) => index.surahs[n - 1]?.nameLatin ?? `Surah ${n}`,
      surahOfPage: (p) => this.content.surahAt(p).nameLatin,
    });
  });

  protected readonly trLoading = computed(
    () => this.trState() === 'loading' && canSearchTranslation(this.query()),
  );
  protected readonly trUnavailable = computed(
    () => this.trState() === 'failed' && canSearchTranslation(this.query()),
  );

  protected readonly sections = computed<Section[]>(() => {
    const q = this.query().trim();
    const groups: { key: string; heading: string; items: Item[] }[] = [];
    if (!q) {
      const pop = popularFeatures(this.env()).map((x) => this.featureItem(x));
      if (pop.length) groups.push({ key: 'popular', heading: 'Fitur populer', items: pop });
    } else {
      const refs = this.refResults().map((r, i) => this.refItem(r, i));
      if (refs.length) {
        groups.push({ key: 'ref', heading: isReferenceQuery(q) ? 'Rujukan' : 'Surah', items: refs });
      }
      const feats = searchFeatures(q, this.env(), 6).map((x) => this.featureItem(x));
      if (feats.length) groups.push({ key: 'feat', heading: 'Fitur', items: feats });
      const bms = searchBookmarks(q, this.bookmarkRows(), 5).map((r) => ({
        id: 'bm:' + r.bookmark.id,
        title: r.title,
        sub: r.sub,
        run: () =>
          this.openBookmark(r.bookmark.page, r.bookmark.kind, r.bookmark.surah, r.bookmark.ayah),
      }));
      if (bms.length) groups.push({ key: 'bm', heading: 'Penanda', items: bms });
      const idx = this.trIndex();
      const ctx = this.ctx();
      if (idx && ctx) {
        const hits = searchTranslation(q, idx, 20).map((h) => ({
          id: `tr:${h.surah}:${h.ayah}`,
          title: '',
          segments: h.segments,
          sub: `${ctx.surahs[h.surah - 1]?.nameLatin ?? 'Surah ' + h.surah} · Ayat ${h.ayah}`,
          run: () => this.openAyah(h.surah, h.ayah),
        }));
        if (hits.length) groups.push({ key: 'tr', heading: 'Terjemahan', items: hits });
      }
    }
    let n = 0;
    return groups.map((g) => ({ ...g, items: g.items.map((it) => ({ ...it, idx: n++ })) }));
  });

  protected readonly flat = computed(() => this.sections().flatMap((s) => s.items));

  protected readonly liveText = computed(() => {
    const n = this.flat().length;
    return this.query().trim() ? (n ? `${n} hasil` : 'Tidak ada hasil') : '';
  });

  constructor() {
    // Lazy-load the translation only when a text query could use it.
    effect(() => {
      if (!canSearchTranslation(this.query())) return;
      untracked(() => this.loadTranslation());
    });
    // Offline audio features need the manifest; fetch it once when the user starts typing.
    effect(() => {
      if (!this.query().trim()) return;
      untracked(() => {
        if (this.audioRequested) return;
        this.audioRequested = true;
        void this.audioOffline.load().catch(() => undefined);
      });
    });
    // Keep the active option in range when results change.
    effect(() => {
      const n = this.flat().length;
      untracked(() => {
        if (this.active() >= n) this.active.set(n - 1);
      });
    });
    // Keyboard users (fine pointer) can type right away; touch keeps the on-screen keyboard closed.
    const t = setTimeout(() => {
      const el = this.box()?.nativeElement;
      const a = document.activeElement;
      const idle = !a || a === document.body || a.tagName === 'H2';
      if (el && idle && window.matchMedia?.('(pointer: fine)').matches) el.focus();
    }, 420);
    inject(DestroyRef).onDestroy(() => clearTimeout(t));
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.active.set(value.trim() ? 0 : -1);
  }

  protected onKeydown(e: KeyboardEvent): void {
    const n = this.flat().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (n === 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const cur = this.active();
      this.active.set(cur < 0 ? (dir === 1 ? 0 : n - 1) : (cur + dir + n) % n);
      setTimeout(() =>
        document.getElementById('sr-opt-' + this.active())?.scrollIntoView({ block: 'nearest' }),
      );
    } else if (e.key === 'Enter') {
      const it = this.flat()[this.active() >= 0 ? this.active() : 0];
      if (it) {
        e.preventDefault();
        it.run();
      }
    }
  }

  private loadTranslation(): void {
    if (this.trIndex() || this.trState() === 'loading') return;
    this.trState.set('loading');
    void this.translation.all().then((f) => {
      if (f) {
        this.trIndex.set(indexTranslation(f.ayahs));
        this.trState.set('idle');
      } else {
        this.trState.set('failed');
      }
    });
  }

  private refItem(r: SearchResult, i: number): Item {
    return {
      id: `ref:${i}:${r.page}:${r.title}`,
      title: r.title,
      sub: r.sub,
      run: () => this.history.navigateTo(r.page, { highlight: r.highlight ?? null }),
    };
  }

  private openAyah(surah: number, ayah: number): void {
    const page = this.content.pageOf({ surah, ayah });
    if (page !== null) this.history.navigateTo(page, { highlight: { surah, ayah } });
  }

  private openBookmark(page: number, kind: string, surah: number | null, ayah: number | null): void {
    const highlight = kind === 'verse' && surah && ayah ? { surah, ayah } : null;
    this.history.navigateTo(page, { highlight });
  }

  private featureItem(x: FeatureEntry): Item {
    return {
      id: 'ft:' + x.id,
      title: x.title,
      sub: `${x.group} · ${x.description}`,
      run: () => this.runAction(x.action),
    };
  }

  private runAction(a: FeatureAction): void {
    switch (a.type) {
      case 'sheet':
        this.ui.focusTarget.set(a.target ?? null);
        this.ui.openSheet(a.sheet, a.browseTab ? { browseTab: a.browseTab } : {});
        break;
      case 'url':
        this.history.navigateUrl(a.url);
        break;
      case 'tour':
        this.ui.closeSheet();
        this.ui.tourOpen.set(true);
        break;
      case 'install':
        this.ui.closeSheet();
        this.install.openModal();
        break;
      case 'toggle-translation':
        this.rv.toggleMode();
        this.ui.closeSheet();
        this.ui.showToast({
          message:
            this.rv.mode() === 'translation' ? 'Mode terjemahan aktif' : 'Kembali ke halaman mushaf',
          duration: 3000,
        });
        break;
      case 'toggle-latin':
        this.rv.setShowLatin(!this.rv.showLatin());
        this.ui.closeSheet();
        this.ui.showToast({
          message: this.rv.showLatin()
            ? 'Latin ditampilkan di mode terjemahan'
            : 'Latin disembunyikan',
          duration: 3000,
        });
        break;
      case 'font': {
        const ok = a.dir === 1 ? this.rv.canLarger() : this.rv.canSmaller();
        if (ok) {
          if (a.dir === 1) this.rv.larger();
          else this.rv.smaller();
        }
        this.ui.closeSheet();
        this.ui.showToast({
          message: ok
            ? `Ukuran teks terjemahan ${Math.round(this.rv.fontScale() * 100)}%`
            : a.dir === 1
              ? 'Sudah ukuran terbesar'
              : 'Sudah ukuran terkecil',
          duration: 3000,
        });
        break;
      }
    }
  }
}

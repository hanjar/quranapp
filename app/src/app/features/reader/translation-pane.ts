import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { AudioService } from '../../core/audio/audio.service';
import { LatinService } from '../../core/content/latin.service';
import { TranslationService } from '../../core/content/translation.service';
import { ContentApi } from '../../core/contracts';
import { AyahRef } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { ReadingViewService } from '../../core/reading-view.service';
import { verseKey } from './reader-logic';
import { PageAyah, pageAyahs, prefersReducedMotion } from './translation-logic';

export type TranslationStatus = 'loading' | 'ready' | 'unavailable';

interface AyahText {
  tr: string | null;
  latin: string | null;
}

/** Translation reading view for one page: same ayahs as the mushaf page, as text. */
@Component({
  selector: 'mf-translation-pane',
  templateUrl: './translation-pane.html',
  styleUrl: './translation-pane.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-page]': 'page()' },
})
export class TranslationPane {
  private readonly content = inject(ContentApi);
  private readonly translation = inject(TranslationService);
  private readonly latin = inject(LatinService);
  private readonly audio = inject(AudioService);
  private readonly ui = inject(ReaderUiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly view = inject(ReadingViewService);

  readonly page = input.required<number>();
  readonly selected = input<AyahRef | null>(null);
  /** Set of `surah:ayah` keys that are bookmarked. */
  readonly bookmarked = input<ReadonlySet<string>>(new Set());

  protected readonly status = signal<TranslationStatus>('loading');
  protected readonly latinMissing = signal(false);
  private readonly texts = signal<ReadonlyMap<string, AyahText>>(new Map());
  private readonly bismillahText = signal<{ id: string; latin: string | null } | null>(null);
  private readonly retryTick = signal(0);
  private token = 0;

  protected readonly source = this.translation.source;

  protected readonly ayahs = computed<PageAyah[]>(() => {
    if (!this.content.index()) return [];
    return pageAyahs(this.content.pageMeta(this.page()), (s) => this.content.surah(s).ayahCount);
  });

  protected readonly head = computed(() => {
    if (!this.content.index()) return null;
    const meta = this.content.pageMeta(this.page());
    const surahs = meta.surahs.map((n) => `${n} · ${this.content.surah(n).nameLatin}`).join(' – ');
    return { surahs, juz: `Juz ${meta.juz}` };
  });

  protected readonly bismillah = this.bismillahText.asReadonly();

  constructor() {
    effect(() => {
      const list = this.ayahs();
      const wantLatin = this.view.showLatin();
      this.retryTick();
      untracked(() => void this.load(list, wantLatin));
    });

    // Keep the playing / targeted ayah in view.
    effect(() => {
      const playing = this.audio.highlight();
      const sel = this.selected();
      this.texts();
      const ref = playing ?? sel;
      if (!ref) return;
      const key = verseKey(ref.surah, ref.ayah);
      untracked(() => queueMicrotask(() => this.scrollTo(key)));
    });
  }

  protected key(a: PageAyah): string {
    return verseKey(a.surah, a.ayah);
  }

  protected textOf(a: PageAyah): AyahText {
    return this.texts().get(this.key(a)) ?? { tr: null, latin: null };
  }

  protected surahName(n: number): { ar: string; latin: string } {
    const s = this.content.surah(n);
    return { ar: s.nameArabic, latin: s.nameLatin };
  }

  protected isSelected(a: PageAyah): boolean {
    const s = this.selected();
    return !!s && s.surah === a.surah && s.ayah === a.ayah;
  }

  protected isPlaying(a: PageAyah): boolean {
    const p = this.audio.highlight();
    return !!p && p.surah === a.surah && p.ayah === a.ayah;
  }

  protected ariaFor(a: PageAyah): string {
    const t = this.textOf(a).tr;
    return `Ayat ${a.surah}:${a.ayah}${t ? '. ' + t : ''}`;
  }

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  /** Pointer taps are handled by the reader's gesture controller; this covers keyboard/AT clicks. */
  protected onClick(e: MouseEvent, a: PageAyah): void {
    if (e.detail === 0) this.pick(a, e);
  }

  protected pick(a: PageAyah, e?: Event): void {
    e?.preventDefault();
    this.ui.selectVerse({ surah: a.surah, ayah: a.ayah, page: this.page() });
  }

  private scrollTo(key: string): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${key}"]`);
    el?.scrollIntoView?.({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  private async load(list: PageAyah[], wantLatin: boolean): Promise<void> {
    const token = ++this.token;
    if (list.length === 0) return;
    const needBismillah = list.some((a) => a.bismillah);
    const refs: AyahRef[] = list.map((a) => ({ surah: a.surah, ayah: a.ayah }));
    const bis: AyahRef = { surah: 1, ayah: 1 };

    const trs = await Promise.all(refs.map((r) => this.translation.get(r)));
    const bisTr = needBismillah ? await this.translation.get(bis) : null;
    if (token !== this.token) return;
    if (trs.every((t) => t === null)) {
      this.status.set('unavailable');
      return;
    }

    let lats: (string | null)[] = refs.map(() => null);
    let bisLatin: string | null = null;
    let missing = false;
    if (wantLatin) {
      lats = await Promise.all(refs.map((r) => this.latin.get(r)));
      bisLatin = needBismillah ? await this.latin.get(bis) : null;
      if (token !== this.token) return;
      missing = lats.every((l) => l === null);
    }

    const map = new Map<string, AyahText>();
    list.forEach((a, i) => map.set(verseKey(a.surah, a.ayah), { tr: trs[i], latin: lats[i] }));
    this.texts.set(map);
    this.bismillahText.set(bisTr ? { id: bisTr, latin: bisLatin } : null);
    this.latinMissing.set(missing);
    this.status.set('ready');
  }
}

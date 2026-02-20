import { Injectable, signal } from '@angular/core';
import { SurahMeta, SurahData, TranslationSurahData } from '../models/surah.model';

import { environment } from '../../../environments/environment';

const API_BASE = environment.apiBase;

@Injectable({ providedIn: 'root' })
export class QuranDataService {
  readonly surahs = signal<SurahMeta[]>([]);
  readonly currentSurah = signal<SurahData | null>(null);
  readonly currentTranslation = signal<TranslationSurahData | null>(null);
  readonly loading = signal(false);

  private surahCache = new Map<number, SurahData>();
  private translationCache = new Map<number, TranslationSurahData>();

  async loadSurahList(): Promise<void> {
    if (this.surahs().length > 0) return;
    const res = await fetch(`${API_BASE}/surahs`);
    const data: SurahMeta[] = await res.json();
    this.surahs.set(data);
  }

  async loadSurah(number: number): Promise<void> {
    if (this.currentSurah()?.id === number) return;

    const cached = this.surahCache.get(number);
    if (cached) {
      this.currentSurah.set(cached);
      return;
    }

    this.loading.set(true);
    try {
      const res = await fetch(`${API_BASE}/surah/${number}`);
      const data: SurahData = await res.json();
      this.surahCache.set(number, data);
      this.currentSurah.set(data);
    } finally {
      this.loading.set(false);
    }
  }

  async loadTranslation(number: number): Promise<TranslationSurahData> {
    const cached = this.translationCache.get(number);
    if (cached) {
      this.currentTranslation.set(cached);
      return cached;
    }

    const res = await fetch(`${API_BASE}/surah/${number}/translation`);
    const data: TranslationSurahData = await res.json();
    this.translationCache.set(number, data);
    this.currentTranslation.set(data);
    return data;
  }

  getSurahMeta(number: number): SurahMeta | undefined {
    return this.surahs().find(s => s.number === number);
  }
}

import { Injectable, signal } from '@angular/core';
import { MushafPageData, MushafPageDataV2 } from '../models/surah.model';

import { environment } from '../../../environments/environment';

const API_BASE = environment.apiBase;

export const JUZ_MAP: [number, number][] = [
  [1, 1],     // Juz 1
  [2, 142],   // Juz 2
  [2, 253],   // Juz 3
  [3, 93],    // Juz 4
  [4, 24],    // Juz 5
  [4, 148],   // Juz 6
  [5, 82],    // Juz 7
  [6, 111],   // Juz 8
  [7, 88],    // Juz 9
  [8, 41],    // Juz 10
  [9, 93],    // Juz 11
  [11, 6],    // Juz 12
  [12, 53],   // Juz 13
  [15, 1],    // Juz 14
  [17, 1],    // Juz 15
  [18, 75],   // Juz 16
  [21, 1],    // Juz 17
  [23, 1],    // Juz 18
  [25, 21],   // Juz 19
  [27, 56],   // Juz 20
  [29, 46],   // Juz 21
  [33, 31],   // Juz 22
  [36, 28],   // Juz 23
  [39, 32],   // Juz 24
  [41, 47],   // Juz 25
  [46, 1],    // Juz 26
  [51, 31],   // Juz 27
  [58, 1],    // Juz 28
  [67, 1],    // Juz 29
  [78, 1],    // Juz 30
];

@Injectable({ providedIn: 'root' })
export class PageMappingService {
  readonly currentPageData = signal<MushafPageData | null>(null);
  readonly currentMushafPage = signal<MushafPageDataV2 | null>(null);
  readonly loading = signal(false);
  readonly totalPages = 604;

  private pageCache = new Map<number, MushafPageData>();
  private mushafCache = new Map<number, MushafPageDataV2>();

  async loadPage(pageNum: number): Promise<MushafPageData> {
    const cached = this.pageCache.get(pageNum);
    if (cached) {
      this.currentPageData.set(cached);
      return cached;
    }

    this.loading.set(true);
    try {
      const res = await fetch(`${API_BASE}/page/${pageNum}`);
      const data: MushafPageData = await res.json();
      this.pageCache.set(pageNum, data);
      this.currentPageData.set(data);
      return data;
    } finally {
      this.loading.set(false);
    }
  }

  /** Load QPC mushaf page (15 lines, per-word glyphs) */
  async loadMushafPage(pageNum: number): Promise<MushafPageDataV2> {
    const cached = this.mushafCache.get(pageNum);
    if (cached) {
      this.currentMushafPage.set(cached);
      return cached;
    }

    this.loading.set(true);
    try {
      const res = await fetch(`${API_BASE}/mushaf-page/${pageNum}`);
      const data: MushafPageDataV2 = await res.json();
      this.mushafCache.set(pageNum, data);
      this.currentMushafPage.set(data);
      return data;
    } finally {
      this.loading.set(false);
    }
  }

  async getSurahFirstPage(surahNum: number): Promise<number> {
    const res = await fetch(`${API_BASE}/surah/${surahNum}/page`);
    const data = await res.json();
    return data.page;
  }

  async getAyahPage(surah: number, ayah: number): Promise<number> {
    const res = await fetch(`${API_BASE}/surah/${surah}/ayah/${ayah}/page`);
    const data = await res.json();
    return data.page;
  }

  getJuz(surah: number, ayah: number): number {
    for (let i = JUZ_MAP.length - 1; i >= 0; i--) {
      const [s, a] = JUZ_MAP[i];
      if (surah > s || (surah === s && ayah >= a)) {
        return i + 1;
      }
    }
    return 1;
  }
}

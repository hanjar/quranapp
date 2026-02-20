import { Injectable, signal } from '@angular/core';
import { MushafPageData, MushafPageDataV2 } from '../models/surah.model';

import { environment } from '../../../environments/environment';

const API_BASE = environment.apiBase;

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
}

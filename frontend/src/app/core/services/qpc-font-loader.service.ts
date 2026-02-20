import { Injectable } from '@angular/core';

/**
 * Dynamically loads QPC mushaf fonts per page on-demand.
 * Each page (1-604) has its own font file that maps PUA glyphs
 * to pixel-perfect Madina Mushaf calligraphy.
 */
@Injectable({ providedIn: 'root' })
export class QpcFontLoaderService {
    private loadedPages = new Set<number>();
    private loadingPages = new Map<number, Promise<void>>();

    /**
     * Load QPC font for a specific page. No-op if already loaded.
     * Returns a promise that resolves when font is ready to use.
     */
    async loadPageFont(pageNum: number): Promise<void> {
        if (this.loadedPages.has(pageNum)) return;

        // If already loading, wait for existing promise
        const existing = this.loadingPages.get(pageNum);
        if (existing) return existing;

        const promise = this._doLoad(pageNum);
        this.loadingPages.set(pageNum, promise);

        try {
            await promise;
            this.loadedPages.add(pageNum);
        } finally {
            this.loadingPages.delete(pageNum);
        }
    }

    /**
     * Preload fonts for adjacent pages (for smooth swiping).
     */
    preloadAdjacentPages(pageNum: number): void {
        if (pageNum > 1) this.loadPageFont(pageNum - 1).catch(() => { });
        if (pageNum < 604) this.loadPageFont(pageNum + 1).catch(() => { });
    }

    /**
     * Get CSS font-family name for a page.
     */
    getFontFamily(pageNum: number): string {
        const padded = String(pageNum).padStart(3, '0');
        return `QPC-P${padded}`;
    }

    /**
     * Check if a page's font is loaded.
     */
    isLoaded(pageNum: number): boolean {
        return this.loadedPages.has(pageNum);
    }

    private async _doLoad(pageNum: number): Promise<void> {
        const padded = String(pageNum).padStart(3, '0');
        const fontFamily = `QPC-P${padded}`;
        const url = `/fonts/qpc/QCF_P${padded}.woff2`;

        const fontFace = new FontFace(fontFamily, `url(${url})`, {
            display: 'swap',
        });

        const loadedFont = await fontFace.load();
        (document.fonts as FontFaceSet).add(loadedFont);
    }
}

import { Injectable, signal, inject } from '@angular/core';
import { PageMappingService } from './page-mapping.service';
import { QpcFontLoaderService } from './qpc-font-loader.service';
import { QuranDataService } from './quran-data.service';

export interface DownloadState {
    downloading: boolean;
    progress: number; // 0-100
    total: number;
    current: number;
    error?: string;
    completed: boolean;
    cancelled: boolean;
}

@Injectable({ providedIn: 'root' })
export class DownloadService {
    private pageMapping = inject(PageMappingService);
    private fontLoader = inject(QpcFontLoaderService);
    private quranData = inject(QuranDataService);

    readonly state = signal<DownloadState>({
        downloading: false,
        progress: 0,
        total: 604,
        current: 0,
        completed: !!localStorage.getItem('mushaf_downloaded'),
        cancelled: false
    });

    private abortController: AbortController | null = null;

    async startDownload() {
        if (this.state().downloading) return;

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        this.state.set({
            downloading: true,
            progress: 0,
            total: 604,
            current: 0,
            completed: false,
            cancelled: false
        });

        try {
            // 1. Fetch Surah List (should be fast)
            await this.quranData.loadSurahList();

            // 2. Iterate pages
            const total = 604;
            // We can do batches to avoid overwhelming the network/browser
            const batchSize = 5;

            for (let i = 1; i <= total; i += batchSize) {
                if (signal.aborted) throw new Error('Cancelled');

                const batch = [];
                for (let j = 0; j < batchSize && (i + j) <= total; j++) {
                    const pageNum = i + j;
                    // Fetch data and font
                    batch.push(this.pageMapping.loadMushafPage(pageNum));
                    batch.push(this.fontLoader.loadPageFont(pageNum)); // This loads font as blob/face
                }

                await Promise.all(batch);

                const current = Math.min(i + batchSize - 1, total);
                this.state.update(s => ({
                    ...s,
                    current,
                    progress: Math.round((current / total) * 100)
                }));
            }

            this.state.update(s => ({
                ...s,
                downloading: false,
                completed: true,
                progress: 100
            }));
            localStorage.setItem('mushaf_downloaded', 'true');
            localStorage.setItem('mushaf_downloaded_date', new Date().toISOString());

        } catch (err: any) {
            if (err.message === 'Cancelled') {
                this.state.update(s => ({ ...s, downloading: false, cancelled: true }));
            } else {
                console.error('Download failed', err);
                this.state.update(s => ({ ...s, downloading: false, error: 'Gagal mengunduh data. Coba lagi.' }));
            }
        }
    }

    cancelDownload() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

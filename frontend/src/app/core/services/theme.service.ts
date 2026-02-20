import { Injectable, signal, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type Theme = 'default' | 'classic';

@Injectable({ providedIn: 'root' })
export class ThemeService {
    private document = inject(DOCUMENT);

    readonly currentTheme = signal<Theme>('default');

    constructor() {
        this.initTheme();

        // Effect to update body class whenever signal changes
        effect(() => {
            const theme = this.currentTheme();
            const body = this.document.body;

            if (theme === 'classic') {
                body.classList.add('theme-classic');
            } else {
                body.classList.remove('theme-classic');
            }

            localStorage.setItem('quran-theme', theme);
        });
    }

    private initTheme() {
        const saved = localStorage.getItem('quran-theme') as Theme;
        if (saved === 'classic') {
            this.currentTheme.set('classic');
        }
    }

    toggleTheme() {
        this.currentTheme.update(current =>
            current === 'default' ? 'classic' : 'default'
        );
    }

    setTheme(theme: Theme) {
        this.currentTheme.set(theme);
    }
}

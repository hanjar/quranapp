import { DOCUMENT, Injectable, effect, inject } from '@angular/core';
import { UserDataApi } from './contracts';
import { PaperTheme, UiTheme } from './models';

export interface PaperThemeOption {
  id: PaperTheme;
  name: string;
  hex: string;
}

export interface UiThemeOption {
  id: UiTheme;
  name: string;
  fontName: string;
  primary: string;
  accent: string;
}

/** Labels + swatches for pickers (welcome, settings). Values mirror styles.scss. */
export const PAPER_THEMES: PaperThemeOption[] = [
  { id: 'photo', name: 'Foto Sampel', hex: '#EEEDEB' },
  { id: 'ivory', name: 'Gading Hangat', hex: '#F5F1E8' },
  { id: 'antique', name: 'Kertas Antik', hex: '#F2EBDD' },
];

export const UI_THEMES: UiThemeOption[] = [
  { id: 'segar', name: 'Segar', fontName: 'Plus Jakarta Sans', primary: '#0A7A5C', accent: '#F2603E' },
  { id: 'ceria', name: 'Ceria', fontName: 'Plus Jakarta Sans', primary: '#5B3FD9', accent: '#F2A100' },
  { id: 'samudra', name: 'Samudra', fontName: 'Plus Jakarta Sans', primary: '#1560C8', accent: '#EC4677' },
  { id: 'klasik', name: 'Klasik', fontName: 'Newsreader · IBM Plex Sans', primary: '#153B32', accent: '#A58B63' },
];

/** Mirrors preferences onto <html> data attributes consumed by styles.scss. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly data = inject(UserDataApi);

  constructor() {
    effect(() => {
      const p = this.data.prefs();
      const html = this.doc.documentElement;
      html.dataset['paper'] = p.paperTheme;
      html.dataset['ui'] = p.uiTheme;
      html.dataset['contrast'] = p.highContrast ? 'high' : 'normal';
      html.dataset['motion'] = p.motion === 'reduce' ? 'reduce' : 'system';
      const meta = this.doc.querySelector('meta[name="theme-color"]');
      const hex = PAPER_THEMES.find((t) => t.id === p.paperTheme)?.hex;
      if (meta && hex) meta.setAttribute('content', hex);
    });
  }
}

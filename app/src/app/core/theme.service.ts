import { DOCUMENT, Injectable, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { isNightAt, nextBoundary } from './night-schedule';
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
  { id: 'cream', name: 'Krem Madinah', hex: '#FFFDF6' },
  { id: 'photo', name: 'Foto Sampel', hex: '#EEEDEB' },
  { id: 'ivory', name: 'Gading Hangat', hex: '#F5F1E8' },
  { id: 'antique', name: 'Kertas Antik', hex: '#F2EBDD' },
];

export const UI_THEMES: UiThemeOption[] = [
  {
    id: 'segar',
    name: 'Segar',
    fontName: 'Plus Jakarta Sans',
    primary: '#0A7A5C',
    accent: '#F2603E',
  },
  {
    id: 'ceria',
    name: 'Ceria',
    fontName: 'Plus Jakarta Sans',
    primary: '#5B3FD9',
    accent: '#F2A100',
  },
  {
    id: 'samudra',
    name: 'Samudra',
    fontName: 'Plus Jakarta Sans',
    primary: '#1560C8',
    accent: '#EC4677',
  },
  {
    id: 'klasik',
    name: 'Klasik',
    fontName: 'Newsreader · IBM Plex Sans',
    primary: '#153B32',
    accent: '#A58B63',
  },
];

export const NIGHT_THEME_COLOR = '#161513';
export const NIGHT_THEME_COLOR_HIGH = '#000000';

/** Mirrors preferences onto <html> data attributes consumed by styles.scss. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly data = inject(UserDataApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly systemDark = signal(false);
  private readonly clock = signal(Date.now());

  /** True while night mode is actually applied (manual, device scheme or schedule). */
  readonly nightActive = computed(() => {
    const p = this.data.prefs();
    if (p.nightMode === 'on') return true;
    if (p.nightMode === 'off') return false;
    return p.nightAuto === 'schedule'
      ? isNightAt(new Date(this.clock()), p.nightStart, p.nightEnd)
      : this.systemDark();
  });

  constructor() {
    this.watchSystem();
    this.watchSchedule();
    effect(() => {
      const p = this.data.prefs();
      const html = this.doc.documentElement;
      html.dataset['paper'] = p.paperTheme;
      html.dataset['ui'] = p.uiTheme;
      html.dataset['contrast'] = p.highContrast ? 'high' : 'normal';
      html.dataset['motion'] = p.motion === 'reduce' ? 'reduce' : 'system';
      const night = this.nightActive();
      if (night) html.dataset['night'] = 'on';
      else delete html.dataset['night'];
      const meta = this.doc.querySelector('meta[name="theme-color"]');
      const hex = night
        ? p.highContrast
          ? NIGHT_THEME_COLOR_HIGH
          : NIGHT_THEME_COLOR
        : PAPER_THEMES.find((t) => t.id === p.paperTheme)?.hex;
      if (meta && hex) meta.setAttribute('content', hex);
    });
  }

  /** Follows prefers-color-scheme; listener removed on destroy. */
  private watchSystem(): void {
    const mq = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    this.systemDark.set(mq.matches);
    const on = (e: MediaQueryListEvent) => this.systemDark.set(e.matches);
    mq.addEventListener('change', on);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', on));
  }

  /** Re-evaluates the schedule at the next boundary and when the page becomes visible again. */
  private watchSchedule(): void {
    const win = this.doc.defaultView;
    if (!win) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const p = this.data.prefs();
      this.clock.set(Date.now());
      if (p.nightMode !== 'auto' || p.nightAuto !== 'schedule') return;
      const next = nextBoundary(new Date(), p.nightStart, p.nightEnd);
      if (!next) return;
      // +1 s so the clock is safely past the boundary; cap at 24 h (setTimeout limit headroom).
      const ms = Math.min(next.getTime() - Date.now() + 1000, 24 * 3600 * 1000);
      timer = setTimeout(arm, Math.max(ms, 1000));
    };
    const onVisible = () => {
      if (this.doc.visibilityState === 'visible') arm();
    };
    this.doc.addEventListener('visibilitychange', onVisible);
    const ref = effect(() => {
      const p = this.data.prefs();
      void p.nightMode, p.nightAuto, p.nightStart, p.nightEnd;
      arm();
    });
    this.destroyRef.onDestroy(() => {
      ref.destroy();
      if (timer !== undefined) clearTimeout(timer);
      this.doc.removeEventListener('visibilitychange', onVisible);
    });
  }
}

import { DOCUMENT, Injectable, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { isNightAt, nextBoundary } from './night-schedule';
import { UserDataApi } from './contracts';
import { BuiltinPaperTheme, UiTheme } from './models';
import { CUSTOM_THEME_VAR_NAMES, customThemeVars, resolvePaper } from './custom-theme';

export interface PaperThemeOption {
  id: BuiltinPaperTheme;
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
  // Default since 0.16.2: the owner's own 'Sephia' theme.
  { id: 'sepia', name: 'Sepia', hex: '#F4ECD8' },
  { id: 'cream', name: 'Krem Madinah', hex: '#FFFDF6' },
  { id: 'photo', name: 'Foto Sampel', hex: '#EEEDEB' },
  { id: 'ivory', name: 'Gading Hangat', hex: '#F5F1E8' },
  { id: 'antique', name: 'Kertas Antik', hex: '#F2EBDD' },
  // Research-based: positive polarity, ~12.5:1 ink (not 21:1 glare), warm low-luminance paper.
  { id: 'comfort', name: 'Krem Nyaman', hex: '#F3EAD3' },
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
      const night = this.nightActive();
      const paper = resolvePaper(p);
      html.dataset['paper'] = paper.builtin;
      // A custom theme only paints in day mode; night mode and high contrast keep their own palette.
      const custom = !night && !p.highContrast ? paper.custom : null;
      if (custom) {
        for (const [k, v] of Object.entries(customThemeVars(custom))) html.style.setProperty(k, v);
      } else {
        for (const k of CUSTOM_THEME_VAR_NAMES) html.style.removeProperty(k);
      }
      html.dataset['ui'] = p.uiTheme;
      html.dataset['contrast'] = p.highContrast ? 'high' : 'normal';
      html.dataset['motion'] = p.motion === 'reduce' ? 'reduce' : 'system';
      if (night) html.dataset['night'] = 'on';
      else delete html.dataset['night'];
      const meta = this.doc.querySelector('meta[name="theme-color"]');
      const hex = night
        ? p.highContrast
          ? NIGHT_THEME_COLOR_HIGH
          : NIGHT_THEME_COLOR
        : (custom?.paper ?? PAPER_THEMES.find((t) => t.id === paper.builtin)?.hex);
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

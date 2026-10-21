import { Injectable, computed, inject, signal } from '@angular/core';
import { UserDataApi } from './contracts';
import { DEFAULT_FONT_SCALE, FONT_SCALES, snapScale } from './models';

export { DEFAULT_FONT_SCALE, FONT_SCALES, snapScale };

export type ReadingMode = 'mushaf' | 'translation';

const KEY_MODE = 'mf-view-mode';

/**
 * How the reader presents a page: the mushaf image or the translation text.
 * The mushaf/translation mode is per device (localStorage); the Latin toggle and font size
 * are synced preferences.
 */
@Injectable({ providedIn: 'root' })
export class ReadingViewService {
  readonly mode = signal<ReadingMode>(readStore(KEY_MODE) === 'translation' ? 'translation' : 'mushaf');
  private readonly data = inject(UserDataApi);
  readonly showLatin = computed(() => this.data.prefs().showLatin);
  readonly fontScale = computed(() => snapScale(this.data.prefs().translationScale));

  setMode(m: ReadingMode): void {
    this.mode.set(m);
    writeStore(KEY_MODE, m);
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'mushaf' ? 'translation' : 'mushaf');
  }

  setShowLatin(on: boolean): void {
    void this.data.setPrefs({ showLatin: on });
  }

  canLarger(): boolean {
    return this.fontScale() < FONT_SCALES[FONT_SCALES.length - 1];
  }

  canSmaller(): boolean {
    return this.fontScale() > FONT_SCALES[0];
  }

  larger(): void {
    this.step(1);
  }

  smaller(): void {
    this.step(-1);
  }

  private step(dir: 1 | -1): void {
    const i = FONT_SCALES.indexOf(this.fontScale());
    const next = FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, i + dir))];
    void this.data.setPrefs({ translationScale: next });
  }
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preference lasts for this page load only
  }
}

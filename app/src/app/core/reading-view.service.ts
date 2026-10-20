import { Injectable, signal } from '@angular/core';

export type ReadingMode = 'mushaf' | 'translation';

/** Allowed translation font scales (multiplier on the base size). */
export const FONT_SCALES: readonly number[] = [0.9, 1, 1.15, 1.3, 1.45, 1.6];
export const DEFAULT_FONT_SCALE = 1;

const KEY_MODE = 'mf-view-mode';
const KEY_LATIN = 'mf-tr-latin';
const KEY_SIZE = 'mf-tr-size';

/** Snap an arbitrary stored value to the nearest allowed scale. */
export function snapScale(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return DEFAULT_FONT_SCALE;
  return FONT_SCALES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best));
}

/**
 * How the reader presents a page: the mushaf image or the translation text.
 * A per-device preference (localStorage), deliberately not part of synced prefs.
 */
@Injectable({ providedIn: 'root' })
export class ReadingViewService {
  readonly mode = signal<ReadingMode>(readStore(KEY_MODE) === 'translation' ? 'translation' : 'mushaf');
  readonly showLatin = signal<boolean>(readStore(KEY_LATIN) === '1');
  readonly fontScale = signal<number>(snapScale(readStore(KEY_SIZE)));

  setMode(m: ReadingMode): void {
    this.mode.set(m);
    writeStore(KEY_MODE, m);
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'mushaf' ? 'translation' : 'mushaf');
  }

  setShowLatin(on: boolean): void {
    this.showLatin.set(on);
    writeStore(KEY_LATIN, on ? '1' : '0');
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
    this.fontScale.set(next);
    writeStore(KEY_SIZE, String(next));
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

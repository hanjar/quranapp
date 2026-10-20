import { Injectable, signal } from '@angular/core';

const KEY = 'mf-line-rules';

/**
 * Optional thin separator lines between the text lines of a mushaf page.
 * Stored per device; applied as `html[data-line-rules='on']` so toggling never re-renders pages.
 */
@Injectable({ providedIn: 'root' })
export class LineRulesService {
  readonly enabled = signal(read());

  constructor() {
    apply(this.enabled());
  }

  set(on: boolean): void {
    this.enabled.set(on);
    apply(on);
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  }
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function apply(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-line-rules', 'on');
  else document.documentElement.removeAttribute('data-line-rules');
}

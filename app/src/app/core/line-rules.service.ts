import { Injectable, computed, effect, inject } from '@angular/core';
import { UserDataApi } from './contracts';

/**
 * Optional thin separator lines between the text lines of a mushaf page.
 * A synced preference; applied as `html[data-line-rules='on']` so toggling never re-renders pages.
 */
@Injectable({ providedIn: 'root' })
export class LineRulesService {
  private readonly data = inject(UserDataApi);
  readonly enabled = computed(() => this.data.prefs().lineRules);

  constructor() {
    effect(() => apply(this.enabled()));
  }

  /** Applies the stored choice right now (called once prefs are loaded, before the first page). */
  applyNow(): void {
    apply(this.enabled());
  }

  set(on: boolean): void {
    apply(on);
    void this.data.setPrefs({ lineRules: on });
  }
}

function apply(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-line-rules', 'on');
  else document.documentElement.removeAttribute('data-line-rules');
}

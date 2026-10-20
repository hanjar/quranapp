import { DestroyRef, ElementRef, effect, inject, untracked } from '@angular/core';
import { ReaderUiService } from '../../core/reader-ui.service';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FLASH_MS = 1800;
const MAX_WAIT_MS = 1500;

/**
 * Call from a sheet body's constructor. When the universal search asked for a row inside this
 * sheet (`ReaderUiService.focusTarget`), waits until the sheet finished opening (it is `inert`
 * while sliding in), scrolls the `[data-search-id]` element into view, focuses it and briefly
 * highlights it (`.mf-flash`, no animation so reduced motion is honoured).
 */
export function useSearchFocusTarget(): void {
  const ui = inject(ReaderUiService);
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  inject(DestroyRef).onDestroy(() => timers.forEach(clearTimeout));

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const attempt = (id: string, waited: number) => {
    const el = host.querySelector<HTMLElement>(`[data-search-id="${id}"]`);
    const ready = el && !el.closest('[inert]');
    if (!ready) {
      if (waited < MAX_WAIT_MS) later(() => attempt(id, waited + 60), 60);
      else if (ui.focusTarget() === id) ui.focusTarget.set(null);
      return;
    }
    later(() => {
      const focusable = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
      el.scrollIntoView({ block: 'center' });
      focusable?.focus({ preventScroll: true });
      el.classList.add('mf-flash');
      later(() => el.classList.remove('mf-flash'), FLASH_MS);
      if (ui.focusTarget() === id) ui.focusTarget.set(null);
    }, 80); // after the sheet host moved focus to the heading
  };

  effect(() => {
    const id = ui.focusTarget();
    if (id) untracked(() => attempt(id, 0));
  });
}

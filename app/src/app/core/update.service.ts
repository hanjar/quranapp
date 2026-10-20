import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** How often an open app looks for a new version (also on start and on return to the tab). */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Don't re-check more often than this when the tab keeps regaining focus. */
const MIN_GAP_MS = 60 * 1000;

/**
 * Finds new app versions automatically. A downloaded update is never applied
 * mid-reading (PRD §10): `available` turns true and the UI offers "Muat ulang".
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);

  /** A new version is downloaded and waits for a reload. */
  readonly available = signal(false);
  private lastCheck = 0;

  constructor() {
    if (!this.sw.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY') this.available.set(true);
    });
    // The service worker cannot recover (e.g. files evicted): only a reload helps.
    const broken = this.sw.unrecoverable.subscribe(() => document.location.reload());

    const ac = new AbortController();
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') void this.check();
      },
      { signal: ac.signal },
    );
    const timer = setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS);
    // First check once the app has settled (the worker registers after ~5 s).
    const first = setTimeout(() => void this.check(), 8000);

    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      broken.unsubscribe();
      ac.abort();
      clearInterval(timer);
      clearTimeout(first);
    });
  }

  /** Looks for a new version now; resolves true when one was found. Never rejects. */
  async check(force = false): Promise<boolean> {
    if (!this.sw.isEnabled || this.available()) return this.available();
    const now = Date.now();
    if (!force && now - this.lastCheck < MIN_GAP_MS) return false;
    this.lastCheck = now;
    try {
      return await this.sw.checkForUpdate();
    } catch {
      return false; // offline or worker not ready: try again later
    }
  }

  /** Switches to the downloaded version and reloads the page. */
  async reload(): Promise<void> {
    try {
      await this.sw.activateUpdate();
    } catch {
      // reload anyway: the new worker takes over on navigation
    }
    document.location.reload();
  }
}

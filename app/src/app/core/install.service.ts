import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Chrome/Edge/Samsung Internet event fired when the PWA is installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * - `installed`: already running as an installed app (standalone)
 * - `available`: the browser offered an install prompt we can trigger
 * - `ios`: iPhone/iPad Safari — install manually via Share → Add to Home Screen
 * - `manual`: no prompt (yet): install through the browser menu
 */
export type InstallState = 'installed' | 'available' | 'ios' | 'manual';

/**
 * "Pasang ke perangkat": captures `beforeinstallprompt` as early as possible
 * (instantiated from the app initializer) so a button can trigger it later.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly doc = inject(DOCUMENT);
  private deferred: BeforeInstallPromptEvent | null = null;
  readonly state = signal<InstallState>(this.initialState());

  constructor() {
    const win = this.doc.defaultView;
    if (!win) return;
    const listeners = new AbortController();
    inject(DestroyRef).onDestroy(() => listeners.abort());
    win.addEventListener(
      'beforeinstallprompt',
      (e) => {
        e.preventDefault(); // keep the mini-infobar quiet; we offer our own button
        this.deferred = e as BeforeInstallPromptEvent;
        if (this.state() !== 'installed') this.state.set('available');
      },
      { signal: listeners.signal },
    );
    win.addEventListener(
      'appinstalled',
      () => {
        this.deferred = null;
        this.state.set('installed');
      },
      { signal: listeners.signal },
    );
  }

  /** Shows the native install dialog. Resolves true when the user accepted. */
  async promptInstall(): Promise<boolean> {
    const ev = this.deferred;
    if (!ev) return false;
    this.deferred = null; // a prompt event can be used only once
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') this.state.set('installed');
    else this.state.set(this.isIos() ? 'ios' : 'manual');
    return outcome === 'accepted';
  }

  private initialState(): InstallState {
    const win = this.doc.defaultView;
    if (!win) return 'manual';
    const standalone =
      win.matchMedia?.('(display-mode: standalone)').matches ||
      (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return 'installed';
    return this.isIos() ? 'ios' : 'manual';
  }

  private isIos(): boolean {
    const nav = this.doc.defaultView?.navigator;
    if (!nav) return false;
    // iPadOS reports "Macintosh" but has touch points.
    return (
      /iPad|iPhone|iPod/.test(nav.userAgent) ||
      (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
    );
  }
}

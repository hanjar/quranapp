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
  /** The "Pasang Mushaf Digital" modal (features/shell/install-prompt.ts). */
  readonly modalOpen = signal(false);
  /** User ticked "Jangan tampilkan lagi": never auto-offer again (the Settings row still works). */
  readonly dismissedForever = signal(readFlag(DISMISS_KEY));
  /**
   * The app is installed on this device, seen from a normal browser tab (the
   * installed window shares this origin's storage, and Chrome can report it).
   * Suppresses the automatic offer; the Menu tile still opens the modal.
   */
  readonly installedElsewhere = signal(readFlag(INSTALLED_KEY));

  /** Opens the modal on request (Settings row) — ignores the "don't show again" flag. */
  openModal(): void {
    if (this.state() !== 'installed') this.modalOpen.set(true);
  }

  /** Automatic offer: at most once per session, never after "Jangan tampilkan lagi". */
  offerOnce(): void {
    if (
      this.state() === 'installed' ||
      this.installedElsewhere() ||
      this.dismissedForever() ||
      readFlag(SESSION_KEY, true)
    )
      return;
    writeFlag(SESSION_KEY, true, true);
    this.modalOpen.set(true);
  }

  closeModal(opts: { dontShowAgain?: boolean } = {}): void {
    this.modalOpen.set(false);
    if (opts.dontShowAgain) {
      this.dismissedForever.set(true);
      writeFlag(DISMISS_KEY, true);
    } else if (this.dismissedForever()) {
      this.resetDismissal(); // the box was unticked: offers may show again
    }
  }

  /** Re-enables the automatic offer (e.g. a "show again" option). */
  resetDismissal(): void {
    this.dismissedForever.set(false);
    writeFlag(DISMISS_KEY, false);
  }

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
        // Chrome only offers this when the app is NOT installed (e.g. it was removed).
        this.markInstalled(false);
        if (this.state() !== 'installed') this.state.set('available');
      },
      { signal: listeners.signal },
    );
    win.addEventListener(
      'appinstalled',
      () => {
        this.deferred = null;
        this.state.set('installed');
        this.markInstalled(true);
      },
      { signal: listeners.signal },
    );
    if (this.state() === 'installed') this.markInstalled(true);
    // Chrome (Android/desktop) can tell a browser tab that this PWA is installed
    // (manifest related_applications with platform 'webapp').
    const nav = win.navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<unknown[]>;
    };
    void nav
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps.length > 0) this.markInstalled(true);
      })
      .catch(() => undefined);
  }

  private markInstalled(on: boolean): void {
    this.installedElsewhere.set(on);
    writeFlag(INSTALLED_KEY, on);
  }

  /** Shows the native install dialog. Resolves true when the user accepted. */
  async promptInstall(): Promise<boolean> {
    const ev = this.deferred;
    if (!ev) return false;
    this.deferred = null; // a prompt event can be used only once
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') {
      this.state.set('installed');
      this.markInstalled(true);
    }
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

const DISMISS_KEY = 'mf-install-dismissed';
const SESSION_KEY = 'mf-install-offered';
const INSTALLED_KEY = 'mf-installed';

/** Storage can be unavailable (private mode, blocked site data): fail closed, never throw. */
function readFlag(key: string, session = false): boolean {
  try {
    return (session ? sessionStorage : localStorage).getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean, session = false): void {
  try {
    const s = session ? sessionStorage : localStorage;
    if (on) s.setItem(key, '1');
    else s.removeItem(key);
  } catch {
    // preference lasts for this page load only
  }
}

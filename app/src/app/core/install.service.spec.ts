import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InstallService } from './install.service';

function fakePrompt(outcome: 'accepted' | 'dismissed') {
  const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    prompted: boolean;
  };
  ev.prompted = false;
  ev.prompt = async () => {
    ev.prompted = true;
  };
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
}

describe('InstallService', () => {
  it('captures beforeinstallprompt and installs on accept', async () => {
    const svc = TestBed.inject(InstallService);
    const ev = fakePrompt('accepted');
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(svc.state()).toBe('available');
    await expect(svc.promptInstall()).resolves.toBe(true);
    expect(ev.prompted).toBe(true);
    expect(svc.state()).toBe('installed');
  });

  it('falls back to manual instructions when the prompt is dismissed', async () => {
    const svc = TestBed.inject(InstallService);
    window.dispatchEvent(fakePrompt('dismissed'));
    await expect(svc.promptInstall()).resolves.toBe(false);
    expect(svc.state()).toBe('manual');
    // the event cannot be reused
    await expect(svc.promptInstall()).resolves.toBe(false);
  });

  it('marks the app installed on appinstalled', () => {
    const svc = TestBed.inject(InstallService);
    window.dispatchEvent(new Event('appinstalled'));
    expect(svc.state()).toBe('installed');
  });
});

describe('InstallService modal', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('auto-offers at most once per session', () => {
    const svc = TestBed.inject(InstallService);
    svc.offerOnce();
    expect(svc.modalOpen()).toBe(true);
    svc.closeModal();
    svc.offerOnce();
    expect(svc.modalOpen()).toBe(false);
  });

  it('never auto-offers after "Jangan tampilkan lagi", but the menu still opens it', () => {
    const svc = TestBed.inject(InstallService);
    svc.openModal();
    svc.closeModal({ dontShowAgain: true });
    expect(localStorage.getItem('mf-install-dismissed')).toBe('1');
    sessionStorage.clear(); // new session
    svc.offerOnce();
    expect(svc.modalOpen()).toBe(false);
    svc.openModal();
    expect(svc.modalOpen()).toBe(true);
  });

  it('does not auto-offer in a browser tab once the app was installed on this device', () => {
    localStorage.setItem('mf-installed', '1'); // written by the installed app window
    const svc = TestBed.inject(InstallService);
    svc.offerOnce();
    expect(svc.modalOpen()).toBe(false);
    svc.openModal(); // the Menu tile still works
    expect(svc.modalOpen()).toBe(true);
  });

  it('forgets the installed mark when Chrome offers installation again', () => {
    localStorage.setItem('mf-installed', '1');
    const svc = TestBed.inject(InstallService);
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(ev);
    expect(svc.installedElsewhere()).toBe(false);
    expect(localStorage.getItem('mf-installed')).toBeNull();
  });

  it('does not open when already installed', () => {
    const svc = TestBed.inject(InstallService);
    window.dispatchEvent(new Event('appinstalled'));
    svc.openModal();
    svc.offerOnce();
    expect(svc.modalOpen()).toBe(false);
  });
});

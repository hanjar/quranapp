import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
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

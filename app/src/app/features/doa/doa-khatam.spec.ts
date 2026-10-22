import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDataApi } from '../../core/contracts';
import { DEFAULT_PREFERENCES, Preferences } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { DoaKhatam, doaCopyText } from './doa-khatam';
import { DOA_KHATAM, DOA_KHATAM_SOURCE, DOA_KHATAM_TITLE } from './doa-khatam.content';

describe('DoaKhatam', () => {
  const position = signal<{ page: number } | null>({ page: 604 });
  const prefs = signal<Preferences>({ ...DEFAULT_PREFERENCES });
  const setPrefs = vi.fn(async (patch: Partial<Preferences>) => {
    prefs.update((p) => ({ ...p, ...patch }));
  });

  beforeEach(() => {
    position.set({ page: 604 });
    prefs.set({ ...DEFAULT_PREFERENCES });
    setPrefs.mockClear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: UserDataApi, useValue: { position, prefs, setPrefs } }],
    });
  });

  function mount() {
    const f = TestBed.createComponent(DoaKhatam);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders the frozen text: title, every line in Arabic/Latin/translation, source', () => {
    const el = mount();
    expect(el.querySelector('h1')!.textContent).toBe(DOA_KHATAM_TITLE);
    const ar = Array.from(el.querySelectorAll<HTMLElement>('.ar'));
    expect(ar.map((e) => e.textContent)).toEqual(DOA_KHATAM.map((l) => l.arabic));
    for (const e of ar) {
      expect(e.getAttribute('lang')).toBe('ar');
      expect(e.getAttribute('dir')).toBe('rtl');
    }
    expect(Array.from(el.querySelectorAll('.lat')).map((e) => e.textContent)).toEqual(
      DOA_KHATAM.map((l) => l.latin),
    );
    expect(Array.from(el.querySelectorAll('.tr')).map((e) => e.textContent)).toEqual(
      DOA_KHATAM.map((l) => l.translation),
    );
    expect(el.querySelector('.src')!.textContent).toBe(DOA_KHATAM_SOURCE);
  });

  it('is not a mushaf page: no page number or frame', () => {
    const el = mount();
    expect(el.querySelector('mf-page-view, .pill, .frame')).toBeNull();
  });

  it('back returns to the last read page', () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el = mount();
    el.querySelector<HTMLElement>('header button')!.click();
    expect(nav).toHaveBeenCalledWith(['/hal', 604]);
  });

  it('Salin copies title, Arabic, Latin and translation, then confirms', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const el = mount();
    el.querySelector<HTMLElement>('.copybtn')!.click();
    await Promise.resolve();
    expect(write).toHaveBeenCalledWith(doaCopyText());
    const text = doaCopyText();
    for (const l of DOA_KHATAM) {
      expect(text).toContain(l.arabic);
      expect(text).toContain(l.latin);
      expect(text).toContain(l.translation);
    }
    await Promise.resolve();
    expect(TestBed.inject(ReaderUiService).toast()?.message).toBe('Doa disalin');
  });

  it('the switch hides the doa: saves the pref, toasts with Urungkan and goes back to the reader', () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el = mount();
    const sw = el.querySelector<HTMLElement>('[data-testid="doa-show"] .switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    expect(setPrefs).toHaveBeenCalledWith({ showDoaKhatam: false });
    expect(nav).toHaveBeenCalledWith(['/hal', 604]);
    const toast = TestBed.inject(ReaderUiService).toast()!;
    expect(toast.message).toBe('Doa khatam disembunyikan');
    toast.action!();
    expect(setPrefs).toHaveBeenLastCalledWith({ showDoaKhatam: true });
  });

  it('opened directly while hidden: the text still shows and the switch turns it back on', () => {
    prefs.set({ ...DEFAULT_PREFERENCES, showDoaKhatam: false });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(DoaKhatam);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.line').length).toBe(DOA_KHATAM.length);
    const sw = el.querySelector<HTMLElement>('[data-testid="doa-show"] .switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    expect(setPrefs).toHaveBeenCalledWith({ showDoaKhatam: true });
    expect(nav).not.toHaveBeenCalled();
  });

  it('ReaderUiService.openDoaKhatam navigates to /doa-khatam', () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ReaderUiService).openDoaKhatam();
    expect(nav).toHaveBeenCalledWith(['/doa-khatam']);
  });
});

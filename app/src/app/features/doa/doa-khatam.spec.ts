import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { DoaKhatam, doaCopyText } from './doa-khatam';
import { DOA_KHATAM, DOA_KHATAM_SOURCE, DOA_KHATAM_TITLE } from './doa-khatam.content';

describe('DoaKhatam', () => {
  const position = signal<{ page: number } | null>({ page: 604 });

  beforeEach(() => {
    position.set({ page: 604 });
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: UserDataApi, useValue: { position } }],
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

  it('ReaderUiService.openDoaKhatam navigates to /doa-khatam', () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ReaderUiService).openDoaKhatam();
    expect(nav).toHaveBeenCalledWith(['/doa-khatam']);
  });
});

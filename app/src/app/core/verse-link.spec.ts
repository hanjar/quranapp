import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, provideRouter, RedirectCommand } from '@angular/router';
import { ContentApi } from './contracts';
import { ReaderUiService } from './reader-ui.service';
import { parseLinkNumber, resolveVerseLink, verseLinkRedirect } from './verse-link';

// Surah 59 has 24 ayahs and starts on page 545; 59:3 is on page 545, 59:24 on 548.
const content = {
  surah: (n: number) => ({ number: n, startPage: n === 59 ? 545 : 1, ayahCount: n === 59 ? 24 : 7 }),
  pageOf: (r: { surah: number; ayah: number }) =>
    r.surah === 59 && r.ayah >= 1 && r.ayah <= 24 ? (r.ayah > 20 ? 548 : 545) : null,
} as unknown as ContentApi;

describe('parseLinkNumber', () => {
  it('accepts plain positive integers only', () => {
    expect(parseLinkNumber('59')).toBe(59);
    for (const bad of ['', '0', '-1', '3a', '1e2', '4.5', ' 3', null, undefined, '12345']) {
      expect(parseLinkNumber(bad)).toBeNull();
    }
  });
});

describe('resolveVerseLink', () => {
  it('maps surah/ayah to its page and highlight', () => {
    expect(resolveVerseLink(content, '59', '3')).toEqual({ page: 545, highlight: { surah: 59, ayah: 3 } });
    expect(resolveVerseLink(content, '59', '24')?.page).toBe(548);
  });
  it('maps a bare surah to its first page without highlight', () => {
    expect(resolveVerseLink(content, '59')).toEqual({ page: 545, highlight: null });
  });
  it('rejects out-of-range or malformed numbers', () => {
    expect(resolveVerseLink(content, '115', '1')).toBeNull();
    expect(resolveVerseLink(content, '0')).toBeNull();
    expect(resolveVerseLink(content, '59', '25')).toBeNull();
    expect(resolveVerseLink(content, '59', 'x')).toBeNull();
    expect(resolveVerseLink(content, 'abc')).toBeNull();
  });
});

describe('verseLinkRedirect', () => {
  const run = async (params: Record<string, string>) => {
    const loaded = signal<object | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ContentApi,
          useValue: {
            ...content,
            index: loaded,
            load: async () => loaded.set({}),
          },
        },
      ],
    });
    const snap = { paramMap: convertToParamMap(params) } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => verseLinkRedirect(snap, {} as never));
  };

  it('redirects /59/3 to /hal/545 (replacing history) and highlights the ayah', async () => {
    const r = (await run({ surah: '59', ayah: '3' })) as RedirectCommand;
    expect(r).toBeInstanceOf(RedirectCommand);
    expect(r.redirectTo.toString()).toBe('/hal/545');
    expect(r.navigationBehaviorOptions?.replaceUrl).toBe(true);
    expect(TestBed.inject(ReaderUiService).selectedVerse()).toEqual({ surah: 59, ayah: 3, page: 545 });
  });

  it('redirects a bare surah to its first page without a highlight', async () => {
    const r = (await run({ surah: '59' })) as RedirectCommand;
    expect(r.redirectTo.toString()).toBe('/hal/545');
    expect(TestBed.inject(ReaderUiService).selectedVerse()).toBeNull();
  });

  it('sends an invalid ayah to the resume route', async () => {
    const r = (await run({ surah: '59', ayah: '99' })) as RedirectCommand;
    expect(r.redirectTo.toString()).toBe('/');
    expect(TestBed.inject(ReaderUiService).selectedVerse()).toBeNull();
  });
});

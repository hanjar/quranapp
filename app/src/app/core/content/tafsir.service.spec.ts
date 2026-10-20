import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TafsirService } from './tafsir.service';

function file(n: number) {
  return {
    format: 'mushaf-tafsir',
    version: 1,
    source: { name: 'Tafsir Kemenag RI', origin: 'o', url: 'u', license: 'l', fetchedAt: 'x' },
    surah: n,
    ayahs: { '1': `tafsir ${n}:1`, '2': 'A\n\nB' },
  };
}

class FakeCache {
  map = new Map<string, ArrayBuffer>();
  async put(url: string, res: Response) {
    this.map.set(url, await res.arrayBuffer());
  }
  async match(url: string) {
    const b = this.map.get(url);
    return b ? new Response(b.slice(0)) : undefined;
  }
  async keys() {
    return [...this.map.keys()].map((url) => ({ url }) as Request);
  }
}

describe('TafsirService', () => {
  let svc: TafsirService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let cache: FakeCache;
  let offline: boolean;

  beforeEach(() => {
    offline = false;
    cache = new FakeCache();
    fetchMock = vi.fn(async (url: string) => {
      if (offline) throw new TypeError('offline');
      const m = /tafsir\/(\d+)\.json$/.exec(url);
      if (m) return new Response(JSON.stringify(file(Number(m[1]))));
      if (url.endsWith('index.json')) return new Response(JSON.stringify({ totalBytes: 1234 }));
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { open: async () => cache, delete: async () => true });
    TestBed.configureTestingModule({});
    svc = TestBed.inject(TafsirService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads a surah lazily, caches in memory and sets source', async () => {
    expect(await svc.get({ surah: 3, ayah: 1 })).toBe('tafsir 3:1');
    expect(await svc.get({ surah: 3, ayah: 2 })).toBe('A\n\nB');
    expect(await svc.get({ surah: 3, ayah: 99 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(svc.source()?.name).toBe('Tafsir Kemenag RI');
  });

  it('returns null offline and retries after failure', async () => {
    offline = true;
    expect(await svc.get({ surah: 2, ayah: 1 })).toBeNull();
    offline = false;
    expect(await svc.get({ surah: 2, ayah: 1 })).toBe('tafsir 2:1');
  });

  it('rejects a file for the wrong surah', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(file(9))));
    expect(await svc.get({ surah: 5, ayah: 1 })).toBeNull();
  });

  it('downloadAll fills the cache, reports progress and works offline afterwards', async () => {
    expect(await svc.isAllCached()).toBe(false);
    const progress: number[] = [];
    const r = await svc.downloadAll((d) => progress.push(d));
    expect(r).toEqual({ ok: 114, failed: 0 });
    expect(progress.at(-1)).toBe(114);
    expect(await svc.isAllCached()).toBe(true);
    const info = await svc.sizeInfo();
    expect(info.cachedSurahs).toBe(114);
    expect(info.totalBytes).toBe(1234);
    expect(info.cachedBytes).toBeGreaterThan(0);

    TestBed.resetTestingModule();
    const fresh = TestBed.inject(TafsirService);
    offline = true;
    expect(await fresh.get({ surah: 7, ayah: 1 })).toBe('tafsir 7:1');
  });

  it('downloadAll counts failures', async () => {
    vi.useFakeTimers();
    offline = true;
    const p = svc.downloadAll();
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: 0, failed: 114 });
    vi.useRealTimers();
  });
});

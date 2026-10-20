import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ContentApi } from '../contracts';
import { ContentIndex } from '../models';
import { buildFixture, FakeCacheStorage, Fixture } from '../content/testing';
import { AUDIO_MANIFEST_URL, AudioManifest, audioFileUrl } from './audio-offline.api';
import { AudioOfflineService, audioCacheName } from './audio-offline.service';

describe('AudioOfflineService', () => {
  let fx: Fixture;
  let svc: AudioOfflineService;
  let store: FakeCacheStorage;
  let manifest: AudioManifest;
  let sizeOverride: Map<number, number>;
  let requests: string[];
  let manifestFails: boolean;
  let realFetch: typeof fetch;
  let realCaches: unknown;
  let opus = true;
  let blobSeq = 0;
  const revoked: string[] = [];

  const total = () => fx.surahs.length * 12;
  const g = (surah: number, ayah: number) => (surah - 1) * 12 + ayah;

  const makeManifest = (): AudioManifest => {
    const bytes = Array.from({ length: total() }, (_, i) => 50 + (i % 7));
    const v = (ext: string, mime: string, kbps: number) => ({
      label: ext,
      ext,
      mime,
      kbps,
      totalBytes: bytes.reduce((a, b) => a + b, 0),
      bytes,
    });
    return {
      format: 'mushaf-audio',
      version: 1,
      qari: { id: 'alafasy', name: 'x', source: 'x', license: 'x', builtAt: 'x' },
      variants: {
        opus24: v('webm', 'audio/webm', 24),
        opus32: v('webm', 'audio/webm', 32),
        mp364: v('mp3', 'audio/mpeg', 64),
      },
      ayahCount: total(),
    };
  };

  const create = () => {
    TestBed.resetTestingModule();
    const index = signal<ContentIndex | null>({
      edition: fx.edition,
      surahs: fx.surahs,
      pages: fx.pages,
      juz: fx.juz,
    });
    TestBed.configureTestingModule({
      providers: [{ provide: ContentApi, useValue: { index, load: async () => undefined } }],
    });
    svc = TestBed.inject(AudioOfflineService);
  };

  beforeAll(async () => {
    fx = await buildFixture();
  });

  beforeEach(() => {
    localStorage.clear();
    opus = true;
    blobSeq = 0;
    revoked.length = 0;
    requests = [];
    manifestFails = false;
    sizeOverride = new Map();
    manifest = makeManifest();
    store = new FakeCacheStorage();
    realFetch = globalThis.fetch;
    realCaches = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = store;
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(() =>
      opus ? 'probably' : '',
    );
    URL.createObjectURL = vi.fn(() => 'blob:test-' + ++blobSeq);
    URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === AUDIO_MANIFEST_URL) {
        if (manifestFails) throw new TypeError('offline');
        return new Response(JSON.stringify(manifest));
      }
      const m = /\/(opus24|opus32|mp364)\/(\d{3})(\d{3})\./.exec(url)!;
      const gi = g(Number(m[2]), Number(m[3]));
      const size = sizeOverride.get(gi) ?? manifest.variants[m[1] as 'opus24'].bytes[gi - 1];
      return new Response(new Uint8Array(size));
    }) as typeof fetch;
    create();
  });

  afterEach(async () => {
    await svc.idle();
    globalThis.fetch = realFetch;
    (globalThis as { caches?: unknown }).caches = realCaches;
    vi.restoreAllMocks();
  });

  it('defaults to mp364 when opus is unsupported and ignores a stored unsupported variant', () => {
    opus = false;
    localStorage.setItem('mf-audio-variant', 'opus32');
    create();
    expect(svc.supported()).toEqual(['mp364']);
    expect(svc.variant()).toBe('mp364');
  });

  it('defaults to opus24 when supported and honours a stored supported variant', () => {
    expect(svc.supported()).toEqual(['opus24', 'opus32', 'mp364']);
    expect(svc.variant()).toBe('opus24');
    localStorage.setItem('mf-audio-variant', 'mp364');
    create();
    expect(svc.variant()).toBe('mp364');
  });

  it('expands scopes: surah, juz (incl. last juz) and all', async () => {
    await svc.load();
    expect(svc.progressOf({ kind: 'surah', id: 5 })).toEqual({ done: 0, total: 12 });
    expect(svc.progressOf({ kind: 'all' }).total).toBe(total());
    const starts = fx.juz.map((j) => g(j.start.surah, j.start.ayah));
    expect(svc.progressOf({ kind: 'juz', id: 1 }).total).toBe(starts[1] - starts[0]);
    expect(svc.progressOf({ kind: 'juz', id: 29 }).total).toBe(starts[29] - starts[28]);
    expect(svc.progressOf({ kind: 'juz', id: 30 }).total).toBe(total() - starts[29] + 1);
    const sum = Array.from(
      { length: 30 },
      (_, i) => svc.progressOf({ kind: 'juz', id: i + 1 }).total,
    );
    expect(sum.reduce((a, b) => a + b, 0)).toBe(total());
    expect(svc.sizeOf({ kind: 'surah', id: 1 }, 'mp364')).toBe(
      manifest.variants.mp364.bytes.slice(0, 12).reduce((a, b) => a + b, 0),
    );
  });

  it('downloads the last juz up to the final ayah', async () => {
    await svc.load();
    await svc.download({ kind: 'juz', id: 30 });
    const s = svc.status();
    expect(s.state).toBe('done');
    expect(s.done).toBe(s.total);
    expect(requests.filter((u) => u.includes('/opus24/')).length).toBe(s.total);
    expect(requests).toContain(audioFileUrl('opus24', 'webm', { surah: 114, ayah: 12 }));
    expect(svc.perSurah()[113]).toBe(12);
  });

  it('also stores 1:1 as basmalah for scopes beyond surah 1 and 9, without removing it with other surahs', async () => {
    await svc.load();
    await svc.download({ kind: 'surah', id: 9 });
    expect(svc.status().total).toBe(12);
    expect(svc.progressOf({ kind: 'surah', id: 1 }).done).toBe(0);
    await svc.download({ kind: 'surah', id: 3 });
    expect(svc.status()).toMatchObject({ state: 'done', done: 13, total: 13, failed: 0 });
    expect(svc.status().bytesTotal).toBe(svc.sizeOf({ kind: 'surah', id: 3 }) + manifest.variants.opus24.bytes[0]);
    expect(await svc.localUrl({ surah: 1, ayah: 1 })).toMatch(/^blob:/);
    expect(svc.perSurah()[0]).toBe(1);
    await svc.remove({ kind: 'surah', id: 3 });
    expect(svc.perSurah()[0]).toBe(1);
    await svc.remove({ kind: 'surah', id: 1 });
    expect(svc.perSurah()[0]).toBe(0);
    // surah 1 scope itself has no extra file
    await svc.download({ kind: 'surah', id: 1 });
    expect(svc.status().total).toBe(12);
    await svc.remove({ kind: 'all' });
    await svc.download({ kind: 'all' });
    expect(svc.status().total).toBe(total());
  });

  it('stores a surah, tracks perSurah/usedBytes incrementally and keys by audioFileUrl', async () => {
    await svc.load();
    await svc.download({ kind: 'surah', id: 3 });
    expect(svc.status()).toMatchObject({ state: 'done', done: 13, total: 13, failed: 0 }); // + basmalah 1:1
    expect(svc.perSurah()[2]).toBe(12);
    expect(svc.perSurah().reduce((a, b) => a + b, 0)).toBe(13);
    expect(svc.usedBytes()).toBe(svc.sizeOf({ kind: 'surah', id: 3 }) + manifest.variants.opus24.bytes[0]);
    expect(svc.status().bytesDone).toBe(svc.status().bytesTotal);
    const cache = await store.open(audioCacheName('opus24'));
    expect((await cache.keys()).map((r) => r.url)).toContain(
      audioFileUrl('opus24', 'webm', { surah: 3, ayah: 1 }),
    );
    expect(svc.progressOf({ kind: 'surah', id: 3 }).done).toBe(12);
  });

  it('scans existing cache keys once on load() to compute perSurah', async () => {
    const cache = await store.open(audioCacheName('opus24'));
    for (const [s, a] of [
      [1, 1],
      [1, 2],
      [7, 3],
    ]) {
      await cache.put(
        audioFileUrl('opus24', 'webm', { surah: s, ayah: a }),
        new Response(new Uint8Array(1)),
      );
    }
    await svc.load();
    expect(svc.perSurah()[0]).toBe(2);
    expect(svc.perSurah()[6]).toBe(1);
    expect(svc.usedBytes()).toBe(
      manifest.variants.opus24.bytes[g(1, 1) - 1] +
        manifest.variants.opus24.bytes[g(1, 2) - 1] +
        manifest.variants.opus24.bytes[g(7, 3) - 1],
    );
  });

  it('rejects files whose size differs from the manifest (not stored, counted failed)', async () => {
    await svc.load();
    sizeOverride.set(g(2, 4), 3);
    await svc.download({ kind: 'surah', id: 2 });
    expect(svc.status()).toMatchObject({ state: 'error', failed: 1, done: 12 }); // 11 + basmalah
    const cache = await store.open(audioCacheName('opus24'));
    expect((await cache.keys()).length).toBe(12);
    // retry only the missing one
    sizeOverride.clear();
    requests.length = 0;
    await svc.resume();
    expect(requests.length).toBe(1);
    expect(svc.status().state).toBe('done');
  });

  it('rejects a Content-Length that disagrees with the manifest', async () => {
    await svc.load();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === AUDIO_MANIFEST_URL) return new Response(JSON.stringify(manifest));
      const m = /(\d{3})(\d{3})\./.exec(url)!;
      const size = manifest.variants.opus24.bytes[g(Number(m[1]), Number(m[2])) - 1];
      return new Response(new Uint8Array(size), {
        headers: { 'Content-Length': String(size + 1) },
      });
    }) as typeof fetch;
    await svc.download({ kind: 'surah', id: 1 });
    expect(svc.status()).toMatchObject({ state: 'error', failed: 12, done: 0 });
  });

  it('pauses and resumes without refetching stored files', async () => {
    await svc.load();
    const run = svc.download({ kind: 'surah', id: 9 });
    svc.pause();
    await run;
    expect(svc.status().state).toBe('paused');
    const have = svc.status().done;
    expect(have).toBeLessThan(12);
    requests.length = 0;
    await svc.resume();
    expect(svc.status().state).toBe('done');
    expect(requests.length).toBe(12 - have);
  });

  it('enters quota state on QuotaExceededError', async () => {
    await svc.load();
    (await store.open(audioCacheName('opus24'))).putError = new DOMException(
      'full',
      'QuotaExceededError',
    );
    await svc.download({ kind: 'surah', id: 4 });
    expect(svc.status().state).toBe('quota');
  });

  it('setVariant switches, persists and deletes the other variants caches', async () => {
    await svc.load();
    await svc.download({ kind: 'surah', id: 1 });
    await store.open(audioCacheName('mp364'));
    await svc.setVariant('mp364');
    expect(svc.variant()).toBe('mp364');
    expect(localStorage.getItem('mf-audio-variant')).toBe('mp364');
    expect(await store.keys()).not.toContain(audioCacheName('opus24'));
    expect(svc.perSurah().every((n) => n === 0)).toBe(true);
    expect(svc.usedBytes()).toBe(0);
    await svc.download({ kind: 'surah', id: 1 });
    expect(requests.some((u) => u.includes('/mp364/001001.mp3'))).toBe(true);
    expect(svc.perSurah()[0]).toBe(12);
    // unsupported variant is ignored
    opus = false;
    create();
    await svc.setVariant('opus32');
    expect(svc.variant()).toBe('mp364');
  });

  it('remove(surah) updates counts; remove(all) wipes every variant', async () => {
    await svc.load();
    await svc.download({ kind: 'surah', id: 1 });
    await svc.download({ kind: 'surah', id: 2 });
    await svc.remove({ kind: 'surah', id: 1 });
    expect(svc.perSurah()[0]).toBe(0);
    expect(svc.perSurah()[1]).toBe(12);
    expect(svc.usedBytes()).toBe(svc.sizeOf({ kind: 'surah', id: 2 }));
    await store.open(audioCacheName('mp364'));
    await svc.remove({ kind: 'all' });
    expect(svc.usedBytes()).toBe(0);
    expect((await store.keys()).filter((k) => k.startsWith('mushaf-audio-alafasy-'))).toEqual([]);
  });

  it('localUrl returns object URLs, reuses them and revokes beyond 8', async () => {
    await svc.load();
    await svc.download({ kind: 'surah', id: 1 });
    expect(await svc.localUrl({ surah: 2, ayah: 1 })).toBeNull();
    const first = await svc.localUrl({ surah: 1, ayah: 1 });
    expect(first).toMatch(/^blob:/);
    expect(await svc.localUrl({ surah: 1, ayah: 1 })).toBe(first);
    for (let a = 2; a <= 10; a++) await svc.localUrl({ surah: 1, ayah: a });
    // 10 distinct urls requested, cap 8 -> two oldest revoked
    expect(revoked.length).toBe(2);
    expect(revoked[0]).toBe(first);
  });

  it('caches the manifest for offline use and reports Indonesian errors', async () => {
    await svc.load();
    expect(svc.manifest()).not.toBeNull();
    expect(await store.keys()).toContain('mushaf-audio-meta');
    manifestFails = true;
    create();
    await svc.load();
    expect(svc.manifest()).not.toBeNull();
    expect(svc.loadError()).toBeNull();

    // nothing cached + offline
    store.stores.delete('mushaf-audio-meta');
    create();
    await svc.load();
    expect(svc.manifest()).toBeNull();
    expect(svc.loadError()).toMatch(/Periksa koneksi/);

    // invalid shape
    manifestFails = false;
    manifest = { ...manifest, version: 2 } as unknown as AudioManifest;
    create();
    await svc.load();
    expect(svc.manifest()).toBeNull();
    expect(svc.loadError()).toMatch(/tidak valid/);
  });
});

/** Test-only fixtures: synthetic content, fake fetch and fake Cache Storage. Not imported by app code. */
import { ContentManifest, Edition, JuzMeta, PageMeta, SurahMeta } from '../models';
import { pageCacheName, pageFileKey, sha256Hex } from './page-cache';

export const TEST_VERSION = 'testv1';
const AYAH_PER_SURAH = 12;

export function svgFor(page: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 345 550"><path class="ayahPolygon" surah="1" ayah="1" id="p${page}" d="M0 0Z"/></svg>`;
}

export interface Fixture {
  edition: Edition;
  surahs: SurahMeta[];
  pages: PageMeta[];
  juz: JuzMeta[];
  manifest: ContentManifest;
  svg: Map<number, string>;
}

export async function buildFixture(): Promise<Fixture> {
  const surahs: SurahMeta[] = Array.from({ length: 114 }, (_, i) => ({
    number: i + 1,
    nameArabic: 'س',
    nameLatin: `Surah ${i + 1}`,
    nameEnglish: `Surah ${i + 1}`,
    ayahCount: AYAH_PER_SURAH,
    startPage: 1,
    endPage: 1,
    juz: 1,
  }));
  const flat: { surah: number; ayah: number }[] = [];
  for (let s = 1; s <= 114; s++) for (let a = 1; a <= AYAH_PER_SURAH; a++) flat.push({ surah: s, ayah: a });
  const n = flat.length;
  const pages: PageMeta[] = Array.from({ length: 604 }, (_, i) => {
    const from = Math.floor((i * n) / 604);
    const to = Math.max(from, Math.floor(((i + 1) * n) / 604) - 1);
    return {
      page: i + 1,
      first: flat[from],
      last: flat[Math.min(to, n - 1)],
      surahs: [flat[from].surah],
      juz: Math.min(30, Math.floor(i / 20.2) + 1),
      juzStarts: [],
    };
  });
  // A verse spanning pages 10 → 11.
  pages[9] = { ...pages[9], last: pages[10].first };
  const juz: JuzMeta[] = Array.from({ length: 30 }, (_, i) => ({
    number: i + 1,
    start: pages[Math.min(603, Math.round(i * 20.2))].first,
    page: Math.min(604, Math.round(i * 20.2) + 1),
  }));
  const svg = new Map<number, string>();
  const files: ContentManifest['files'] = {};
  let total = 0;
  const enc = new TextEncoder();
  for (let p = 1; p <= 604; p++) {
    const text = svgFor(p);
    svg.set(p, text);
    const bytes = enc.encode(text);
    files[pageFileKey(p)] = { sha256: await sha256Hex(bytes.buffer as ArrayBuffer), bytes: bytes.length };
    total += bytes.length;
  }
  const edition: Edition = {
    editionId: 'hafs-kfqc',
    riwayah: 'hafs',
    pageCount: 604,
    contentVersion: TEST_VERSION,
    source: { repo: 'x', commit: 'y', path: 'z' },
    license: { artwork: 'a', metadata: 'm' },
    attribution: '',
  };
  return {
    edition,
    surahs,
    pages,
    juz,
    manifest: { editionId: 'hafs-kfqc', contentVersion: TEST_VERSION, files, totalBytes: total },
    svg,
  };
}

// ---- Fake Cache Storage ------------------------------------------------------

class FakeCache {
  readonly entries = new Map<string, { buf: ArrayBuffer; headers: Headers }>();
  putError: unknown = null;

  async put(req: string | Request, res: Response): Promise<void> {
    if (this.putError) throw this.putError;
    this.entries.set(typeof req === 'string' ? req : req.url, {
      buf: await res.arrayBuffer(),
      headers: res.headers,
    });
  }
  async match(req: string | Request): Promise<Response | undefined> {
    const e = this.entries.get(typeof req === 'string' ? req : req.url);
    return e ? new Response(e.buf.slice(0), { headers: e.headers }) : undefined;
  }
  async delete(req: string | Request): Promise<boolean> {
    return this.entries.delete(typeof req === 'string' ? req : req.url);
  }
  async keys(): Promise<Request[]> {
    return Array.from(this.entries.keys(), (url) => ({ url }) as Request);
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.stores.get(name);
    if (!c) this.stores.set(name, (c = new FakeCache()));
    return c;
  }
  async keys(): Promise<string[]> {
    return Array.from(this.stores.keys());
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  cache(version = TEST_VERSION): FakeCache {
    const name = pageCacheName(version);
    let c = this.stores.get(name);
    if (!c) this.stores.set(name, (c = new FakeCache()));
    return c;
  }
}

// ---- Fake network -----------------------------------------------------------

export interface FakeWeb {
  fixture: Fixture;
  caches: FakeCacheStorage;
  /** URLs requested via fetch, in order. */
  requests: string[];
  /** page → replacement body (to simulate tampering). */
  tamper: Map<number, string>;
  /** page → HTTP status override. */
  status: Map<number, number>;
  failMetadata: boolean;
  throwNetwork: boolean;
  restore: () => void;
}

export function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

export function installFakeWeb(fixture: Fixture): FakeWeb {
  const realFetch = globalThis.fetch;
  const realCaches = (globalThis as { caches?: unknown }).caches;
  const web: FakeWeb = {
    fixture,
    caches: new FakeCacheStorage(),
    requests: [],
    tamper: new Map(),
    status: new Map(),
    failMetadata: false,
    throwNetwork: false,
    restore: () => {
      globalThis.fetch = realFetch;
      (globalThis as { caches?: unknown }).caches = realCaches;
      setOnline(true);
    },
  };
  (globalThis as { caches?: unknown }).caches = web.caches;
  setOnline(true);
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    web.requests.push(url);
    if (web.throwNetwork) throw new TypeError('Failed to fetch');
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (/\/(edition|surahs|pages|juz|manifest)\.json$/.test(url) && web.failMetadata) {
      return new Response('x', { status: 500 });
    }
    if (url.endsWith('/edition.json')) return json(fixture.edition);
    if (url.endsWith('/surahs.json')) return json(fixture.surahs);
    if (url.endsWith('/pages.json')) return json(fixture.pages);
    if (url.endsWith('/juz.json')) return json(fixture.juz);
    if (url.endsWith('/manifest.json')) return json(fixture.manifest);
    const m = /svg\/(\d{3})\.svg/.exec(url);
    if (m) {
      const page = Number(m[1]);
      const status = web.status.get(page);
      if (status) return new Response('', { status });
      return new Response(web.tamper.get(page) ?? fixture.svg.get(page)!, { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return web;
}

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ContentApi } from '../contracts';
import { AyahRef } from '../models';
import { globalAyahNumber } from './audio-logic';
import {
  AUDIO_MANIFEST_URL,
  AudioDownloadStatus,
  AudioManifest,
  AudioOfflineApi,
  AudioScope,
  AudioVariant,
  audioFileUrl,
} from './audio-offline.api';

const CONCURRENCY = 4;
const OBJECT_URL_LRU = 8;
const META_CACHE = 'mushaf-audio-meta';
const CACHE_PREFIX = 'mushaf-audio-alafasy-';
const VARIANTS: AudioVariant[] = ['opus24', 'opus32', 'mp364'];
const STORAGE_KEY = 'mf-audio-variant';

export const audioCacheName = (v: AudioVariant) => `${CACHE_PREFIX}${v}`;

const isQuota = (e: unknown) => {
  const x = e as { name?: string; code?: number } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.code === 22);
};

const IDLE: AudioDownloadStatus = {
  state: 'idle',
  scope: null,
  done: 0,
  total: 0,
  bytesDone: 0,
  bytesTotal: 0,
  failed: 0,
};

function canPlayOpus(): boolean {
  try {
    return document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== '';
  } catch {
    return false;
  }
}

function readStoredVariant(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function validateAudioManifest(m: unknown, ayahTotal: number): AudioManifest {
  const bad = (): never => {
    throw new Error('Data audio tidak valid. Coba lagi nanti.');
  };
  const x = m as Partial<AudioManifest> | null;
  if (!x || x.format !== 'mushaf-audio' || x.version !== 1 || !x.variants) return bad();
  if (x.ayahCount !== ayahTotal) {
    throw new Error('Data audio tidak cocok dengan data mushaf.');
  }
  for (const v of VARIANTS) {
    const e = x.variants[v];
    if (
      !e ||
      typeof e.ext !== 'string' ||
      typeof e.mime !== 'string' ||
      !Array.isArray(e.bytes) ||
      e.bytes.length !== ayahTotal ||
      e.bytes.some((b) => !Number.isFinite(b) || b <= 0)
    ) {
      return bad();
    }
  }
  return x as AudioManifest;
}

@Injectable({ providedIn: 'root' })
export class AudioOfflineService extends AudioOfflineApi {
  private readonly content = inject(ContentApi);

  private readonly _manifest = signal<AudioManifest | null>(null);
  readonly manifest = this._manifest.asReadonly();
  /** Indonesian message when the manifest could not be loaded/validated (extra to the contract). */
  readonly loadError = signal<string | null>(null);

  readonly supported = signal<AudioVariant[]>(
    canPlayOpus() ? ['opus24', 'opus32', 'mp364'] : ['mp364'],
  ).asReadonly();

  private readonly _variant = signal<AudioVariant>(this.initialVariant());
  readonly variant = this._variant.asReadonly();

  private readonly _status = signal<AudioDownloadStatus>({ ...IDLE });
  readonly status = this._status.asReadonly();

  private readonly _perSurah = signal<number[]>(new Array(114).fill(0));
  readonly perSurah = this._perSurah.asReadonly();
  private readonly _usedBytes = signal(0);
  readonly usedBytes = this._usedBytes.asReadonly();

  /** Stored global ayah numbers for the current variant. */
  private have = new Set<number>();
  private counts: number[] = new Array(114).fill(0);
  private runToken = 0;
  private paused = false;
  private active: Promise<void> | null = null;
  private lastScope: AudioScope | null = null;
  private loading: Promise<void> | null = null;
  private readonly urls = new Map<string, string>();
  private readonly abort = new AbortController();

  readonly anyDownloaded = computed(() => this._usedBytes() > 0);

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => this.pause(), { signal: this.abort.signal });
    }
    inject(DestroyRef).onDestroy(() => {
      this.abort.abort();
      this.runToken++;
      for (const u of this.urls.values()) this.revoke(u);
      this.urls.clear();
    });
  }

  private initialVariant(): AudioVariant {
    const sup = this.supported();
    const stored = readStoredVariant();
    if (stored && (sup as string[]).includes(stored)) return stored as AudioVariant;
    return sup[0] === 'opus24' ? 'opus24' : 'mp364';
  }

  // ---- geometry ------------------------------------------------------------

  private ayahCounts(): number[] {
    const idx = this.content.index();
    if (!idx) throw new Error('Konten belum dimuat');
    return idx.surahs.map((s) => s.ayahCount);
  }

  private refOf(g: number): AyahRef {
    const counts = this.ayahCounts();
    let rest = g;
    for (let s = 0; s < counts.length; s++) {
      if (rest <= counts[s]) return { surah: s + 1, ayah: rest };
      rest -= counts[s];
    }
    throw new RangeError('Nomor ayat tidak valid');
  }

  /** Inclusive global range of a scope. */
  private range(scope: AudioScope): [number, number] {
    const counts = this.ayahCounts();
    const total = counts.reduce((a, b) => a + b, 0);
    if (scope.kind === 'all') return [1, total];
    if (scope.kind === 'surah') {
      const from = globalAyahNumber({ surah: scope.id, ayah: 1 }, counts);
      return [from, from + counts[scope.id - 1] - 1];
    }
    const juz = this.content.index()!.juz;
    const start = juz[scope.id - 1].start;
    const from = globalAyahNumber(start, counts);
    const next = juz[scope.id];
    return [from, next ? globalAyahNumber(next.start, counts) - 1 : total];
  }

  private bytesOfRange(from: number, to: number, v: AudioVariant): number {
    const bytes = this._manifest()?.variants[v].bytes;
    if (!bytes) return 0;
    let sum = 0;
    for (let g = from; g <= to; g++) sum += bytes[g - 1] ?? 0;
    return sum;
  }

  sizeOf(scope: AudioScope, variant: AudioVariant = this._variant()): number {
    const [a, b] = this.range(scope);
    return this.bytesOfRange(a, b, variant);
  }

  progressOf(scope: AudioScope): { done: number; total: number } {
    const [a, b] = this.range(scope);
    let done = 0;
    for (let g = a; g <= b; g++) if (this.have.has(g)) done++;
    return { done, total: b - a + 1 };
  }

  // ---- load / scan -----------------------------------------------------------

  load(): Promise<void> {
    this.loading ??= this.doLoad().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    await this.content.load();
    const total = this.ayahCounts().reduce((a, b) => a + b, 0);
    let manifest: AudioManifest | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(AUDIO_MANIFEST_URL);
      if (!res.ok) throw new Error('http');
      const json: unknown = await res.json();
      manifest = validateAudioManifest(json, total);
      try {
        const meta = await caches.open(META_CACHE);
        await meta.put(AUDIO_MANIFEST_URL, new Response(JSON.stringify(json)));
      } catch {
        /* cache unavailable */
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Data audio')) error = e.message;
      try {
        const hit = await (await caches.open(META_CACHE)).match(AUDIO_MANIFEST_URL);
        if (hit) manifest = validateAudioManifest(await hit.json(), total);
      } catch {
        manifest = null;
      }
      if (!manifest && !error) {
        error = 'Data audio tidak dapat dimuat. Periksa koneksi internet.';
      }
    }
    this._manifest.set(manifest);
    this.loadError.set(manifest ? null : error);
    await this.scan();
  }

  /** One full scan of the current variant's cache keys; afterwards updated incrementally. */
  private async scan(): Promise<void> {
    this.have = new Set();
    try {
      const cache = await caches.open(audioCacheName(this._variant()));
      const counts = this.ayahCounts();
      for (const req of await cache.keys()) {
        const m = /(\d{3})(\d{3})\.\w+$/.exec(req.url);
        if (!m) continue;
        const ref = { surah: Number(m[1]), ayah: Number(m[2]) };
        if (ref.surah < 1 || ref.surah > 114 || ref.ayah < 1 || ref.ayah > counts[ref.surah - 1])
          continue;
        this.have.add(globalAyahNumber(ref, counts));
      }
    } catch {
      /* no Cache Storage */
    }
    this.rebuildCounts();
  }

  private rebuildCounts(): void {
    this.counts = new Array(114).fill(0);
    let bytes = 0;
    const sizes = this._manifest()?.variants[this._variant()].bytes;
    for (const g of this.have) {
      this.counts[this.refOf(g).surah - 1]++;
      bytes += sizes?.[g - 1] ?? 0;
    }
    this._perSurah.set([...this.counts]);
    this._usedBytes.set(bytes);
  }

  private markStored(g: number): void {
    if (this.have.has(g)) return;
    this.have.add(g);
    this.counts[this.refOf(g).surah - 1]++;
    this._perSurah.set([...this.counts]);
    this._usedBytes.update(
      (b) => b + (this._manifest()?.variants[this._variant()].bytes[g - 1] ?? 0),
    );
  }

  private markRemoved(g: number): void {
    if (!this.have.delete(g)) return;
    this.counts[this.refOf(g).surah - 1]--;
    this._perSurah.set([...this.counts]);
    this._usedBytes.update((b) =>
      Math.max(0, b - (this._manifest()?.variants[this._variant()].bytes[g - 1] ?? 0)),
    );
  }

  // ---- variant ---------------------------------------------------------------

  async setVariant(v: AudioVariant): Promise<void> {
    if (!(this.supported() as string[]).includes(v) || v === this._variant()) return;
    await this.stopRun();
    try {
      for (const other of VARIANTS) if (other !== v) await caches.delete(audioCacheName(other));
    } catch {
      /* ignore */
    }
    this._variant.set(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
    this.revokeAll();
    this._status.set({ ...IDLE });
    await this.scan();
  }

  // ---- download --------------------------------------------------------------

  download(scope: AudioScope): Promise<void> {
    this.lastScope = scope;
    return this.start(scope);
  }

  resume(): Promise<void> {
    return this.lastScope ? this.start(this.lastScope) : Promise.resolve();
  }

  pause(): void {
    if (!this.active) return;
    this.paused = true;
    this._status.update((s) => ({ ...s, state: 'paused' }));
  }

  private async stopRun(): Promise<void> {
    this.runToken++;
    this.paused = false;
    if (this.active) await this.active.catch(() => undefined);
  }

  private start(scope: AudioScope): Promise<void> {
    if (this.active && !this.paused) return this.active;
    const prev = this.active;
    this.paused = false;
    const token = ++this.runToken;
    const run = (async () => {
      if (prev) await prev.catch(() => undefined);
      await this.run(scope, token);
    })();
    this.active = run;
    const clear = () => {
      if (this.active === run) this.active = null;
    };
    run.then(clear, clear);
    return run;
  }

  private async run(scope: AudioScope, token: number): Promise<void> {
    const live = () => token === this.runToken;
    if (!this._manifest()) await this.load();
    const manifest = this._manifest();
    if (!manifest || !live()) {
      if (live()) this._status.set({ ...IDLE, scope, state: 'error' });
      return;
    }
    const variant = this._variant();
    const entry = manifest.variants[variant];
    const [from, to] = this.range(scope);
    // Playback uses 1:1 as the basmalah before ayah 1 of every surah except 1 and 9.
    const lastSurah = this.refOf(to).surah;
    let needsBasmalah = false;
    for (let s = this.refOf(from).surah; s <= lastSurah; s++) if (s !== 1 && s !== 9) needsBasmalah = true;
    const extra = needsBasmalah && from > 1; // 1:1 is global ayah 1, so it is in scope iff from === 1
    const total = to - from + 1 + (extra ? 1 : 0);
    const bytesTotal = this.bytesOfRange(from, to, variant) + (extra ? this.bytesOfRange(1, 1, variant) : 0);
    const queue: number[] = [];
    if (extra && !this.have.has(1)) queue.push(1);
    for (let g = from; g <= to; g++) if (!this.have.has(g)) queue.push(g);
    let failed = 0;
    const publish = (state: AudioDownloadStatus['state']) => {
      const p = this.progressOf(scope);
      const missing = this.missingBytes(from, to, variant) + (extra && !this.have.has(1) ? this.bytesOfRange(1, 1, variant) : 0);
      this._status.set({
        state,
        scope,
        done: p.done + (extra && this.have.has(1) ? 1 : 0),
        total,
        bytesDone: bytesTotal - missing,
        bytesTotal,
        failed,
      });
    };
    let endState: AudioDownloadStatus['state'] | null = null;
    let wentOffline = false;
    publish(this.paused ? 'paused' : 'downloading');

    let cache: Cache;
    try {
      cache = await caches.open(audioCacheName(variant));
    } catch {
      publish('error');
      return;
    }
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* best effort */
    }

    const worker = async (): Promise<void> => {
      while (live() && !this.paused && !wentOffline && endState === null) {
        const g = queue.shift();
        if (g === undefined) return;
        const ref = this.refOf(g);
        const url = audioFileUrl(variant, entry.ext, ref);
        try {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            queue.unshift(g);
            wentOffline = true;
            continue;
          }
          let res: Response;
          try {
            res = await fetch(url);
          } catch {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              queue.unshift(g);
              wentOffline = true;
              continue;
            }
            failed++;
            continue;
          }
          const expected = entry.bytes[g - 1];
          const header = res.headers.get('Content-Length');
          if (!res.ok || (header !== null && Number(header) !== expected)) {
            failed++;
            continue;
          }
          const buf = await res.arrayBuffer();
          if (buf.byteLength !== expected) {
            failed++;
            continue;
          }
          await cache.put(url, new Response(buf, { headers: { 'Content-Type': entry.mime } }));
          if (live()) this.markStored(g);
        } catch (e) {
          if (isQuota(e)) endState = 'quota';
          else failed++;
        } finally {
          if (live()) publish(this.paused ? 'paused' : 'downloading');
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!live()) return;
    if (wentOffline) this.paused = true;
    const missing = this.progressOf(scope).done < to - from + 1 || (extra && !this.have.has(1));
    const state: AudioDownloadStatus['state'] =
      endState ?? (this.paused ? 'paused' : failed > 0 || missing ? 'error' : 'done');
    publish(state);
  }

  private missingBytes(from: number, to: number, v: AudioVariant): number {
    const bytes = this._manifest()?.variants[v].bytes;
    if (!bytes) return 0;
    let sum = 0;
    for (let g = from; g <= to; g++) if (!this.have.has(g)) sum += bytes[g - 1];
    return sum;
  }

  // ---- remove ------------------------------------------------------------------

  async remove(scope: AudioScope): Promise<void> {
    await this.stopRun();
    this.revokeAll();
    try {
      if (scope.kind === 'all') {
        for (const v of VARIANTS) await caches.delete(audioCacheName(v));
        this.have = new Set();
        this.rebuildCounts();
      } else {
        const [from, to] = this.range(scope);
        const variant = this._variant();
        const ext = this._manifest()?.variants[variant].ext ?? this.extFallback(variant);
        const cache = await caches.open(audioCacheName(variant));
        for (let g = from; g <= to; g++) {
          if (!this.have.has(g)) continue;
          await cache.delete(audioFileUrl(variant, ext, this.refOf(g)));
          this.markRemoved(g);
        }
      }
    } catch {
      await this.scan();
    }
    this._status.set({ ...IDLE });
  }

  private extFallback(v: AudioVariant): string {
    return v === 'mp364' ? 'mp3' : 'webm';
  }

  // ---- playback -----------------------------------------------------------------

  async localUrl(ref: AyahRef): Promise<string | null> {
    const idx = this.content.index();
    if (!idx) return null;
    const g = globalAyahNumber(
      ref,
      idx.surahs.map((s) => s.ayahCount),
    );
    if (!this.have.has(g)) return null;
    const variant = this._variant();
    const ext = this._manifest()?.variants[variant].ext ?? this.extFallback(variant);
    const url = audioFileUrl(variant, ext, ref);
    const known = this.urls.get(url);
    if (known) {
      this.urls.delete(url);
      this.urls.set(url, known);
      return known;
    }
    try {
      const hit = await (await caches.open(audioCacheName(variant))).match(url);
      if (!hit) return null;
      const obj = URL.createObjectURL(await hit.blob());
      this.urls.set(url, obj);
      while (this.urls.size > OBJECT_URL_LRU) {
        const [oldKey, oldUrl] = this.urls.entries().next().value as [string, string];
        this.urls.delete(oldKey);
        this.revoke(oldUrl);
      }
      return obj;
    } catch {
      return null;
    }
  }

  private revoke(u: string): void {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }

  private revokeAll(): void {
    for (const u of this.urls.values()) this.revoke(u);
    this.urls.clear();
  }

  /** Resolves when any in-flight download has stopped (tests / teardown). */
  async idle(): Promise<void> {
    while (this.active) await this.active.catch(() => undefined);
  }
}

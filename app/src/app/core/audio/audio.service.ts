import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ContentApi } from '../contracts';
import { AyahRef } from '../models';
import { ReaderUiService } from '../reader-ui.service';
import { AudioOfflineApi } from './audio-offline.api';
import {
  AudioMode,
  QARI,
  globalAyahNumber,
  needsBasmalah,
  nextAyah,
  prevAyah,
  shouldContinue,
} from './audio-logic';

export type AudioState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

const MODE_KEY = 'mf-audio-mode';
const FOLLOW_KEY = 'mf-audio-follow';

/**
 * Verse-by-verse recitation (streamed; recordings are one file per ayah, so the
 * highlighted ayah always matches what is heard). Owned by the orchestrator;
 * UI reads the signals and calls the methods below.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private readonly content = inject(ContentApi);
  private readonly ui = inject(ReaderUiService);
  private readonly router = inject(Router);
  private readonly offline = inject(AudioOfflineApi);

  readonly qari = QARI;
  readonly state = signal<AudioState>('idle');
  /** The ayah being recited (also set while its basmalah plays). */
  readonly current = signal<AyahRef | null>(null);
  /** True while the basmalah before `current` is playing. */
  readonly basmalah = signal(false);
  readonly error = signal<string | null>(null);
  readonly mode = signal<AudioMode>(readMode());
  /** Turn pages automatically so the recited ayah stays on screen. */
  readonly follow = signal<boolean>(readBool(FOLLOW_KEY, true));

  /** Ayah to highlight on the page (not during the basmalah). */
  readonly highlight = computed<AyahRef | null>(() => {
    const s = this.state();
    return (s === 'playing' || s === 'paused' || s === 'loading') && !this.basmalah()
      ? this.current()
      : null;
  });
  readonly active = computed(() => this.state() !== 'idle');

  private audio: HTMLAudioElement | null = null;
  private preloader: HTMLAudioElement | null = null;
  private start: { ref: AyahRef; page: number } | null = null;
  private triedFallback = false;
  private token = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Start reciting at `ref`; continuous playback follows the current mode. */
  play(ref: AyahRef, page?: number): void {
    const p = page ?? this.content.pageOf(ref) ?? this.ui.currentPage();
    this.start = { ref, page: p };
    this.error.set(null);
    this.begin(ref);
  }

  toggle(): void {
    const a = this.audio;
    if (!a) return;
    if (this.state() === 'playing') {
      a.pause();
      this.state.set('paused');
    } else if (this.state() === 'paused') {
      void a
        .play()
        .then(() => this.state.set('playing'))
        .catch(() => this.fail());
    } else if (this.state() === 'error' && this.current()) {
      this.play(this.current()!);
    }
  }

  stop(): void {
    this.token++;
    this.audio?.pause();
    this.audio?.removeAttribute('src');
    this.audio?.load();
    this.state.set('idle');
    this.current.set(null);
    this.basmalah.set(false);
    this.start = null;
    this.setMediaSession(null);
  }

  next(): void {
    const cur = this.current();
    const n = cur ? nextAyah(cur, this.counts()) : null;
    if (n) this.play(n);
  }

  prev(): void {
    const cur = this.current();
    const p = cur ? prevAyah(cur, this.counts()) : null;
    if (p) this.play(p);
  }

  setMode(m: AudioMode): void {
    this.mode.set(m);
    writeStore(MODE_KEY, m);
    // Re-anchor the range at the current ayah so a changed mode applies from here.
    const cur = this.current();
    if (cur && this.start)
      this.start = { ref: cur, page: this.content.pageOf(cur) ?? this.start.page };
  }

  setFollow(on: boolean): void {
    this.follow.set(on);
    writeStore(FOLLOW_KEY, on ? '1' : '0');
  }

  // --- internals ------------------------------------------------------------

  private counts(): number[] {
    return this.content.index()?.surahs.map((s) => s.ayahCount) ?? [];
  }

  private begin(ref: AyahRef): void {
    if (needsBasmalah(ref)) this.playFile(ref, true);
    else this.playFile(ref, false);
  }

  private playFile(ref: AyahRef, basmalah: boolean): void {
    const token = ++this.token;
    const a = (this.audio ??= this.createAudio());
    const target = basmalah ? { surah: 1, ayah: 1 } : ref;
    this.current.set(ref);
    this.basmalah.set(basmalah);
    this.triedFallback = false;
    this.state.set('loading');
    this.followPage(ref);
    this.setMediaSession(ref);
    // Stored recitation first (offline packages), otherwise stream.
    void this.offline
      .localUrl(target)
      .catch(() => null)
      .then((local) => {
        if (token !== this.token) return;
        const stream = QARI.primary(globalAyahNumber(target, this.counts()));
        if (!local && isOffline()) {
          // Surah packages don't carry the Al-Fatihah file used for the basmalah.
          if (basmalah) this.playFile(ref, false);
          else this.fail('Ayat ini belum disimpan untuk offline. Sambungkan internet atau simpan surahnya.');
          return;
        }
        this.startFile(a, token, ref, basmalah, local ?? stream, local ? stream : QARI.fallback(target));
      });
  }

  private startFile(
    a: HTMLAudioElement,
    token: number,
    ref: AyahRef,
    basmalah: boolean,
    src: string,
    fallback: string,
  ): void {
    a.src = src;
    a.dataset['fallback'] = fallback;
    a.onended = () => {
      if (token !== this.token) return;
      if (basmalah) this.playFile(ref, false);
      else this.advance(ref);
    };
    a.onerror = () => {
      if (token !== this.token) return;
      if (!this.triedFallback && a.dataset['fallback']) {
        this.triedFallback = true;
        a.src = a.dataset['fallback'];
        void a.play().catch(() => undefined);
        return;
      }
      this.fail();
    };
    void a
      .play()
      .then(() => {
        if (token === this.token) this.state.set('playing');
      })
      .catch((e: unknown) => {
        // Autoplay blocked or aborted by a newer request: let the user resume.
        if (token !== this.token) return;
        if ((e as { name?: string })?.name === 'NotAllowedError') this.state.set('paused');
      });
    this.preloadAfter(ref);
  }

  private advance(done: AyahRef): void {
    const n = nextAyah(done, this.counts());
    if (this.start && shouldContinue(this.mode(), this.start, n, (r) => this.content.pageOf(r))) {
      this.begin(n!);
    } else {
      this.stop();
    }
  }

  private preloadAfter(ref: AyahRef): void {
    const n = nextAyah(ref, this.counts());
    if (
      !n ||
      !this.start ||
      !shouldContinue(this.mode(), this.start, n, (r) => this.content.pageOf(r))
    )
      return;
    void this.offline
      .localUrl(n)
      .catch(() => null)
      .then((local) => {
        if (local || isOffline()) return; // stored files need no warm-up
        const pre = (this.preloader ??= this.createAudio());
        pre.preload = 'auto';
        pre.src = QARI.primary(globalAyahNumber(n, this.counts()));
      });
  }

  /** Keep the recited ayah on screen — only while the user is in the reader. */
  private followPage(ref: AyahRef): void {
    if (!this.follow() || !this.router.url.startsWith('/hal/')) return;
    const page = this.content.pageOf(ref);
    if (page && !this.ui.visiblePages().includes(page)) {
      this.ui.goToPage(page, { replaceUrl: true });
    }
  }

  private fail(msg = 'Audio tidak dapat diputar. Periksa koneksi lalu coba lagi.'): void {
    this.state.set('error');
    this.error.set(msg);
  }

  private createAudio(): HTMLAudioElement {
    const a = new Audio();
    a.preload = 'auto';
    a.crossOrigin = null;
    return a;
  }

  private setMediaSession(ref: AyahRef | null): void {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    if (!ref) {
      ms.metadata = null;
      return;
    }
    const name = this.content.index()
      ? this.content.surah(ref.surah).nameLatin
      : `Surah ${ref.surah}`;
    ms.metadata = new MediaMetadata({
      title: `${name} · Ayat ${ref.ayah}`,
      artist: QARI.name,
      album: 'Mushaf Digital',
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    ms.setActionHandler('play', () => this.toggle());
    ms.setActionHandler('pause', () => this.toggle());
    ms.setActionHandler('stop', () => this.stop());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('previoustrack', () => this.prev());
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function readMode(): AudioMode {
  const v = readStore(MODE_KEY);
  return v === 'ayah' || v === 'page' || v === 'surah' ? v : 'surah';
}

function readBool(key: string, fallback: boolean): boolean {
  const v = readStore(key);
  return v === null ? fallback : v === '1';
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preference lasts for this page load only
  }
}

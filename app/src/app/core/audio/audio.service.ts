import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { reportError } from '../storage/error-reporter';
import { Router } from '@angular/router';
import { ContentApi, UserDataApi } from '../contracts';
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

/**
 * Verse-by-verse recitation (streamed; recordings are one file per ayah, so the
 * highlighted ayah always matches what is heard). Owned by the orchestrator;
 * UI reads the signals and calls the methods below.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private readonly content = inject(ContentApi);
  private readonly data = inject(UserDataApi);
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
  readonly mode = computed<AudioMode>(() => this.data.prefs().audioMode);
  /** Turn pages automatically so the recited ayah stays on screen. */
  readonly follow = computed<boolean>(() => this.data.prefs().audioFollow);

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
  /** First source that failed for the current file, for the error report. */
  private firstFailure: string | null = null;
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
    void this.data.setPrefs({ audioMode: m });
    // Re-anchor the range at the current ayah so a changed mode applies from here.
    const cur = this.current();
    if (cur && this.start)
      this.start = { ref: cur, page: this.content.pageOf(cur) ?? this.start.page };
  }

  setFollow(on: boolean): void {
    void this.data.setPrefs({ audioFollow: on });
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
    this.firstFailure = null;
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
      const failed = `${describeSrc(a.src)} (kode ${a.error?.code ?? '?'})`;
      if (!this.triedFallback && a.dataset['fallback']) {
        this.triedFallback = true;
        this.firstFailure = failed;
        a.src = a.dataset['fallback'];
        void a.play().catch(() => undefined);
        return;
      }
      reportError({
        op: 'audio',
        name: 'MediaError',
        message: `${ref.surah}:${ref.ayah}${basmalah ? ' basmalah' : ''} · ${this.firstFailure ?? '-'} → ${failed} · online=${navigator.onLine}`,
        at: Date.now(),
      });
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
        const name = (e as { name?: string })?.name;
        if (name === 'NotAllowedError') this.state.set('paused');
        else if (name && name !== 'AbortError')
          reportError({ op: 'audio-play', name, message: `${ref.surah}:${ref.ayah} · ${describeSrc(src)}`, at: Date.now() });
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

/** "local" for stored files, else host + file name (no query). */
function describeSrc(src: string): string {
  if (src.startsWith('blob:')) return 'local';
  try {
    const u = new URL(src);
    return `${u.host}${u.pathname.slice(u.pathname.lastIndexOf('/'))}`;
  } catch {
    return src.slice(0, 60);
  }
}

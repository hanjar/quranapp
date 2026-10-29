import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { reportError } from '../storage/error-reporter';
import { Router } from '@angular/router';
import { ContentApi, UserDataApi } from '../contracts';
import { AyahRef } from '../models';
import { ReaderUiService } from '../reader-ui.service';
import { syncedSetting } from '../synced-setting';
import { ProgressService } from '../progress/progress.service';
import { AudioOfflineApi, audioFileUrl } from './audio-offline.api';
import {
  AudioMode,
  DEFAULT_QARI,
  QariId,
  globalAyahNumber,
  isFirstAyahOfPage,
  isLastAyahOfPage,
  needsBasmalah,
  nextAyah,
  prevAyah,
  qariById,
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
  private readonly progress = inject(ProgressService);

  private readonly qariSetting = syncedSetting<QariId>(
    'qari',
    'mf-qari',
    (r) => qariById(r).id,
    (v) => (v === DEFAULT_QARI.id ? null : v),
  );
  readonly qari = computed(() => qariById(this.qariSetting.value()));
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
  private start: { ref: AyahRef; page: number } | null = null;
  /**
   * The page being heard, for the "read by listening" rule: it counts once every ayah on it
   * was recited. `complete` is false when the listening did not begin at the page's first ayah
   * or the user skipped within it.
   */
  private heard: { page: number; since: number; complete: boolean } | null = null;
  private triedFallback = false;
  /** First source that failed for the current file, for the error report. */
  private firstFailure: string | null = null;
  /** The current file already tried our own copy on R2. */
  private freshRetried = false;
  /**
   * This device can't play the CDN files but plays our R2 copy (an Android 10 tablet:
   * "Format error" on every CDN file). Then R2 goes first. Remembered per device.
   */
  private preferOwn = readPreferOwn();
  private token = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Start reciting at `ref`; continuous playback follows the current mode. */
  play(ref: AyahRef, page?: number): void {
    const p = page ?? this.content.pageOf(ref) ?? this.ui.currentPage();
    // A user-chosen start re-tracks the page: it is complete only if this is its first ayah.
    this.heard = null;
    this.start = { ref, page: p };
    this.error.set(null);
    this.freshRetried = false;
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
    this.heard = null;
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

  /** Switch voice; an ayah being recited restarts in the new voice (no basmalah again). */
  setQari(id: QariId): void {
    this.qariSetting.set(id);
    const cur = this.current();
    if (
      cur &&
      (this.state() === 'playing' || this.state() === 'paused' || this.state() === 'loading')
    )
      this.playFile(cur, false);
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
    if (!basmalah) this.trackHeard(ref);
    this.triedFallback = false;
    this.freshRetried = false;
    this.firstFailure = null;
    this.state.set('loading');
    this.setMediaSession(ref);
    const qari = this.qari();
    // Stored recitation first (offline packages, Alafasy only), otherwise stream.
    const local: Promise<string | null> = qari.offline
      ? this.offline.localUrl(target).catch(() => null)
      : Promise.resolve(null);
    void local.then((file) => {
      if (token !== this.token) return;
      const stream = qari.primary(globalAyahNumber(target, this.counts()), target);
      if (!file && isOffline()) {
        if (!qari.offline) this.fail('Qari ini hanya bisa diputar dengan internet.');
        // Surah packages don't carry the Al-Fatihah file used for the basmalah.
        else if (basmalah) this.playFile(ref, false);
        else
          this.fail(
            'Ayat ini belum disimpan untuk offline. Sambungkan internet atau simpan surahnya.',
          );
        return;
      }
      const own = !file && this.preferOwn ? this.ownUrl(a, target) : null;
      if (own) {
        this.startFile(a, token, ref, basmalah, own, stream);
        return;
      }
      this.startFile(
        a,
        token,
        ref,
        basmalah,
        file ?? stream,
        file ? stream : qari.fallback(target),
      );
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
      const detail = a.error?.message ? ` ${a.error.message.slice(0, 60)}` : '';
      const failed = `${describeSrc(a.src)} (kode ${a.error?.code ?? '?'}${detail})`;
      if (!this.triedFallback && a.dataset['fallback']) {
        this.triedFallback = true;
        this.firstFailure = failed;
        a.src = a.dataset['fallback'];
        void a.play().catch(() => undefined);
        return;
      }
      // An Android 10 tablet failed the same (longer) files on both CDNs with "Format error",
      // though they decode fine elsewhere: try our own re-encoded copy on R2 last.
      const own = this.freshRetried ? null : this.ownUrl(a, basmalah ? { surah: 1, ayah: 1 } : ref);
      if (own) {
        this.freshRetried = true;
        reportError({
          op: 'audio-retry',
          name: 'MediaError',
          message: `${ref.surah}:${ref.ayah} · ${failed}`,
          at: Date.now(),
        });
        a.src = own;
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
    // "playing" comes from the element itself: a source that only works after a fallback
    // never resolves the first play() call, which left the player on "loading".
    a.onplaying = () => {
      if (token !== this.token) return;
      this.state.set('playing');
      if (this.freshRetried && !this.preferOwn) {
        // Our copy rescued a file the CDNs failed on: use it first from now on.
        this.preferOwn = true;
        writePreferOwn();
        reportError({
          op: 'audio-recovered',
          name: 'R2',
          message: `${ref.surah}:${ref.ayah}`,
          at: Date.now(),
        });
      }
      this.followPage(ref);
    };
    void a.play().catch((e: unknown) => {
      // Autoplay blocked or aborted by a newer request: let the user resume.
      if (token !== this.token) return;
      const name = (e as { name?: string })?.name;
      if (name === 'NotAllowedError') this.state.set('paused');
      else if (name && name !== 'AbortError')
        reportError({
          op: 'audio-play',
          name,
          message: `${ref.surah}:${ref.ayah} · ${describeSrc(src)}`,
          at: Date.now(),
        });
    });
  }

  /** Start tracking the page of an ayah that begins to play; a page already tracked is kept. */
  private trackHeard(ref: AyahRef): void {
    const page = this.content.pageOf(ref);
    if (!page) this.heard = null;
    else if (this.heard?.page !== page)
      this.heard = {
        page,
        since: Date.now(),
        complete: isFirstAyahOfPage(ref, this.counts(), (r) => this.content.pageOf(r)),
      };
  }

  private advance(done: AyahRef): void {
    this.recordHeardPage(done);
    const n = nextAyah(done, this.counts());
    if (this.start && shouldContinue(this.mode(), this.start, n, (r) => this.content.pageOf(r))) {
      this.begin(n!);
    } else {
      this.stop();
    }
  }

  /** A page heard completely, ending on its last ayah, counts as read. */
  private recordHeardPage(done: AyahRef): void {
    const h = this.heard;
    const counts = this.counts();
    const pageOf = (r: AyahRef) => this.content.pageOf(r);
    if (!h || !h.complete || pageOf(done) !== h.page) return;
    if (!isLastAyahOfPage(done, counts, pageOf)) return;
    this.heard = null;
    void this.progress.recordListened(h.page, Date.now() - h.since);
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
    this.heard = null;
  }

  /**
   * Our own copy on R2 for the current qari, or null when there is none. Offline qaris use
   * the Alafasy copy; streaming qaris use their `own` URL, only where Opus plays.
   */
  private ownUrl(a: HTMLAudioElement, target: AyahRef): string | null {
    const qari = this.qari();
    if (qari.offline) return ownCopyUrl(a, target);
    if (!qari.own || a.canPlayType('audio/webm; codecs=opus') === '') return null;
    return qari.own(target);
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
      artist: this.qari().name,
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

/** Our own re-encoded copy on R2: Opus 32 where supported, else MP3 64. */
function ownCopyUrl(a: HTMLAudioElement, ref: AyahRef): string {
  return a.canPlayType('audio/webm; codecs=opus') !== ''
    ? audioFileUrl('opus32', 'webm', ref)
    : audioFileUrl('mp364', 'mp3', ref);
}

const PREFER_OWN_KEY = 'mf-audio-own';

function readPreferOwn(): boolean {
  try {
    return localStorage.getItem(PREFER_OWN_KEY) === '1';
  } catch {
    return false;
  }
}

function writePreferOwn(): void {
  try {
    localStorage.setItem(PREFER_OWN_KEY, '1');
  } catch {
    /* storage blocked: lasts for this page load */
  }
}

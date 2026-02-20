import { Injectable, signal } from '@angular/core';
import { SurahMeta } from '../models/surah.model';

const AUDIO_CDN = 'https://cdn.islamic.network/quran/audio/128';
const DEFAULT_QARI = 'ar.alafasy';

@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly isPlaying = signal(false);
  readonly currentAyah = signal<{ surah: number; ayah: number } | null>(null);
  readonly repeatMode = signal(false);
  readonly qari = signal(DEFAULT_QARI);

  private audio = new Audio();
  private surahMetas: SurahMeta[] = [];
  private autoPlayNext = true;

  constructor() {
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('error', () => {
      this.isPlaying.set(false);
    });
  }

  setSurahMetas(metas: SurahMeta[]) {
    this.surahMetas = metas;
  }

  play(surah: number, ayah: number): void {
    const absoluteAyah = this.getAbsoluteAyah(surah, ayah);
    if (absoluteAyah === null) return;

    const url = `${AUDIO_CDN}/${this.qari()}/${absoluteAyah}.mp3`;
    this.audio.src = url;
    this.audio.play();
    this.isPlaying.set(true);
    this.currentAyah.set({ surah, ayah });
  }

  pause(): void {
    this.audio.pause();
    this.isPlaying.set(false);
  }

  resume(): void {
    this.audio.play();
    this.isPlaying.set(true);
  }

  toggle(): void {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.resume();
    }
  }

  stop(): void {
    this.audio.pause();
    this.audio.src = '';
    this.isPlaying.set(false);
    this.currentAyah.set(null);
  }

  toggleRepeat(): void {
    this.repeatMode.update(v => !v);
  }

  private onEnded(): void {
    const current = this.currentAyah();
    if (!current) return;

    if (this.repeatMode()) {
      this.play(current.surah, current.ayah);
      return;
    }

    if (!this.autoPlayNext) {
      this.isPlaying.set(false);
      return;
    }

    // Auto-play next ayah
    const meta = this.surahMetas.find(s => s.number === current.surah);
    if (!meta) return;

    if (current.ayah < meta.totalVerses) {
      this.play(current.surah, current.ayah + 1);
    } else {
      // End of surah
      this.isPlaying.set(false);
      this.currentAyah.set(null);
    }
  }

  private getAbsoluteAyah(surah: number, ayah: number): number | null {
    const meta = this.surahMetas.find(s => s.number === surah);
    if (!meta) return null;
    return meta.startAyah + ayah - 1;
  }
}

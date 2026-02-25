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

  playPageFlipSound(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      const dur = 0.25;

      const bufferSize = audioCtx.sampleRate * dur;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, audioCtx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + dur);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);

      noise.start();
    } catch (e) { console.error('Audio play failed', e); }
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

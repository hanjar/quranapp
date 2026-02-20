import { Component, inject } from '@angular/core';
import { AudioService } from '../../core/services/audio.service';
import { QuranDataService } from '../../core/services/quran-data.service';
import { ArabicNumberPipe } from '../../shared/pipes/arabic-number.pipe';

@Component({
  selector: 'app-audio-bar',
  imports: [ArabicNumberPipe],
  template: `
    @if (audio.currentAyah(); as current) {
      <div class="audio-bar">
        <button class="audio-btn" (click)="audio.toggle()">
          @if (audio.isPlaying()) {
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
          } @else {
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          }
        </button>

        <span class="ayah-info latin-ui">
          {{ getSurahName(current.surah) }} : {{ current.ayah | arabicNumber }}
        </span>

        <button
          class="audio-btn"
          [class.active]="audio.repeatMode()"
          (click)="audio.toggleRepeat()"
          title="Ulangi"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </button>

        <button class="audio-btn" (click)="audio.stop()" title="Tutup">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    }
  `,
  styles: `
    .audio-bar {
      position: fixed;
      bottom: 56px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--green-primary);
      border-radius: 24px;
      padding: 8px 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 90;
    }
    .audio-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      color: var(--text-light);
      border-radius: 50%;
      cursor: pointer;
      &:hover { background: rgba(255, 255, 255, 0.12); }
      &.active { color: var(--gold-indicator); }
    }
    .ayah-info {
      color: var(--text-light);
      white-space: nowrap;
      padding: 0 8px;
    }
  `,
})
export class AudioBarComponent {
  audio = inject(AudioService);
  private quranData = inject(QuranDataService);

  getSurahName(surah: number): string {
    return this.quranData.getSurahMeta(surah)?.englishName ?? `Surah ${surah}`;
  }
}

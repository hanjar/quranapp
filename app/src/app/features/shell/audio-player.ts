import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AudioService } from '../../core/audio/audio.service';
import { ContentApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { modeLabel, modeShortLabel, nextMode, nowPlayingTitle } from './audio-labels';

const VAR = '--mf-player-h';

function setPlayerHeight(px: number): void {
  document.documentElement.style.setProperty(VAR, `${Math.round(px)}px`);
}

/** Compact mini player for verse-by-verse recitation, visible while audio.active(). */
@Component({
  selector: 'app-audio-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 15;
      display: flex;
      justify-content: center;
      pointer-events: none;
      padding: 0 12px;
    }
    .pill {
      pointer-events: auto;
      width: 100%;
      max-width: 440px;
      margin-bottom: calc(12px + var(--mf-safe-bottom));
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px 6px 14px;
      border-radius: 28px;
      background: var(--ui-surface);
      color: var(--ui-ink);
      border: 1px solid var(--ui-line);
      box-shadow: 0 6px 20px color-mix(in srgb, var(--ui-ink) 16%, transparent);
      font-family: var(--ui-font);
      transition: margin-bottom var(--mf-dur-base) var(--mf-ease);
    }
    .pill.lifted {
      margin-bottom: calc(72px + var(--mf-safe-bottom));
    }
    .txt {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      text-align: left;
      border: none;
      background: transparent;
      padding: 4px 0;
      min-height: var(--mf-tap);
      justify-content: center;
    }
    .title {
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      font-size: 12px;
      color: var(--ui-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .err {
      font-size: 12.5px;
      color: var(--mf-danger);
      white-space: normal;
    }
    .btn {
      width: 40px;
      height: 44px;
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      border-radius: 50%;
      color: var(--ui-ink);
    }
    .btn:hover {
      background: color-mix(in srgb, var(--ui-ink) 6%, transparent);
    }
    .btn.main {
      width: 44px;
      background: var(--ui-primary);
      color: var(--ui-on);
    }
    .btn svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .chip {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 36px;
      padding: 0 9px;
      border-radius: 18px;
      border: 1px solid var(--ui-line);
      background: transparent;
      font-size: 11px;
      line-height: 1.1;
      color: var(--ui-ink2);
    }
    .retry {
      min-height: 36px;
      padding: 0 12px;
      border-radius: 18px;
      border: 1px solid var(--ui-primary);
      background: transparent;
      color: var(--ui-primary);
      font-size: 13px;
      flex: none;
    }
    .spin {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid color-mix(in srgb, var(--ui-on) 35%, transparent);
      border-top-color: var(--ui-on);
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    :host-context(html[data-motion='reduce']) .spin {
      animation-duration: 3s;
    }
    @media (prefers-reduced-motion: reduce) {
      .spin {
        animation-duration: 3s;
      }
      .pill {
        transition: none;
      }
    }
    /* Narrow phones: title on its own row so the surah name is never truncated. */
    @media (max-width: 419px) {
      .pill {
        flex-wrap: wrap;
        justify-content: space-between;
        row-gap: 0;
        border-radius: 22px;
        padding: 4px 8px 6px 14px;
      }
      .txt {
        flex: 1 0 100%;
        min-height: 0;
        padding: 4px 0 0;
        flex-direction: row;
        align-items: baseline;
        gap: 8px;
      }
      .sub {
        flex: none;
      }
    }
  `,
  template: `
    @if (audio.active()) {
      <div
        #pill
        class="pill"
        [class.lifted]="ui.chromeVisible()"
        role="group"
        aria-label="Pemutar audio"
      >
        <button
          type="button"
          class="txt"
          (click)="openVerse()"
          aria-label="Buka ayat yang sedang dibaca"
        >
          @if (audio.state() === 'error') {
            <span class="err" role="alert">{{ audio.error() }}</span>
          } @else {
            <span class="title">{{ title() }}</span>
            <span class="sub">{{ audio.qari.name }}</span>
          }
        </button>
        <span class="mf-visually-hidden" aria-live="polite">{{ announce() }}</span>

        @if (audio.state() === 'error') {
          <button type="button" class="retry" (click)="audio.toggle()">Coba lagi</button>
        } @else {
          <button type="button" class="btn" aria-label="Ayat sebelumnya" (click)="audio.prev()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6h2v12H6zM9.5 12 18 18V6z" />
            </svg>
          </button>
          <button
            type="button"
            class="btn main"
            [attr.aria-label]="audio.state() === 'playing' ? 'Jeda' : 'Putar'"
            (click)="audio.toggle()"
          >
            @if (audio.state() === 'loading') {
              <span class="spin" role="status" aria-label="Memuat audio"></span>
            } @else if (audio.state() === 'playing') {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
              </svg>
            } @else {
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            }
          </button>
          <button type="button" class="btn" aria-label="Ayat berikutnya" (click)="audio.next()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
            </svg>
          </button>
          <button
            type="button"
            class="chip"
            [attr.aria-label]="'Mode putar: ' + mode() + '. Ketuk untuk mengganti'"
            (click)="audio.setMode(next())"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4" />
              <path d="M21 13v2a3 3 0 01-3 3H3" /></svg
            >{{ modeShort() }}
          </button>
        }
        <button type="button" class="btn" aria-label="Hentikan audio" (click)="audio.stop()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"
            />
          </svg>
        </button>
      </div>
    }
  `,
})
export class AudioPlayer {
  protected readonly audio = inject(AudioService);
  protected readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly pill = viewChild<ElementRef<HTMLElement>>('pill');

  protected readonly mode = computed(() => modeLabel(this.audio.mode()));
  protected readonly modeShort = computed(() => modeShortLabel(this.audio.mode()));
  protected readonly next = computed(() => nextMode(this.audio.mode()));

  protected readonly title = computed(() => {
    const cur = this.audio.current();
    if (!cur) return '';
    const idx = this.content.index();
    const name = idx ? this.content.surah(cur.surah).nameLatin : `Surah ${cur.surah}`;
    return nowPlayingTitle(name, cur.ayah, this.audio.basmalah());
  });

  protected readonly announce = computed(() =>
    this.audio.state() === 'playing' ? this.title() : '',
  );

  constructor() {
    let ro: ResizeObserver | null = null;
    effect(() => {
      const el = this.pill()?.nativeElement;
      ro?.disconnect();
      ro = null;
      if (!el) {
        setPlayerHeight(0);
        return;
      }
      setPlayerHeight(el.offsetHeight);
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => setPlayerHeight(el.offsetHeight));
        ro.observe(el);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      ro?.disconnect();
      setPlayerHeight(0);
    });
  }

  protected openVerse(): void {
    const cur = this.audio.current();
    if (!cur) return;
    const page = this.content.pageOf(cur) ?? this.ui.currentPage();
    this.ui.selectVerse({ ...cur, page });
  }
}

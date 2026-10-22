import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { DOA_KHATAM, DOA_KHATAM_SOURCE, DOA_KHATAM_TITLE } from './doa-khatam.content';

/** Text copied by "Salin": the title, then Arabic, Latin and translation of every line. */
export function doaCopyText(): string {
  const body = DOA_KHATAM.map((l) => `${l.arabic}\n${l.latin}\n${l.translation}`).join('\n\n');
  return `${DOA_KHATAM_TITLE}\n\n${body}\n\n${DOA_KHATAM_SOURCE}`;
}

/**
 * Full page for the khatam supplication. Not a mushaf page: no frame, no page number, and it
 * never touches reading position, bookmarks or progress. The text itself lives in
 * doa-khatam.content.ts and is rendered as is.
 */
@Component({
  selector: 'app-doa-khatam',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali ke mushaf" (click)="back()">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <span class="grow"></span>
      <button type="button" class="mf-btn mf-btn--ghost copybtn" (click)="copy()">Salin</button>
    </header>

    <main class="wrap">
      <h1 class="mf-display">{{ title }}</h1>
      @for (line of lines; track $index) {
        <section class="line">
          <p class="ar" lang="ar" dir="rtl">{{ line.arabic }}</p>
          <p class="lat">{{ line.latin }}</p>
          <p class="tr">{{ line.translation }}</p>
        </section>
      }
      <p class="src">{{ source }}</p>
    </main>
  `,
  styles: `
    :host {
      display: block;
      position: fixed;
      inset: 0;
      overflow-y: auto;
      background: var(--mf-surround);
      color: var(--ui-ink);
      font-family: var(--ui-font);
    }
    .top {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: calc(var(--mf-safe-top) + 6px) 8px 6px;
      background: var(--ui-surface);
      border-bottom: 1px solid var(--ui-hair);
    }
    .grow {
      flex: 1;
    }
    .copybtn {
      padding: 0 var(--mf-space-3);
    }
    .wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--mf-space-6) 16px var(--mf-space-8);
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-6);
    }
    h1 {
      margin: 0;
      text-align: center;
      font-size: 22px;
      font-weight: 500;
    }
    .line {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: var(--mf-space-4);
      border: 1px solid var(--ui-hair);
      border-radius: var(--mf-radius-md);
      background: var(--ui-surface);
    }
    p {
      margin: 0;
    }
    .ar {
      font-family: 'Noto Naskh Arabic', 'Amiri', 'Scheherazade New', 'Traditional Arabic', serif;
      font-size: clamp(26px, 6vw, 34px);
      line-height: 2.1;
      text-align: right;
      color: var(--ui-ink);
    }
    .lat {
      font-style: italic;
      font-size: 15px;
      line-height: 1.6;
      color: var(--ui-muted);
    }
    .tr {
      font-size: 16px;
      line-height: 1.6;
      color: var(--ui-ink2);
    }
    .src {
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--ui-muted);
      text-align: center;
    }
  `,
})
export class DoaKhatam {
  private readonly router = inject(Router);
  private readonly userData = inject(UserDataApi);
  private readonly ui = inject(ReaderUiService);

  protected readonly title = DOA_KHATAM_TITLE;
  protected readonly lines = DOA_KHATAM;
  protected readonly source = DOA_KHATAM_SOURCE;

  protected back(): void {
    const page = this.userData.position()?.page ?? this.ui.currentPage();
    void this.router.navigate(['/hal', page]);
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(doaCopyText());
      this.ui.showToast({ message: 'Doa disalin' });
    } catch {
      this.ui.showToast({ message: 'Tidak bisa menyalin. Salin manual dari layar.' });
    }
  }
}

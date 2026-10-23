import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { UserDataApi } from '../../core/contracts';
import { KhatamService } from '../../core/khatam.service';
import { SheetHistory } from '../sheets/sheet-history';

/**
 * "Alhamdulillah, khatam ke-N": archive this round's bookmarks and start a new round.
 * Opened by KhatamService.open() from page 604 and from the progress sheet.
 */
@Component({
  selector: 'app-khatam-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: calc(var(--mf-z-tour) + 1);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: color-mix(in srgb, var(--ui-ink) 45%, transparent);
    }
    .dlg {
      width: min(100%, 420px);
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-3);
      padding: var(--mf-space-5);
      border-radius: var(--mf-radius-sheet);
      background: var(--ui-surface);
      color: var(--ui-ink);
      font-family: var(--ui-font);
      box-shadow: 0 12px 40px color-mix(in srgb, var(--ui-ink) 25%, transparent);
    }
    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
    }
    p {
      margin: 0;
      font-size: 15px;
      line-height: 1.55;
      color: var(--ui-ink2);
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-2);
      padding-top: var(--mf-space-2);
    }
    .actions .mf-btn {
      width: 100%;
    }
  `,
  template: `
    @if (khatam.dialog(); as d) {
      <div class="scrim" (click)="khatam.close()">
        <div
          #dlg
          class="dlg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mf-khatam-title"
          aria-describedby="mf-khatam-body"
          (click)="$event.stopPropagation()"
        >
          <h2 id="mf-khatam-title" class="mf-display">Alhamdulillah, khatam ke-{{ d.n }}</h2>
          <p id="mf-khatam-body">
            @if (d.count > 0) {
              Arsipkan {{ d.count }} penanda putaran ini ke folder '{{ d.folderName }}' dan mulai
              putaran baru? Favorit tidak ikut diarsipkan.
            } @else {
              Tidak ada penanda untuk diarsipkan. Mulai putaran baru?
            }
          </p>
          <div class="actions">
            <button
              type="button"
              class="mf-btn mf-btn--primary"
              data-testid="khatam-confirm"
              [disabled]="khatam.busy()"
              (click)="khatam.confirm()"
            >
              {{ d.count > 0 ? 'Arsipkan & mulai baru' : 'Mulai putaran baru' }}
            </button>
            @if (userData.prefs().showDoaKhatam) {
              <button
                type="button"
                class="mf-btn mf-btn--outline"
                data-testid="khatam-doa"
                [disabled]="khatam.busy()"
                (click)="readDoa()"
              >
                Baca doa khatam
              </button>
            }
            <button
              type="button"
              class="mf-btn mf-btn--ghost"
              data-testid="khatam-later"
              [disabled]="khatam.busy()"
              (click)="khatam.close()"
            >
              Nanti
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class KhatamDialog {
  protected readonly khatam = inject(KhatamService);
  protected readonly userData = inject(UserDataApi);
  private readonly history = inject(SheetHistory);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Move focus into the dialog when it opens.
    effect(() => {
      if (!this.khatam.dialog()) return;
      untracked(() =>
        queueMicrotask(() =>
          this.host.nativeElement
            .querySelector<HTMLElement>('[data-testid="khatam-confirm"]')
            ?.focus(),
        ),
      );
    });
  }

  protected readDoa(): void {
    this.khatam.close();
    this.history.navigateUrl('/doa-khatam');
  }

  protected onEscape(e: Event): void {
    if (!this.khatam.dialog()) return;
    e.stopImmediatePropagation();
    this.khatam.close();
  }
}

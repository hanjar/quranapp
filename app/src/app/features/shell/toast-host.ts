import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReaderUiService } from '../../core/reader-ui.service';

/** Renders `ui.toast()` as a dark pill above the bottom chrome. */
@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: var(--mf-z-toast);
      display: flex;
      justify-content: center;
      pointer-events: none;
      padding: 0 16px;
    }
    .toast {
      pointer-events: auto;
      width: max-content;
      max-width: 100%;
      margin-bottom: calc(16px + var(--mf-safe-bottom));
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 8px 8px 16px;
      border-radius: 24px;
      background: var(--ui-ink);
      color: var(--ui-on);
      font-size: 14px;
      box-shadow: 0 6px 20px color-mix(in srgb, var(--ui-ink) 20%, transparent);
      font-family: var(--ui-font);
    }
    .toast.lifted {
      margin-bottom: calc(88px + var(--mf-safe-bottom));
    }
    .act {
      min-height: 36px;
      padding: 0 12px;
      border-radius: 18px;
      border: none;
      background: rgba(245, 241, 232, 0.14);
      color: var(--ui-on);
      font-size: 13.5px;
      font-weight: 500;
    }
    .x {
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      color: var(--ui-on);
      font-size: 18px;
    }
    .live {
      display: contents;
    }
  `,
  template: `
    <div class="live" role="status" aria-live="polite">
      @if (ui.toast(); as t) {
        <div class="toast" [class.lifted]="ui.chromeVisible()">
          <span>{{ t.message }}</span>
          @if (t.actionLabel) {
            <button type="button" class="act" (click)="run(t.action)">{{ t.actionLabel }}</button>
          }
          <button type="button" class="x" aria-label="Tutup" (click)="ui.dismissToast()">×</button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly ui = inject(ReaderUiService);

  protected run(action?: () => void): void {
    this.ui.dismissToast();
    action?.();
  }
}

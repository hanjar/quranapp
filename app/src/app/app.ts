import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { ReaderUiService } from './core/reader-ui.service';
import { GestureTour } from './features/onboarding/gesture-tour';
import { InstallPrompt } from './features/shell/install-prompt';
import { SheetHost } from './features/sheets/sheet-host';
import { ToastHost } from './features/shell/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SheetHost, ToastHost, GestureTour, InstallPrompt],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    const ui = inject(ReaderUiService);
    const sw = inject(SwUpdate);
    // Never force a reload mid-reading (PRD §10): offer it.
    if (sw.isEnabled) {
      sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(() =>
        ui.showToast({
          message: 'Versi baru tersedia',
          actionLabel: 'Muat ulang',
          action: () => document.location.reload(),
          duration: 15000,
        }),
      );
    }
  }
}

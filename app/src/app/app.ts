import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ReaderUiService } from './core/reader-ui.service';
import { UpdateService } from './core/update.service';
import { GestureTour } from './features/onboarding/gesture-tour';
import { AudioPlayer } from './features/shell/audio-player';
import { InstallPrompt } from './features/shell/install-prompt';
import { KhatamDialog } from './features/shell/khatam-dialog';
import { SheetHost } from './features/sheets/sheet-host';
import { ToastHost } from './features/shell/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SheetHost, ToastHost, GestureTour, InstallPrompt, AudioPlayer, KhatamDialog],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    const ui = inject(ReaderUiService);
    const updates = inject(UpdateService);
    // Never force a reload mid-reading (PRD §10): offer it, and keep offering it
    // in Tentang (About) after the toast is gone.
    effect(() => {
      if (!updates.available()) return;
      untracked(() =>
        ui.showToast({
          message: 'Versi baru tersedia',
          actionLabel: 'Muat ulang',
          action: () => void updates.reload(),
          duration: 60000,
        }),
      );
    });
  }
}

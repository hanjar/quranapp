import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { ContentApi, OfflineApi, SyncApi, UserDataApi } from './core/contracts';
import { ContentService } from './core/content/content.service';
import { OfflineService } from './core/offline/offline.service';
import { UserDataService } from './core/storage/user-data.service';
import { SyncService } from './core/sync/sync.service';
import { InstallService } from './core/install.service';
import { ThemeService } from './core/theme.service';
import { WakeLockService } from './core/wake-lock.service';
import { LineRulesService } from './core/line-rules.service';
import { AudioOfflineApi } from './core/audio/audio-offline.api';
import { AudioOfflineService } from './core/audio/audio-offline.service';
import { ReportingErrorHandler } from './core/reporting-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    { provide: ContentApi, useExisting: ContentService },
    { provide: OfflineApi, useExisting: OfflineService },
    { provide: UserDataApi, useExisting: UserDataService },
    { provide: SyncApi, useExisting: SyncService },
    { provide: AudioOfflineApi, useExisting: AudioOfflineService },
    // Local data must be ready before the first route resolves (resume = US-02).
    // Content metadata loads in parallel; the reader shows its own loading state.
    provideAppInitializer(async () => {
      const data = inject(UserDataApi);
      const content = inject(ContentApi);
      const sync = inject(SyncApi);
      const offline = inject(OfflineApi);
      const audioOffline = inject(AudioOfflineApi);
      inject(ThemeService);
      inject(InstallService); // must listen for beforeinstallprompt from the start
      inject(WakeLockService); // keeps the screen on while reading (per-device setting)
      const lineRules = inject(LineRulesService); // "Garis antarbaris" is a synced pref
      void content.load();
      await data.init();
      lineRules.applyNow(); // before the first page renders
      // Sync is optional and never blocks reading.
      void sync.init().catch(() => undefined);
      void offline.refresh().catch(() => undefined);
      // Scans stored recitations so playback can use them (never rejects).
      void audioOffline.load();
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:5000',
    }),
  ],
};

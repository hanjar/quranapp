import {
  ApplicationConfig,
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: ContentApi, useExisting: ContentService },
    { provide: OfflineApi, useExisting: OfflineService },
    { provide: UserDataApi, useExisting: UserDataService },
    { provide: SyncApi, useExisting: SyncService },
    // Local data must be ready before the first route resolves (resume = US-02).
    // Content metadata loads in parallel; the reader shows its own loading state.
    provideAppInitializer(async () => {
      const data = inject(UserDataApi);
      const content = inject(ContentApi);
      const sync = inject(SyncApi);
      const offline = inject(OfflineApi);
      inject(ThemeService);
      inject(InstallService); // must listen for beforeinstallprompt from the start
      void content.load();
      await data.init();
      // Sync is optional and never blocks reading.
      void sync.init().catch(() => undefined);
      void offline.refresh().catch(() => undefined);
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:5000',
    }),
  ],
};

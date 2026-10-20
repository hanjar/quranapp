import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { UserDataApi } from './core/contracts';
import { ReaderUiService } from './core/reader-ui.service';

/**
 * `/` resumes the last read page (US-02). First-ever visit goes to the welcome
 * screen. An explicit deep link (/hal/N) always wins over the saved position.
 */
const resumeRedirect = () => {
  const data = inject(UserDataApi);
  const ui = inject(ReaderUiService);
  const router = inject(Router);
  const pos = data.position();
  if (!data.prefs().onboardingDone && !pos) return router.parseUrl('/selamat-datang');
  if (pos) {
    ui.showToast({
      message: `Lanjut membaca · hal. ${pos.page}`,
      actionLabel: 'Penanda',
      action: () => ui.openSheet('bookmarks'),
    });
  }
  return router.parseUrl(`/hal/${pos?.page ?? 1}`);
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [resumeRedirect], children: [] },
  {
    path: 'hal/:page',
    loadComponent: () => import('./features/reader/reader-shell').then((m) => m.ReaderShell),
    title: 'Mushaf Digital',
  },
  {
    path: 'penanda',
    loadComponent: () =>
      import('./features/bookmarks/bookmarks-manager').then((m) => m.BookmarksManager),
    title: 'Kelola penanda · Mushaf Digital',
  },
  {
    path: 'selamat-datang',
    loadComponent: () => import('./features/onboarding/welcome').then((m) => m.Welcome),
    title: 'Selamat datang · Mushaf Digital',
  },
  { path: '**', redirectTo: '' },
];

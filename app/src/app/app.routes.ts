import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { UserDataApi } from './core/contracts';
import { ReaderUiService } from './core/reader-ui.service';
import { verseLinkRedirect } from './core/verse-link';

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
    path: 'tema',
    loadComponent: () =>
      import('./features/theme-editor/theme-editor').then((m) => m.ThemeEditor),
    title: 'Buat tema sendiri · Mushaf Digital',
  },
  {
    path: 'doa-khatam',
    loadComponent: () => import('./features/doa/doa-khatam').then((m) => m.DoaKhatam),
    title: 'Doa Khatam · Mushaf Digital',
  },
  {
    // Tafsir reading page: Kemenag for everyone, Ibnu Katsir for the allow-listed account.
    path: 'tafsir/:surah',
    loadComponent: () => import('./features/tafsir/tafsir-reader').then((m) => m.TafsirReader),
    title: 'Tafsir · Mushaf Digital',
  },
  {
    // Owner-only usage dashboard (the API enforces it).
    path: 'statistik',
    loadComponent: () => import('./features/stats/stats-page').then((m) => m.StatsPage),
    title: 'Statistik · Mushaf Digital',
  },
  {
    path: 'grup',
    loadComponent: () => import('./features/groups/groups-page').then((m) => m.GroupsPage),
    title: 'Khatam bersama · Mushaf Digital',
  },
  {
    path: 'grup/gabung/:code',
    loadComponent: () => import('./features/groups/group-join').then((m) => m.GroupJoin),
    title: 'Undangan khatam bersama · Mushaf Digital',
  },
  {
    path: 'grup/:id',
    loadComponent: () => import('./features/groups/group-detail').then((m) => m.GroupDetail),
    title: 'Khatam bersama · Mushaf Digital',
  },
  {
    path: 'kartu/:surah/:ayah',
    loadComponent: () => import('./features/verse-card/verse-card').then((m) => m.VerseCard),
    title: 'Gambar ayat · Mushaf Digital',
  },
  {
    path: 'selamat-datang',
    loadComponent: () => import('./features/onboarding/welcome').then((m) => m.Welcome),
    title: 'Selamat datang · Mushaf Digital',
  },
  // Shared verse links: /59/3 opens the page with that ayah highlighted; /59 the surah's first page.
  { path: ':surah/:ayah', canActivate: [verseLinkRedirect], children: [] },
  { path: ':surah', canActivate: [verseLinkRedirect], children: [] },
  { path: '**', redirectTo: '' },
];

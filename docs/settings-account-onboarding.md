# Pengaturan, akun, onboarding

Code under `app/src/app/features/{sheets,onboarding,shell}`.

| Piece | File | Notes |
|---|---|---|
| `SettingsSheet` | `sheets/settings-sheet.ts` | Paper/UI theme pickers, layout mode, switches (`role="switch"`), links to tour/offline/account/about, JSON export/import. |
| `OfflineSheet` | `sheets/offline-sheet.ts` | `OfflineApi` only. Shows size estimate before download; clear is confirmed inline and never touches bookmarks. |
| `AccountSheet` | `sheets/account-sheet.ts` | Guest / login / signed-in states per `SyncStatus`; conflict + unauthorized cards; dev login only on localhost/127.0.0.1. |
| `AboutSheet` | `sheets/about-sheet.ts` | Edition info from `ContentApi.index().edition`. GitHub URL is a placeholder (TODO). |
| `Welcome` | `onboarding/welcome.ts` | Route `/selamat-datang`. Start sets `prefs.onboardingDone` then `ui.goToPage`. |
| `GestureTour` | `onboarding/gesture-tour.ts` | `<app-gesture-tour />`, 3 steps, Escape/Lewati/finish set `onboardingDone`. Focus trap, focus restored. |
| `ToastHost` | `shell/toast-host.ts` | `<app-toast-host />`, `role=status aria-live=polite`, lifts above bottom chrome. |
| helpers | `shell/format.ts` (+spec) | `formatRelativeTime`, `formatBytes`, `formatMb`, `exportFilename`, `importSummary`. |

Sheet bodies have no scrim/title/close; the sheet container owns those. Shared styles: `sheets/sheet-styles.ts`.

import { Routes } from '@angular/router';
import { MushafComponent } from './features/mushaf/mushaf.component';
import { AuthCallbackComponent } from './features/auth/auth-callback.component';

export const routes: Routes = [
    { path: 'auth/callback', component: AuthCallbackComponent },
    // { path: '**', redirectTo: '' } // Disable wildcard for now or keep it? If I keep it, random urls go to home. Home renders Mushaf manually. Safe.
    { path: '**', redirectTo: '' }
];

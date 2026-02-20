import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const auth = inject(AuthService);
    const token = localStorage.getItem('auth_token');

    const cloned = token
        ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) })
        : req;

    return next(cloned).pipe(
        catchError((err: HttpErrorResponse) => {
            if (err.status === 401) {
                // Token is expired or invalid — clear session and let user log in again
                console.warn('Auth interceptor: 401 received, logging out stale session');
                auth.logout();
            }
            return throwError(() => err);
        })
    );
};


import { Injectable, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { map, catchError, of, tap } from 'rxjs';
import { jwtDecode } from 'jwt-decode';

export interface User {
    id: string;
    email: string;
    name?: string;
    picture?: string;
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private apiUrl = `${environment.apiUrl}/auth`;
    currentUser = signal<User | null>(null);
    isLoading = signal<boolean>(false);

    constructor(private http: HttpClient, private router: Router) {
        // Restore session on init
        const token = localStorage.getItem('auth_token');
        if (token) {
            this.decodeAndSetUser(token);
        }
    }

    loginWithGoogle() {
        window.location.href = `${this.apiUrl}/google/login`;
    }

    register(email: string, password: string, name: string) {
        return this.http.post<{ token: string, user: User }>(`${this.apiUrl}/register`, { email, password, name }).pipe(
            tap(res => this.setSession(res.token))
        );
    }

    login(email: string, password: string) {
        return this.http.post<{ token: string, user: User }>(`${this.apiUrl}/login`, { email, password }).pipe(
            tap(res => this.setSession(res.token))
        );
    }

    logout() {
        localStorage.removeItem('auth_token');
        this.currentUser.set(null);
        this.router.navigate(['/']);
    }

    private setSession(token: string) {
        localStorage.setItem('auth_token', token);
        this.decodeAndSetUser(token);
    }

    private decodeAndSetUser(token: string) {
        try {
            console.log('Decoding token:', token);
            const decoded: any = jwtDecode(token);
            console.log('Decoded user:', decoded);
            this.currentUser.set({
                id: decoded.id,
                email: decoded.email,
                name: decoded.name,
                picture: decoded.picture
            });
        } catch (e) {
            console.error('Invalid token', e);
            this.logout();
        }
    }

    handleCallback(token: string) {
        this.setSession(token);
        this.router.navigate(['/']);
    }
}

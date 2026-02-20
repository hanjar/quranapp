
import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
    selector: 'app-auth-callback',
    standalone: true,
    template: `<div class="p-8 text-center">Logging in...</div>`
})
export class AuthCallbackComponent implements OnInit {
    route = inject(ActivatedRoute);
    auth = inject(AuthService);

    ngOnInit() {
        const token = this.route.snapshot.queryParamMap.get('token');
        console.log('AuthCallbackComponent init, token:', token);
        if (token) {
            this.auth.handleCallback(token);
        } else {
            console.error('No token found in callback URL');
        }
    }
}

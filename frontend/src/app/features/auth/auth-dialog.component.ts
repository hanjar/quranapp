
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-auth-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-backdrop" (click)="close()">
      <div class="auth-dialog" (click)="$event.stopPropagation()">
        
        <!-- Header -->
        <div class="dialog-header">
          <h2 class="dialog-title">
            {{ isLogin() ? 'Masuk Akun' : 'Daftar Akun' }}
          </h2>
          <button (click)="close()" class="close-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="dialog-body">
          
          <!-- Mode Toggle -->
          <div class="mode-toggle">
            <button 
              class="toggle-btn"
              [class.active]="isLogin()"
              (click)="isLogin.set(true)"
            >
              Masuk
            </button>
            <button 
              class="toggle-btn"
              [class.active]="!isLogin()"
              (click)="isLogin.set(false)"
            >
              Daftar
            </button>
          </div>

          <!-- Google Login -->
          <button (click)="loginGoogle()" class="google-btn">
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google">
            <span>Lanjutkan dengan Google</span>
          </button>

          <div class="divider">
            <span>atau</span>
          </div>

          <!-- Email Form -->
          <form (ngSubmit)="submit()" class="auth-form">
            <div *ngIf="!isLogin()">
              <label>Nama Lengkap</label>
              <input type="text" [(ngModel)]="name" name="name" required>
            </div>

            <div>
              <label>Email</label>
              <input type="email" [(ngModel)]="email" name="email" required>
            </div>

            <div>
              <label>Password</label>
              <input type="password" [(ngModel)]="password" name="password" required minlength="6">
            </div>

            <div *ngIf="!isLogin()">
               <label>Konfirmasi Password</label>
               <input type="password" [(ngModel)]="confirmPassword" name="confirmPassword" required>
               <p *ngIf="password && confirmPassword && password !== confirmPassword" class="error-text">Password tidak sama</p>
             </div>

            <button type="submit" class="submit-btn" [disabled]="isLoading() || (!isLogin() && password !== confirmPassword)">
              {{ isLoading() ? 'Loading...' : (isLogin() ? 'Masuk' : 'Daftar') }}
            </button>

            <p *ngIf="errorMessage()" class="error-message">{{ errorMessage() }}</p>
          </form>

        </div>
      </div>
    </div>
  `,
  styles: `
    .auth-backdrop {
      position: fixed;
      inset: 0;
      z-index: 300; /* Higher than surah list (200) */
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
    }
    .auth-dialog {
      width: 100%;
      max-width: 400px;
      background: #fdf8f0;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid rgba(26, 58, 42, 0.1);
    }
    .dialog-title {
      font-size: 18px;
      font-weight: 700;
      color: #1a3a2a;
      font-family: 'Amiri', serif;
      margin: 0;
    }
    .close-btn {
      padding: 8px;
      border-radius: 50%;
      background: transparent;
      border: none;
      cursor: pointer;
      color: #1a3a2a;
      &:hover { background: rgba(26, 58, 42, 0.1); }
    }
    .dialog-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .mode-toggle {
      display: flex;
      padding: 4px;
      background: rgba(26, 58, 42, 0.05);
      border-radius: 8px;
    }
    .toggle-btn {
      flex: 1;
      padding: 8px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: #8b7355;
      cursor: pointer;
      transition: all 0.2s;
      &.active {
        background: white;
        color: #1a3a2a;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      }
    }
    .google-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 10px;
      background: white;
      border: 1px solid rgba(26, 58, 42, 0.1);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
      img { width: 20px; height: 20px; }
      span { color: #1a3a2a; font-weight: 500; }
      &:hover { background: #f9fafb; }
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 16px;
      color: #8b7355;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      &::before, &::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(26, 58, 42, 0.1);
      }
    }
    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #1a3a2a;
      margin-bottom: 4px;
    }
    input {
      width: 100%;
      padding: 10px 16px;
      background: white;
      border: 1px solid rgba(26, 58, 42, 0.1);
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      &:focus {
        border-color: #c4a87c;
        box-shadow: 0 0 0 2px rgba(196, 168, 124, 0.2);
      }
    }
    .submit-btn {
      width: 100%;
      padding: 12px;
      background: #1a3a2a;
      color: #fdf8f0;
      font-weight: 500;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
      &:hover { background: #0d2818; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .error-text {
      font-size: 12px;
      color: #c0392b;
      margin-top: 4px;
    }
    .error-message {
      font-size: 14px;
      color: #c0392b;
      text-align: center;
    }
  `
})
export class AuthDialogComponent {
  authService = inject(AuthService);

  isLogin = signal(true);
  isLoading = signal(false);
  errorMessage = signal('');

  name = '';
  email = '';
  password = '';
  confirmPassword = '';

  onClose: () => void = () => { };

  close() {
    this.onClose();
  }

  loginGoogle() {
    this.authService.loginWithGoogle();
  }

  submit() {
    if (this.isLogin()) {
      this.isLoading.set(true);
      this.errorMessage.set('');
      this.authService.login(this.email, this.password).subscribe({
        next: () => {
          this.isLoading.set(false);
          this.close();
        },
        error: (err) => {
          this.isLoading.set(false);
          this.errorMessage.set(err.error?.error || 'Gagal masuk');
        }
      });
    } else {
      if (this.password !== this.confirmPassword) {
        this.errorMessage.set('Password tidak sama');
        return;
      }
      this.isLoading.set(true);
      this.errorMessage.set('');
      this.authService.register(this.email, this.password, this.name).subscribe({
        next: () => {
          this.isLoading.set(false);
          this.close();
        },
        error: (err) => {
          this.isLoading.set(false);
          this.errorMessage.set(err.error?.error || 'Gagal daftar');
        }
      });
    }
  }
}

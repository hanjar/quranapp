import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SyncApi } from '../../core/contracts';
import { GroupsApi, groupErrorText } from '../../core/groups/groups-api';
import { GROUP_PAGE_STYLES } from './group-shell';

/** /grup/gabung/:code — the invite link: sign in if needed, pick a nickname, join. */
@Component({
  selector: 'app-group-join',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali" (click)="back()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1 class="mf-display">Undangan khatam bersama</h1>
    </header>
    <main class="wrap">
      @if (!sync.account()) {
        <section class="card">
          <h2>Anda diundang ke khatam bersama</h2>
          <p class="muted">Masuk dulu agar progres juz Anda tersimpan dan terlihat oleh anggota grup.</p>
          <button type="button" class="mf-btn mf-btn--primary" (click)="sync.signIn('google')">Masuk dengan Google</button>
        </section>
      } @else if (invite(); as inv) {
        <section class="card">
          <h2>{{ inv.name }}</h2>
          <p class="muted">{{ inv.memberCount }} anggota · Kode {{ code() }}</p>
          <label class="muted" for="gj-nick">Nama panggilan Anda di grup</label>
          <input id="gj-nick" class="mf-input" type="text" maxlength="40" [value]="nickname()"
            (input)="nickname.set($any($event.target).value)" (keydown.enter)="join()" />
          <button type="button" class="mf-btn mf-btn--primary" [disabled]="busy() || !nickname().trim()" (click)="join()">
            Gabung
          </button>
        </section>
      } @else if (error()) {
        <p class="err">{{ error() }}</p>
        <button type="button" class="mf-btn mf-btn--outline" (click)="back()">Ke daftar grup</button>
      } @else {
        <p class="muted">Memuat undangan…</p>
      }
    </main>
  `,
  styles: GROUP_PAGE_STYLES,
})
export class GroupJoin {
  protected readonly sync = inject(SyncApi);
  private readonly api = inject(GroupsApi);
  private readonly router = inject(Router);

  readonly code = input<string>('');
  protected readonly invite = signal<{ name: string; memberCount: number } | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly nickname = signal('');
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const acc = this.sync.account();
      const code = this.code();
      if (!acc) return;
      untracked(() => {
        if (!this.nickname()) this.nickname.set((acc.name ?? '').slice(0, 40));
        void this.api
          .invite(code)
          .then((i) => this.invite.set(i))
          .catch((e) => this.error.set(groupErrorText(e)));
      });
    });
  }

  protected async join(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const g = await this.api.join(this.code(), this.nickname().trim() || undefined);
      void this.router.navigate(['/grup', g.id], { replaceUrl: true });
    } catch (e) {
      this.error.set(groupErrorText(e));
      this.invite.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  protected back(): void {
    void this.router.navigate(['/grup']);
  }
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SyncApi, UserDataApi } from '../../core/contracts';
import { GroupSummary, GroupsApi, groupErrorText } from '../../core/groups/groups-api';
import { GROUP_PAGE_STYLES } from './group-shell';

/** /grup — my khatam bersama groups, create one, or join with a code. */
@Component({
  selector: 'app-groups-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali ke mushaf" (click)="back()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1 class="mf-display">Khatam bersama</h1>
    </header>
    <main class="wrap">
      <p class="muted">
        Baca Al-Qur'an bersama keluarga, kantor, atau komunitas: 30 juz dibagi ke anggota, tiap orang
        menandai juz yang sudah selesai, dan grup khatam bersama-sama.
      </p>

      @if (!sync.account()) {
        <section class="card">
          <h2>Masuk dulu</h2>
          <p class="muted">Khatam bersama memakai akun agar anggota grup bisa melihat progres masing-masing.</p>
          <button type="button" class="mf-btn mf-btn--primary" (click)="sync.signIn('google')">Masuk dengan Google</button>
        </section>
      } @else {
        @if (loading()) {
          <p class="muted">Memuat grup…</p>
        } @else if (error()) {
          <p class="err">{{ error() }}</p>
          <button type="button" class="mf-btn mf-btn--outline" (click)="load()">Coba lagi</button>
        } @else if (groups().length) {
          <section class="list" aria-label="Grup saya">
            @for (g of groups(); track g.id) {
              <button type="button" class="card group" (click)="open(g.id)">
                <span class="group__head">
                  <strong>{{ g.name }}</strong>
                  <span class="muted">{{ g.memberCount }} anggota</span>
                </span>
                <span class="bar" aria-hidden="true"><span [style.width.%]="(g.doneCount / 30) * 100"></span></span>
                <span class="muted">
                  Putaran {{ g.round }} · {{ g.doneCount }}/30 juz selesai
                  @if (g.khatamCount) { · {{ g.khatamCount }}× khatam }
                </span>
                @if (g.myJuz.length) {
                  <span class="chips">
                    @for (j of g.myJuz; track j.juz) {
                      <span class="chip" [class.is-done]="j.done">Juz {{ j.juz }}{{ j.done ? ' ✓' : '' }}</span>
                    }
                  </span>
                }
              </button>
            }
          </section>
        }

        <section class="card">
          <h2>Buat grup baru</h2>
          <div class="row">
            <input class="mf-input" type="text" maxlength="60" placeholder="Nama grup, mis. ODOJ Keluarga"
              aria-label="Nama grup" [value]="newName()" (input)="newName.set($any($event.target).value)"
              (keydown.enter)="create()" />
            <button type="button" class="mf-btn mf-btn--primary" [disabled]="busy() || !newName().trim()" (click)="create()">Buat</button>
          </div>
        </section>

        <section class="card">
          <h2>Gabung dengan kode</h2>
          <div class="row">
            <input class="mf-input code" type="text" maxlength="9" placeholder="Kode undangan" autocapitalize="characters"
              aria-label="Kode undangan" [value]="code()" (input)="code.set($any($event.target).value)"
              (keydown.enter)="join()" />
            <button type="button" class="mf-btn mf-btn--outline" [disabled]="code().trim().length < 8" (click)="join()">Gabung</button>
          </div>
          <p class="muted">Atau buka tautan undangan yang dikirim pembuat grup.</p>
        </section>
      }
    </main>
  `,
  styles: `
    ${GROUP_PAGE_STYLES}
    .list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .group {
      text-align: left;
      color: var(--ui-ink);
      font: inherit;
      cursor: pointer;
    }
    .group__head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: baseline;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      padding: 2px 10px;
      border-radius: var(--mf-radius-pill);
      border: 1px solid var(--ui-primary);
      font-size: 13px;
    }
    .chip.is-done {
      background: var(--ui-primary);
      color: var(--ui-on-primary, #fff);
    }
    .code {
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
  `,
})
export class GroupsPage {
  protected readonly sync = inject(SyncApi);
  private readonly api = inject(GroupsApi);
  private readonly router = inject(Router);
  private readonly userData = inject(UserDataApi);

  protected readonly groups = signal<GroupSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly newName = signal('');
  protected readonly code = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.groups.set(await this.api.list());
    } catch (e) {
      this.error.set(groupErrorText(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      const g = await this.api.create(name);
      void this.router.navigate(['/grup', g.id]);
    } catch (e) {
      this.error.set(groupErrorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected join(): void {
    const c = this.code().trim().toUpperCase().replace(/[\s-]/g, '');
    if (c.length === 8) void this.router.navigate(['/grup/gabung', c]);
  }

  protected open(id: string): void {
    void this.router.navigate(['/grup', id]);
  }

  protected back(): void {
    void this.router.navigate(['/hal', this.userData.position()?.page ?? 1]);
  }
}

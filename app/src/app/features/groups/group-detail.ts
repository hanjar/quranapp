import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { ContentApi } from '../../core/contracts';
import { GroupDetail as Group, GroupsApi, groupErrorText, inviteUrl } from '../../core/groups/groups-api';
import { ReaderUiService } from '../../core/reader-ui.service';
import { GROUP_PAGE_STYLES } from './group-shell';
import { doneCount, juzPages, juzRanges, memberProgress } from './group-logic';

/** Refresh while the page is open, so other members' progress shows up. */
const POLL_MS = 30_000;

/** /grup/:id — one khatam bersama group. */
@Component({
  selector: 'app-group-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Daftar grup" (click)="toList()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1 class="mf-display">{{ g()?.name ?? 'Khatam bersama' }}</h1>
    </header>
    <main class="wrap">
      @if (error()) {
        <p class="err" role="alert">{{ error() }}</p>
      }
      @if (g(); as g) {
        <section class="card hero">
          <p class="muted">Putaran {{ g.round }}@if (g.khatamCount) { · sudah {{ g.khatamCount }}× khatam bersama }</p>
          <p class="big">{{ done() }}<small>/30 juz selesai</small></p>
          <span class="bar" aria-hidden="true"><span [style.width.%]="(done() / 30) * 100"></span></span>
          @if (done() === 30) {
            <p><strong>Alhamdulillah, grup ini khatam!</strong></p>
            <button type="button" class="mf-btn mf-btn--primary" [disabled]="busy()" (click)="nextRound()">
              Mulai putaran berikutnya
            </button>
            <p class="muted">Setiap anggota lanjut ke juz berikutnya (juz 1 → 2, …, 30 → 1).</p>
          }
        </section>

        <section class="card" aria-labelledby="gd-mine">
          <h2 id="gd-mine">Juz saya</h2>
          @if (myJuz().length) {
            @for (j of myJuz(); track j.juz) {
              <div class="mine" [class.is-done]="j.done">
                <span class="mine__label">
                  <strong>Juz {{ j.juz }}</strong>
                  @if (pages(j.juz); as p) { <span class="muted">hal. {{ p.from }}–{{ p.to }}</span> }
                </span>
                <button type="button" class="mf-btn mf-btn--ghost" (click)="read(j.juz)">Baca</button>
                <button type="button" class="mf-btn" [class.mf-btn--primary]="!j.done" [class.mf-btn--outline]="j.done"
                  [disabled]="busy()" (click)="mark(j.juz, !j.done)">
                  {{ j.done ? '✓ Selesai' : 'Tandai selesai' }}
                </button>
              </div>
            }
          } @else {
            <p class="muted">Belum ada juz untuk Anda di putaran ini. Ambil juz yang kosong di bawah, atau minta pembuat grup membagi rata.</p>
          }
        </section>

        <section class="card" aria-labelledby="gd-all">
          <h2 id="gd-all">Semua juz</h2>
          <div class="grid" role="list">
            @for (j of g.juz; track j.juz) {
              <button type="button" role="listitem" class="tile"
                [class.is-done]="j.done" [class.is-mine]="j.memberId === g.me" [class.is-free]="!j.memberId"
                [attr.aria-label]="'Juz ' + j.juz + ', ' + holderName(j.memberId) + (j.done ? ', selesai' : '')"
                (click)="tile(j.juz)">{{ j.juz }}</button>
            }
          </div>
          <p class="legend muted">
            <span class="dot is-done"></span> selesai <span class="dot"></span> belum <span class="dot is-free"></span> kosong ·
            garis tebal = juz Anda
          </p>
          @if (picked(); as p) {
            <div class="pick">
              <p>
                <strong>Juz {{ p }}</strong> · {{ holderName(holderOf(p)) }}
                @if (isDone(p)) { · selesai }
              </p>
              <div class="row wrap-row">
                <button type="button" class="mf-btn mf-btn--ghost" (click)="read(p)">Baca</button>
                @if (!holderOf(p)) {
                  <button type="button" class="mf-btn mf-btn--outline" [disabled]="busy()" (click)="assign(p, g.me)">Ambil juz ini</button>
                }
                @if (g.isOwner) {
                  <select class="mf-input" aria-label="Berikan ke anggota" (change)="assignFromSelect(p, $event)">
                    <option value="" selected disabled>Berikan ke…</option>
                    @for (m of g.members; track m.id) {
                      <option [value]="m.id">{{ m.nickname }}</option>
                    }
                    <option value="-">Kosongkan</option>
                  </select>
                  <button type="button" class="mf-btn mf-btn--ghost" [disabled]="busy()" (click)="mark(p, !isDone(p))">
                    {{ isDone(p) ? 'Batalkan selesai' : 'Tandai selesai' }}
                  </button>
                }
              </div>
            </div>
          }
        </section>

        <section class="card" aria-labelledby="gd-members">
          <h2 id="gd-members">Anggota ({{ g.members.length }})</h2>
          <ul class="members">
            @for (m of members(); track m.id) {
              <li>
                <span>
                  <strong>{{ m.nickname }}</strong>
                  @if (m.isMe) { <span class="tag">Anda</span> }
                  @if (m.isOwner) { <span class="tag">pembuat</span> }
                </span>
                <span class="muted">
                  @if (m.juz.length) { Juz {{ ranges(m.juz) }} · {{ m.done }}/{{ m.juz.length }} } @else { belum ada juz }
                </span>
              </li>
            }
          </ul>
        </section>

        <section class="card" aria-labelledby="gd-invite">
          <h2 id="gd-invite">Undang anggota</h2>
          <p class="muted">Kode <strong class="code">{{ g.inviteCode }}</strong></p>
          <div class="row wrap-row">
            <button type="button" class="mf-btn mf-btn--primary" (click)="shareInvite()">Bagikan undangan</button>
            <button type="button" class="mf-btn mf-btn--outline" (click)="copyInvite()">Salin tautan</button>
          </div>
        </section>

        <section class="card" aria-labelledby="gd-settings">
          <h2 id="gd-settings">Pengaturan grup</h2>
          <div class="row">
            <input class="mf-input" type="text" maxlength="40" aria-label="Nama panggilan Anda" [value]="myNickname()"
              (input)="nick.set($any($event.target).value)" />
            <button type="button" class="mf-btn mf-btn--outline" [disabled]="busy() || !nick().trim()" (click)="saveNick()">Simpan nama</button>
          </div>
          @if (g.isOwner) {
            <div class="row">
              <input class="mf-input" type="text" maxlength="60" aria-label="Nama grup" [value]="g.name"
                (input)="rename.set($any($event.target).value)" />
              <button type="button" class="mf-btn mf-btn--outline" [disabled]="busy() || !rename().trim()" (click)="saveName()">Ganti nama</button>
            </div>
            <button type="button" class="mf-btn mf-btn--outline" [disabled]="busy()" (click)="distribute()">
              Bagi rata juz yang belum selesai
            </button>
            @if (done() < 30) {
              <button type="button" class="mf-btn mf-btn--ghost" [disabled]="busy()" (click)="nextRound(true)">
                Mulai putaran berikutnya sekarang
              </button>
            }
          }
          <button type="button" class="mf-btn mf-btn--ghost danger" [disabled]="busy()" (click)="leave()">Keluar dari grup</button>
          @if (g.isOwner) {
            <button type="button" class="mf-btn mf-btn--ghost danger" [disabled]="busy()" (click)="remove()">Hapus grup</button>
          }
        </section>
      } @else if (!error()) {
        <p class="muted">Memuat grup…</p>
      }
    </main>
  `,
  styles: `
    ${GROUP_PAGE_STYLES}
    .hero .big {
      font-size: 34px;
      font-weight: 600;
      line-height: 1.1;
    }
    .hero .big small {
      font-size: 15px;
      font-weight: 400;
      color: var(--ui-muted);
      margin-left: 6px;
    }
    .mine {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 0;
      border-top: 1px solid var(--ui-hair);
    }
    .mine__label {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .mine.is-done .mine__label strong::after {
      content: ' ✓';
      color: var(--ui-primary);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
    }
    .tile {
      min-height: 42px;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--ui-primary) 55%, transparent);
      background: transparent;
      color: var(--ui-ink);
      font: inherit;
      font-weight: 600;
    }
    .tile.is-done {
      background: var(--ui-primary);
      color: var(--ui-on-primary, #fff);
      border-color: var(--ui-primary);
    }
    .tile.is-free {
      border-style: dashed;
      color: var(--ui-muted);
    }
    .tile.is-mine {
      box-shadow: inset 0 0 0 2px var(--ui-ink);
    }
    .legend {
      font-size: 12.5px;
    }
    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      border: 1px solid var(--ui-primary);
      vertical-align: -1px;
      margin-left: 6px;
    }
    .dot.is-done {
      background: var(--ui-primary);
    }
    .dot.is-free {
      border-style: dashed;
    }
    .pick {
      padding: 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--ui-primary) 7%, transparent);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .wrap-row {
      flex-wrap: wrap;
    }
    .members {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    .members li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 0;
      border-top: 1px solid var(--ui-hair);
    }
    .tag {
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 6px;
      font-size: 11.5px;
      background: color-mix(in srgb, var(--ui-primary) 14%, transparent);
    }
    .code {
      letter-spacing: 0.1em;
      color: var(--ui-ink);
    }
    .danger {
      color: var(--mf-danger);
    }
  `,
})
export class GroupDetail {
  private readonly api = inject(GroupsApi);
  private readonly content = inject(ContentApi);
  private readonly ui = inject(ReaderUiService);
  private readonly router = inject(Router);

  readonly id = input<string>('');
  protected readonly g = signal<Group | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly picked = signal<number | null>(null);
  protected readonly nick = signal('');
  protected readonly rename = signal('');

  protected readonly done = computed(() => {
    const g = this.g();
    return g ? doneCount(g) : 0;
  });
  protected readonly members = computed(() => {
    const g = this.g();
    return g ? memberProgress(g) : [];
  });
  protected readonly myJuz = computed(() => {
    const g = this.g();
    return g ? g.juz.filter((j) => j.memberId === g.me) : [];
  });
  protected readonly myNickname = computed(() => {
    const g = this.g();
    return g?.members.find((m) => m.id === g.me)?.nickname ?? '';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.refresh(id));
    });
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.busy()) void this.refresh(this.id(), true);
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void this.refresh(this.id(), true);
    };
    document.addEventListener('visibilitychange', onVis);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    });
  }

  private async refresh(id: string, quiet = false): Promise<void> {
    try {
      this.g.set(await this.api.get(id));
      this.error.set(null);
    } catch (e) {
      if (!quiet || !this.g()) this.error.set(groupErrorText(e));
    }
  }

  private async act(fn: () => Promise<Group>, okMsg?: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.g.set(await fn());
      this.error.set(null);
      if (okMsg) this.ui.showToast({ message: okMsg });
    } catch (e) {
      this.ui.showToast({ message: groupErrorText(e) });
    } finally {
      this.busy.set(false);
    }
  }

  protected pages(n: number) {
    const idx = this.content.index();
    return idx ? juzPages(idx.juz, n) : null;
  }

  protected ranges = juzRanges;

  protected holderOf(juz: number): string | null {
    return this.g()?.juz.find((j) => j.juz === juz)?.memberId ?? null;
  }

  protected isDone(juz: number): boolean {
    return !!this.g()?.juz.find((j) => j.juz === juz)?.done;
  }

  protected holderName(memberId: string | null): string {
    const g = this.g();
    if (!memberId) return 'belum ada yang membaca';
    const m = g?.members.find((x) => x.id === memberId);
    return m ? (m.id === g?.me ? `${m.nickname} (Anda)` : m.nickname) : 'anggota';
  }

  protected tile(juz: number): void {
    this.picked.set(this.picked() === juz ? null : juz);
  }

  protected read(juz: number): void {
    const p = this.pages(juz);
    void this.router.navigate(['/hal', p?.from ?? 1]);
  }

  protected mark(juz: number, done: boolean): Promise<void> {
    const g = this.g();
    if (!g) return Promise.resolve();
    return this.act(() => this.api.mark(g.id, juz, done), done ? `Juz ${juz} ditandai selesai` : undefined);
  }

  protected assign(juz: number, memberId: string | null): Promise<void> {
    const g = this.g();
    if (!g) return Promise.resolve();
    return this.act(() => this.api.assign(g.id, juz, memberId));
  }

  protected assignFromSelect(juz: number, e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    void this.assign(juz, v === '-' ? null : v);
  }

  protected distribute(): Promise<void> {
    const g = this.g();
    if (!g) return Promise.resolve();
    return this.act(() => this.api.distribute(g.id), 'Juz dibagi rata');
  }

  protected nextRound(force = false): Promise<void> {
    const g = this.g();
    if (!g) return Promise.resolve();
    if (force && !confirm('Mulai putaran berikutnya sekarang? Juz yang belum selesai tidak dihitung khatam.'))
      return Promise.resolve();
    return this.act(() => this.api.nextRound(g.id), 'Putaran baru dimulai');
  }

  protected saveNick(): Promise<void> {
    const g = this.g();
    if (!g) return Promise.resolve();
    return this.act(() => this.api.update(g.id, { nickname: this.nick().trim() }), 'Nama panggilan disimpan');
  }

  protected saveName(): Promise<void> {
    const g = this.g();
    if (!g) return Promise.resolve();
    return this.act(() => this.api.update(g.id, { name: this.rename().trim() }), 'Nama grup diganti');
  }

  private inviteText(g: Group): string {
    return `Ayo ikut khatam bersama "${g.name}" di Mushaf Digital. Buka: ${inviteUrl(location.origin, g.inviteCode)} (kode ${g.inviteCode})`;
  }

  protected async shareInvite(): Promise<void> {
    const g = this.g();
    if (!g) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: this.inviteText(g) });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await this.copyInvite();
  }

  protected async copyInvite(): Promise<void> {
    const g = this.g();
    if (!g) return;
    try {
      await navigator.clipboard.writeText(this.inviteText(g));
      this.ui.showToast({ message: 'Undangan disalin' });
    } catch {
      this.ui.showToast({ message: `Kode undangan: ${g.inviteCode}` });
    }
  }

  protected async leave(): Promise<void> {
    const g = this.g();
    if (!g || !confirm(`Keluar dari "${g.name}"? Juz Anda yang belum selesai menjadi kosong.`)) return;
    try {
      await this.api.leave(g.id);
      this.toList();
    } catch (e) {
      this.ui.showToast({ message: groupErrorText(e) });
    }
  }

  protected async remove(): Promise<void> {
    const g = this.g();
    if (!g || !confirm(`Hapus grup "${g.name}" untuk semua anggota?`)) return;
    try {
      await this.api.remove(g.id);
      this.toList();
    } catch (e) {
      this.ui.showToast({ message: groupErrorText(e) });
    }
  }

  protected toList(): void {
    void this.router.navigate(['/grup']);
  }
}

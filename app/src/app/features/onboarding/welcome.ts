import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import { PAPER_THEMES, UI_THEMES } from '../../core/theme.service';

/** Route component for `/selamat-datang` (prototype "A Peluncuran"). */
@Component({
  selector: 'app-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: fixed; inset: 0; z-index: var(--mf-z-overlay); overflow-y: auto; background: var(--ui-welcome); color: var(--ui-ink); font-family: var(--ui-font); }
    .wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: calc(48px + var(--mf-safe-top)) 24px calc(48px + var(--mf-safe-bottom)); }
    .col { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 28px; }
    .head { display: flex; flex-direction: column; gap: 14px; align-items: center; text-align: center; }
    .orn { display: flex; align-items: center; gap: 10px; }
    .orn .ln { width: 40px; height: 1px; background: var(--ui-accent); }
    .orn .dm { width: 6px; height: 6px; transform: rotate(45deg); border: 1px solid var(--ui-accent); }
    h1 { margin: 0; font-family: var(--ui-display); font-weight: 500; font-size: 44px; line-height: 1; letter-spacing: -0.01em; }
    .tag { margin: 0; font-family: var(--ui-display); font-size: 19px; line-height: 1.4; color: var(--ui-ink2); text-wrap: pretty; }
    .grp { display: flex; flex-direction: column; gap: 10px; }
    .lbl { font-size: 13px; font-weight: 500; color: var(--ui-ink2); }
    .g3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .g2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .card { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: var(--mf-radius-lg); background: transparent; text-align: left; border: 1px solid var(--ui-line); }
    .card[aria-pressed='true'] { border: 2px solid var(--ui-primary); padding: 7px; }
    .sw { display: block; height: 64px; border-radius: var(--mf-radius-sm); border: 1px solid var(--ui-line); }
    .nm { font-size: 13px; line-height: 1.25; color: var(--ui-ink); }
    .sub { font-size: 11.5px; color: var(--ui-muted); }
    .dots { display: flex; gap: 6px; }
    .dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--ui-line); }
    .cta { min-height: 52px; font-size: 15.5px; }
    .link { min-height: var(--mf-tap); border: none; background: transparent; color: var(--ui-primary); font-size: 14.5px; text-decoration: underline; text-underline-offset: 3px; }
    .foot { margin: 0; text-align: center; font-size: 13px; color: var(--ui-muted); }
  `,
  template: `
    <div class="wrap">
      <main class="col">
        <header class="head">
          <div class="orn" aria-hidden="true"><span class="ln"></span><span class="dm"></span><span class="ln"></span></div>
          <h1>Mushaf</h1>
          <p class="tag">Bacaan yang tenang, setia pada halaman mushaf cetak.</p>
        </header>

        <section class="grp" aria-labelledby="w-paper">
          <div class="lbl" id="w-paper">Pilih warna kertas</div>
          <div class="g3">
            @for (t of paperThemes; track t.id) {
              <button type="button" class="card" [attr.aria-pressed]="prefs().paperTheme === t.id" (click)="data.setPrefs({ paperTheme: t.id })">
                <span class="sw" [style.background]="t.hex"></span>
                <span class="nm">{{ t.name }}</span>
              </button>
            }
          </div>
        </section>

        <section class="grp" aria-labelledby="w-ui">
          <div class="lbl" id="w-ui">Pilih gaya antarmuka</div>
          <div class="g2">
            @for (u of uiThemes; track u.id) {
              <button type="button" class="card" [attr.aria-pressed]="prefs().uiTheme === u.id" (click)="data.setPrefs({ uiTheme: u.id })">
                <span class="nm">{{ u.name }}</span>
                <span class="sub">{{ u.fontName }}</span>
                <span class="dots" aria-hidden="true">
                  <span class="dot" [style.background]="u.primary"></span>
                  <span class="dot" [style.background]="u.accent"></span>
                </span>
              </button>
            }
          </div>
        </section>

        <div class="grp">
          @if (resume(); as r) {
            <button type="button" class="mf-btn mf-btn--primary cta" (click)="start(r.page)">Lanjutkan · {{ r.label }}</button>
            <button type="button" class="mf-btn mf-btn--outline" (click)="start(1)">Mulai dari awal</button>
          } @else {
            <button type="button" class="mf-btn mf-btn--primary cta" (click)="start(1)">Mulai membaca</button>
          }
          <button type="button" class="link" (click)="ui.tourOpen.set(true)">Lihat panduan gestur</button>
        </div>

        <p class="foot">Tanpa akun. Progres tersimpan di perangkat ini.</p>
      </main>
    </div>
  `,
})
export class Welcome {
  protected readonly data = inject(UserDataApi);
  protected readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);

  protected readonly paperThemes = PAPER_THEMES;
  protected readonly uiThemes = UI_THEMES;
  protected readonly prefs = this.data.prefs;

  protected readonly resume = computed(() => {
    const pos = this.data.position();
    if (!pos) return null;
    const idx = this.content.index();
    const name = idx ? this.content.surahAt(pos.page).nameLatin : '';
    return { page: pos.page, label: `${name ? name + ', ' : ''}hal. ${pos.page}` };
  });

  constructor() {
    void this.content.load();
  }

  protected async start(page: number): Promise<void> {
    await this.data.setPrefs({ onboardingDone: true });
    this.ui.goToPage(page);
  }
}

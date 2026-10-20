import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BUILD_INFO } from '../../core/build-info';
import { UserDataApi } from '../../core/contracts';
import { ReaderUiService } from '../../core/reader-ui.service';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  FeedbackContext,
  FeedbackResult,
  MESSAGE_MAX,
  MESSAGE_MIN,
  buildContext,
  buildRequest,
  contextRows,
  messageLength,
  submitFeedback,
  FeedbackError,
} from './feedback-api';
import { SHEET_STYLES } from './sheet-styles';

const DRAFT_KEY = 'mf-feedback-draft';

function readDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(v: string): void {
  try {
    if (v) sessionStorage.setItem(DRAFT_KEY, v);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: draft just isn't persisted */
  }
}

/** Body of the "Kirim masukan" sheet. Creates a public GitHub issue via the Worker. */
@Component({
  selector: 'app-feedback-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    SHEET_STYLES,
    `
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        min-height: var(--mf-tap);
        padding: 0 16px;
        border-radius: var(--mf-radius-pill);
        border: 1px solid var(--ui-line);
        background: transparent;
        font-size: 14px;
      }
      .chip[aria-pressed='true'] {
        border: 2px solid var(--ui-primary);
        background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
        font-weight: 600;
        padding: 0 15px;
      }
      textarea.mf-input {
        min-height: 140px;
        padding: 12px 16px;
        resize: vertical;
        line-height: 1.5;
      }
      .count {
        display: flex;
        justify-content: space-between;
        font-size: 12.5px;
        color: var(--ui-muted);
      }
      .count .bad {
        color: var(--mf-danger);
      }
      .check {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: var(--mf-tap);
        font-size: 14.5px;
      }
      .check input {
        width: 20px;
        height: 20px;
        accent-color: var(--ui-primary);
      }
      details summary {
        min-height: var(--mf-tap);
        display: flex;
        align-items: center;
        color: var(--ui-primary);
        font-size: 14px;
        cursor: pointer;
      }
      .hp {
        position: absolute;
        left: -10000px;
        top: auto;
        width: 1px;
        height: 1px;
        overflow: hidden;
      }
    `,
  ],
  template: `
    @if (result(); as r) {
      <section aria-label="Terkirim" role="status">
        <div class="panel">
          <strong>Terima kasih!</strong>
          <p>Masukan Anda sudah kami terima.</p>
          @if (r.issueUrl) {
            <a class="link" [href]="r.issueUrl" target="_blank" rel="noopener noreferrer"
              >Lihat di GitHub</a
            >
          }
          <button type="button" class="mf-btn mf-btn--outline" (click)="again()">
            Kirim masukan lain
          </button>
        </div>
      </section>
    } @else {
      <form (submit)="$event.preventDefault(); send()" novalidate>
        <section aria-labelledby="fb-cat">
          <h3 id="fb-cat">Jenis masukan</h3>
          <div class="chips" role="group" aria-labelledby="fb-cat">
            @for (c of categories; track c.id) {
              <button
                type="button"
                class="chip"
                [attr.aria-pressed]="category() === c.id"
                (click)="category.set(c.id)"
              >
                {{ c.label }}
              </button>
            }
          </div>
        </section>

        <section>
          <label for="fb-msg"><h3>Pesan</h3></label>
          <textarea
            id="fb-msg"
            class="mf-input"
            rows="6"
            placeholder="Ceritakan saran atau masalah yang Anda temui…"
            [value]="message()"
            [attr.aria-describedby]="'fb-count'"
            (input)="onInput($any($event.target).value)"
          ></textarea>
          <div class="count" id="fb-count">
            <span [class.bad]="touched() && !valid()">{{ hint() }}</span>
            <span>{{ length() }} / {{ max }}</span>
          </div>
        </section>

        <section>
          <label class="check">
            <input
              type="checkbox"
              [checked]="withContext()"
              (change)="withContext.set($any($event.target).checked)"
            />
            Sertakan info teknis
          </label>
          <details>
            <summary>Lihat yang dikirim</summary>
            @if (withContext()) {
              <dl>
                @for (row of rows(); track row.label) {
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                }
              </dl>
            } @else {
              <p class="muted">Tidak ada info teknis yang dikirim.</p>
            }
          </details>
        </section>

        <div class="mf-note">
          Masukan dikirim sebagai issue publik di GitHub. Jangan tulis data pribadi (nama lengkap,
          nomor HP, email).
        </div>

        <div class="hp" aria-hidden="true">
          <label
            >Website <input type="text" name="website" tabindex="-1" autocomplete="off" value=""
          /></label>
        </div>

        @if (error(); as e) {
          <div class="mf-note" role="alert">{{ e }}</div>
        }

        <button
          type="submit"
          class="mf-btn mf-btn--primary"
          style="width: 100%"
          [disabled]="sending()"
        >
          {{ sending() ? 'Mengirim…' : 'Kirim masukan' }}
        </button>
      </form>
    }
  `,
})
export class FeedbackSheet {
  private readonly ui = inject(ReaderUiService);
  private readonly data = inject(UserDataApi);

  protected readonly categories = FEEDBACK_CATEGORIES;
  protected readonly max = MESSAGE_MAX;
  protected readonly category = signal<FeedbackCategory>('saran');
  protected readonly message = signal(readDraft());
  protected readonly withContext = signal(true);
  protected readonly sending = signal(false);
  protected readonly touched = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<FeedbackResult | null>(null);

  protected readonly length = computed(() => messageLength(this.message()));
  protected readonly valid = computed(
    () => this.length() >= MESSAGE_MIN && this.length() <= MESSAGE_MAX,
  );
  protected readonly hint = computed(() =>
    this.length() < MESSAGE_MIN
      ? `Minimal ${MESSAGE_MIN} karakter`
      : this.length() > MESSAGE_MAX
        ? `Maksimal ${MESSAGE_MAX} karakter`
        : '',
  );

  protected readonly context = computed<FeedbackContext>(() => {
    const p = this.data.prefs();
    return buildContext({
      appVersion: BUILD_INFO.version,
      build: BUILD_INFO.sha,
      page: this.ui.currentPage(),
      path: location.pathname,
      userAgent: navigator.userAgent.trim(),
      paperTheme: p.paperTheme,
      uiTheme: p.uiTheme,
      layout: p.layoutMode,
      online: navigator.onLine,
      standalone: matchMedia('(display-mode: standalone)').matches,
    });
  });
  protected readonly rows = computed(() => contextRows(this.context()));

  protected onInput(v: string): void {
    this.message.set(v);
    writeDraft(v);
  }

  protected async send(): Promise<void> {
    this.touched.set(true);
    this.error.set(null);
    if (!this.valid() || this.sending()) return;
    this.sending.set(true);
    try {
      const r = await submitFeedback(
        buildRequest(this.category(), this.message(), this.withContext() ? this.context() : null),
      );
      writeDraft('');
      this.message.set('');
      this.touched.set(false);
      this.result.set(r);
    } catch (e) {
      this.error.set(
        e instanceof FeedbackError ? e.message : 'Gagal mengirim masukan. Coba lagi nanti.',
      );
    } finally {
      this.sending.set(false);
    }
  }

  protected again(): void {
    this.result.set(null);
    this.error.set(null);
  }
}

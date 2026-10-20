import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import {
  MUSHAF_STYLES,
  PageRendererId,
  PageRendererService,
} from '../../core/page-renderer.service';
import { MushafPreview } from './mushaf-preview';
import { MushafThumb } from './mushaf-thumb';
import { SHEET_STYLES } from './sheet-styles';
import { TajweedLegend } from './tajweed-legend';

/**
 * Settings section "Tampilan mushaf": one card per style (thumbnail, name, short description,
 * "Pratinjau"). New styles only need an entry in MUSHAF_STYLES and a renderer in PageView.
 */
@Component({
  selector: 'mf-mushaf-style-section',
  imports: [MushafThumb, MushafPreview, TajweedLegend],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    SHEET_STYLES,
    `
      :host {
        display: block;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(136px, 1fr));
        gap: 10px;
      }
      .sc {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        border-radius: var(--mf-radius-lg);
        border: 1px solid var(--ui-line);
      }
      .sc.on {
        border: 2px solid var(--ui-primary);
        padding: 7px;
      }
      .pick {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--ui-ink);
        text-align: left;
        border-radius: var(--mf-radius-sm);
      }
      .pick mf-mushaf-thumb {
        max-width: 96px;
        align-self: center;
      }
      .nm {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.25;
      }
      .tick {
        color: var(--ui-primary);
        font-size: 13px;
      }
      .badge {
        font-size: 11px;
        font-weight: 600;
        padding: 1px 7px;
        border-radius: 999px;
        color: var(--ui-primary);
        border: 1px solid color-mix(in srgb, var(--ui-primary) 45%, transparent);
      }
      .ds {
        font-size: 12.5px;
        line-height: 1.4;
        color: var(--ui-muted);
      }
      .sc .mf-btn {
        width: 100%;
      }
      .legend-box {
        padding: 12px;
        border-radius: var(--mf-radius-lg);
        border: 1px solid var(--ui-line);
      }
    `,
  ],
  template: `
    <section aria-labelledby="st-mushaf" data-search-id="mushaf-style">
      <h3 id="st-mushaf">Tampilan mushaf</h3>
      <div class="cards" role="radiogroup" aria-labelledby="st-mushaf">
        @for (s of styles; track s.id) {
          <div class="sc" [class.on]="renderers.style() === s.id">
            <button
              type="button"
              class="pick"
              role="radio"
              [attr.aria-checked]="renderers.style() === s.id"
              (click)="renderers.set(s.id)"
            >
              <mf-mushaf-thumb [kind]="s.thumb" />
              <span class="nm">
                {{ s.label }}
                @if (s.experimental) {
                  <span class="badge">Eksperimen</span>
                }
                @if (renderers.style() === s.id) {
                  <span class="tick" aria-hidden="true">✓</span>
                }
              </span>
              <span class="ds">{{ s.description }}</span>
            </button>
            <button
              type="button"
              class="mf-btn mf-btn--outline"
              [attr.aria-label]="'Pratinjau tampilan ' + s.label"
              (click)="preview(s.id)"
            >
              Pratinjau
            </button>
          </div>
        }
      </div>
      @if (renderers.style() === 'qcf-tajweed') {
        <button
          type="button"
          class="mf-btn mf-btn--ghost"
          [attr.aria-expanded]="legend()"
          aria-controls="st-legend"
          (click)="legend.set(!legend())"
        >
          Keterangan warna
        </button>
        @if (legend()) {
          <div id="st-legend" class="legend-box"><mf-tajweed-legend /></div>
        }
        <p class="muted">
          Percobaan: font halaman dimuat dari Quran Foundation dan disimpan otomatis saat dibaca
          (butuh internet untuk halaman yang belum pernah dibuka). Bila gagal dimuat, aplikasi
          kembali ke tampilan klasik.
        </p>
      }
      <mf-mushaf-preview />
    </section>
  `,
})
export class MushafStyleSection {
  protected readonly renderers = inject(PageRendererService);
  protected readonly styles = MUSHAF_STYLES;
  protected readonly legend = signal(false);
  private readonly dialog = viewChild.required(MushafPreview);

  protected preview(id: PageRendererId): void {
    this.dialog().open(id);
  }
}

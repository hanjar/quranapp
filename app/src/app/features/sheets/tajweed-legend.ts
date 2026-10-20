import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TAJWEED_LEGEND } from '../reader/qcf-logic';

/** Colour key of the tajweed mushaf style (names + colours of the Quran.com tajweed scheme). */
@Component({
  selector: 'mf-tajweed-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 6px 12px;
      font-size: 13.5px;
      color: var(--ui-ink);
    }
    li {
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.3;
    }
    i {
      flex: none;
      width: 16px;
      height: 16px;
      border-radius: 4px;
      border: 1px solid color-mix(in srgb, var(--ui-ink) 25%, transparent);
    }
    .note {
      margin: 8px 0 0;
      font-size: 12.5px;
      color: var(--ui-muted);
    }
  `,
  template: `
    <ul aria-label="Keterangan warna tajwid">
      @for (r of rules; track r.label) {
        <li>
          <i [style.background]="r.color" aria-hidden="true"></i>
          <span>{{ r.label }}</span>
        </li>
      }
    </ul>
    <p class="note">Warna menyesuaikan mode malam dan kontras tinggi.</p>
  `,
})
export class TajweedLegend {
  protected readonly rules = TAJWEED_LEGEND;
}

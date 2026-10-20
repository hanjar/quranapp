import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MushafStyle } from '../../core/page-renderer.service';

interface Seg {
  x: number;
  w: number;
  c?: string;
}

/** Colour accents of the tajweed thumbnail (decorative, not the real palette). */
const ACCENTS = ['#FF7E1E', '#9400A8', '#169777', '#537FFF', '#DD0008', '#58B800'];
const ROWS = Array.from({ length: 9 }, (_, i) => i);

/** Tiny drawing of a mushaf page in a given style, for the style cards. */
@Component({
  selector: 'mf-mushaf-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 6px;
    }
    .paper {
      fill: var(--mf-paper);
    }
    .frame {
      fill: none;
      stroke: var(--mf-frame-ink);
      stroke-width: 1.4;
    }
    .frame2 {
      fill: none;
      stroke: var(--mf-frame-ink);
      stroke-width: 0.6;
      opacity: 0.7;
    }
    .ink {
      fill: var(--mf-text-ink);
      opacity: 0.82;
    }
    .cart {
      fill: var(--mf-ayah-ornament);
      fill-opacity: 0.16;
      stroke: var(--mf-ayah-ornament);
      stroke-width: 0.8;
    }
  `,
  template: `
    <svg viewBox="0 0 90 120" aria-hidden="true" focusable="false">
      <rect class="paper" width="90" height="120" />
      <rect class="frame" x="6" y="7" width="78" height="106" rx="1.5" />
      <rect class="frame2" x="8.5" y="9.5" width="73" height="101" rx="1" />
      <rect class="cart" x="12" y="13" width="66" height="9" rx="4.5" />
      @for (r of rows; track r) {
        <g>
          @for (s of segs(r); track $index) {
            <rect
              class="ink"
              [attr.x]="s.x"
              [attr.y]="27 + r * 9.3"
              [attr.width]="s.w"
              height="3.4"
              rx="1.6"
              [style.fill]="s.c ?? null"
              [style.opacity]="s.c ? 1 : null"
            />
          }
        </g>
      }
    </svg>
  `,
})
export class MushafThumb {
  readonly kind = input.required<MushafStyle['thumb']>();
  protected readonly rows = ROWS;

  /** Word-like dashes across the line; every few are tinted in the tajweed thumbnail. */
  protected segs(row: number): Seg[] {
    const out: Seg[] = [];
    const widths = [9, 12, 7, 11, 8, 10];
    let x = 12;
    let i = row;
    const end = row === 8 ? 52 : 78;
    while (x < end - 6) {
      const w = Math.min(widths[i % widths.length], end - x);
      const tint = this.kind() === 'tajweed' && (i * 7 + row) % 4 === 0;
      out.push({ x: 90 - x - w, w, c: tint ? ACCENTS[(i + row) % ACCENTS.length] : undefined });
      x += w + 2.6;
      i++;
    }
    return out;
  }
}

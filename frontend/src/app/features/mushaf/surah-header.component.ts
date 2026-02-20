import { Component, input } from '@angular/core';
import { ArabicNumberPipe } from '../../shared/pipes/arabic-number.pipe';

@Component({
  selector: 'app-surah-header',
  imports: [ArabicNumberPipe],
  template: `
    <div class="surah-header">
      <div class="ornament">
        <span class="surah-name arabic-ui">{{ name() }}</span>
      </div>
      <div class="surah-info latin-ui">
        {{ transliteration() }} &middot; {{ totalVerses() | arabicNumber }} ayat
      </div>
      @if (showBismillah()) {
        <div class="bismillah ayah-text">
          بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
        </div>
      }
    </div>
  `,
  styles: `
    .surah-header {
      text-align: center;
      padding: 24px 16px 16px;
    }
    .ornament {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      &::before, &::after {
        content: '';
        flex: 1;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--gold-primary), transparent);
      }
    }
    .surah-name {
      font-size: 28px;
      color: var(--green-dark);
    }
    .surah-info {
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .bismillah {
      font-size: 22px;
      text-align: center;
      color: var(--green-dark);
      padding: 8px 0;
    }
  `,
})
export class SurahHeaderComponent {
  name = input.required<string>();
  transliteration = input.required<string>();
  totalVerses = input.required<number>();
  showBismillah = input(true);
}

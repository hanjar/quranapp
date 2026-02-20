
import { Component, inject, signal, effect, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuranDataService } from '../../core/services/quran-data.service';
import { SurahMeta } from '../../core/models/surah.model';

@Component({
  selector: 'app-goto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="goto-backdrop" (click)="close.emit()">
      <div class="goto-dialog" (click)="$event.stopPropagation()">
        
        <!-- Header -->
        <h2 class="dialog-title">Pergi Ke</h2>
        
        <!-- Tabs -->
        <div class="tabs">
          <button 
            [class.active]="activeTab() === 'ayat'" 
            (click)="activeTab.set('ayat')">Ayat</button>
          <button 
            [class.active]="activeTab() === 'page'" 
            (click)="activeTab.set('page')">Halaman</button>
        </div>

        <div class="dialog-body">
          @if (activeTab() === 'ayat') {
            <!-- Surah Input -->
            <div class="form-group relative">
              <label>Surat</label>
              <input 
                type="text" 
                [(ngModel)]="surahQuery" 
                (input)="onSurahInput()"
                (focus)="showSuggestions.set(true)"
                placeholder="Cari surat..."
                class="input-field"
                autocomplete="off"
              >
              
              <!-- Suggestions Dropdown -->
              @if (showSuggestions() && filteredSurahs().length > 0) {
                <div class="suggestions-list">
                  @for (s of filteredSurahs(); track s.number) {
                    <button class="suggestion-item" (click)="selectSurah(s)">
                      <span class="s-number">{{ s.number }}.</span>
                      <span class="s-name">{{ s.englishName }}</span>
                    </button>
                  }
                </div>
              }
            </div>

            <!-- Ayah Input -->
            <div class="form-group">
              <label>Ayat</label>
              <div class="ayat-control">
                  <input 
                    type="number" 
                    [(ngModel)]="ayahNumber" 
                    name="ayah"
                    class="input-field"
                    min="1"
                    [max]="selectedSurah()?.totalVerses || 286"
                  >
                  <span class="max-verses" *ngIf="selectedSurah()">
                    / {{ selectedSurah()!.totalVerses }}
                  </span>
              </div>
            </div>
          } @else {
            <!-- Page Input -->
            <div class="form-group">
              <label>Halaman (1 - 604)</label>
              <input 
                type="number" 
                [(ngModel)]="pageNumber" 
                class="input-field"
                min="1" max="604"
                (keyup.enter)="submit()"
              >
            </div>
          }
        </div>

        <!-- Footer Actions -->
        <div class="dialog-actions">
          <button class="btn-cancel" (click)="close.emit()">Batal</button>
          <button class="btn-ok" (click)="submit()">OK</button>
        </div>

      </div>
    </div>
  `,
  styles: `
    .goto-backdrop {
      position: fixed;
      inset: 0;
      z-index: 400;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .goto-dialog {
      width: 100%;
      max-width: 320px;
      background: #fdf8f0; /* Cream background like screenshot */
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      overflow: visible; /* For dropdown */
      display: flex;
      flex-direction: column;
    }
    .dialog-title {
      text-align: center;
      font-size: 16px;
      font-weight: 600;
      color: #000;
      margin: 16px 0;
    }
    .tabs {
      display: flex;
      justify-content: center;
      gap: 0;
      margin: 0 24px 16px;
      background: #e0e0e0;
      border-radius: 20px;
      padding: 2px;
    }
    .tabs button {
      flex: 1;
      padding: 6px;
      border-radius: 18px;
      border: none;
      background: transparent;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tabs button.active {
      background: #c01b3f; /* Red/Maroon from screenshot */
      color: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .dialog-body {
      padding: 0 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-height: 140px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .relative { position: relative; }
    label {
      font-size: 14px;
      color: #333;
    }
    .input-field {
      width: 100%;
      padding: 8px 0;
      border: none;
      border-bottom: 1px solid #ccc;
      background: transparent;
      font-size: 16px;
      outline: none;
      border-radius: 0;
      &:focus { border-bottom-color: #c01b3f; }
    }

    .ayat-control {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .max-verses {
        font-size: 14px;
        color: #777;
        white-space: nowrap;
    }

    /* Suggestions */
    .suggestions-list {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10;
      margin-top: 4px;
    }
    .suggestion-item {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 10px 16px;
      border: none;
      background: white;
      text-align: left;
      cursor: pointer;
      gap: 8px;
      border-bottom: 1px solid #f0f0f0;
      &:hover { background: #f9f9f9; }
    }
    .s-number { color: #888; font-size: 12px; width: 24px; }
    .s-name { font-weight: 500; color: #333; }

    .dialog-actions {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 24px;
    }
    .btn-cancel {
      flex: 1;
      padding: 10px;
      border-radius: 20px;
      border: 1px solid #ccc;
      background: white;
      color: #333;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-ok {
      flex: 1;
      padding: 10px;
      border-radius: 20px;
      border: none;
      background: #c01b3f;
      color: white;
      font-weight: 500;
      cursor: pointer;
    }
  `
})
export class GoToDialogComponent {
  quranData = inject(QuranDataService);

  close = output<void>();
  navigatePage = output<number>();
  navigateAyah = output<{ surah: number; ayah: number }>();

  activeTab = signal<'ayat' | 'page'>('ayat');

  // Ayat Mode
  surahQuery = ''; // Bound to input
  selectedSurah = signal<SurahMeta | null>(null);
  ayahNumber = 1;
  showSuggestions = signal(false);

  // Page Mode
  pageNumber: number | null = null;

  filteredSurahs = signal<SurahMeta[]>([]);

  constructor() {
    // Initial filtered list is all surahs (sorted by number)
    effect(() => {
      this.filteredSurahs.set(this.quranData.surahs());
    }, { allowSignalWrites: true });
  }

  onSurahInput() {
    this.showSuggestions.set(true);
    const rawQuery = this.surahQuery.toLowerCase().trim();
    if (!rawQuery) {
      this.filteredSurahs.set(this.quranData.surahs());
      return;
    }

    // Normalize query: remove non-alphanumeric chars (except spaces if needed, but usually removing all punctuation helps)
    // We keep numbers to allow searching by number.
    const cleanQuery = rawQuery.replace(/[^a-z0-9]/g, '');

    const matches = this.quranData.surahs().filter(s => {
      // Normalize target name
      const cleanName = s.englishName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const numberStr = s.number.toString();

      return cleanName.includes(cleanQuery) || numberStr === cleanQuery; // strict match for number? or includes? includes for "11" matching "114" is okay.
    });
    this.filteredSurahs.set(matches);
  }

  selectSurah(s: SurahMeta) {
    this.selectedSurah.set(s);
    this.surahQuery = `${s.number}. ${s.englishName}`;
    this.showSuggestions.set(false);
    this.ayahNumber = 1; // Reset ayah
  }

  submit() {
    if (this.activeTab() === 'page') {
      if (this.pageNumber && this.pageNumber >= 1 && this.pageNumber <= 604) {
        this.navigatePage.emit(this.pageNumber);
        this.close.emit();
      } else {
        alert('Masukkan halaman antara 1 - 604');
      }
    } else {
      const s = this.selectedSurah();
      if (!s) {
        alert('Pilih surat terlebih dahulu');
        return;
      }
      if (this.ayahNumber < 1 || this.ayahNumber > s.totalVerses) {
        alert(`Ayat harus antara 1 - ${s.totalVerses}`);
        return;
      }
      this.navigateAyah.emit({ surah: s.number, ayah: this.ayahNumber });
      this.close.emit();
    }
  }
}

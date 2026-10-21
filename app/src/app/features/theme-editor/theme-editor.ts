import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserDataApi } from '../../core/contracts';
import {
  BASE_THEME_COLORS,
  COLOR_SWATCHES,
  THEME_STARTERS,
  ThemeColorKey,
  ThemeColors,
  contrastChecks,
  customPaperId,
  customThemeVars,
  defaultThemeName,
  newCustomThemeId,
  normalizeHex,
  pickColors,
  sameColors,
  validateThemeDraft,
} from '../../core/custom-theme';
import { CUSTOM_THEME_LIMIT, CUSTOM_THEME_NAME_MAX } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { ThemeService } from '../../core/theme.service';
import { PageView } from '../reader/page-view';
import { isCoverPage } from '../reader/reader-logic';

interface FieldDef {
  key: ThemeColorKey;
  label: string;
  hint: string;
}

const FIELDS: readonly FieldDef[] = [
  { key: 'paper', label: 'Warna kertas', hint: 'Latar halaman mushaf.' },
  { key: 'surround', label: 'Warna latar', hint: 'Warna di sekeliling halaman.' },
  { key: 'frameInk', label: 'Border luar', hint: 'Garis bingkai terluar.' },
  { key: 'frameInkInner', label: 'Border dalam', hint: 'Garis bingkai kedua.' },
  { key: 'ayahOrnament', label: 'Ornamen nomor ayat', hint: 'Lingkaran di sekitar nomor ayat.' },
  { key: 'textInk', label: 'Warna teks', hint: 'Tinta huruf Al-Qur’an (opsional).' },
];

const fmtRatio = (n: number) => n.toFixed(1).replace('.', ',');

@Component({
  selector: 'app-theme-editor',
  imports: [PageView],
  templateUrl: './theme-editor.html',
  styleUrl: './theme-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeEditor {
  private readonly data = inject(UserDataApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(ReaderUiService);
  protected readonly theme = inject(ThemeService);

  protected readonly fields = FIELDS;
  protected readonly swatches = COLOR_SWATCHES;
  protected readonly starters = THEME_STARTERS;
  protected readonly nameMax = CUSTOM_THEME_NAME_MAX;
  protected readonly limit = CUSTOM_THEME_LIMIT;
  protected readonly prefs = this.data.prefs;

  private readonly editing = (() => {
    const id = this.route.snapshot.queryParamMap.get('edit');
    return id ? (this.data.prefs().customThemes.find((t) => t.id === id) ?? null) : null;
  })();

  /** The colours "Kembalikan" returns to: the saved theme being edited, or Krem Madinah. */
  private readonly initial: ThemeColors = this.editing ? pickColors(this.editing) : BASE_THEME_COLORS;

  protected readonly name = signal(
    this.editing?.name ?? defaultThemeName(this.data.prefs().customThemes),
  );
  protected readonly colors = signal<ThemeColors>({ ...this.initial });
  /** Text typed in each hex box (may be mid-edit and invalid). */
  protected readonly hexText = signal<Record<ThemeColorKey, string>>({ ...this.initial });
  protected readonly nameError = signal<string | null>(null);

  protected readonly isEdit = this.editing !== null;
  protected readonly full = computed(
    () => !this.isEdit && this.prefs().customThemes.length >= CUSTOM_THEME_LIMIT,
  );
  protected readonly dirty = computed(() => !sameColors(this.colors(), this.initial));
  protected readonly previewVars = computed(() => customThemeVars(this.colors()));
  protected readonly checks = computed(() =>
    contrastChecks(this.colors()).map((c) => ({
      ...c,
      text: fmtRatio(c.ratio),
      minText: fmtRatio(c.min),
    })),
  );
  protected readonly warnCount = computed(() => this.checks().filter((c) => !c.ok).length);
  /** A real text page with ayah numbers; the cover pages (1-2) show no ornaments. */
  protected readonly previewPage = computed(() => {
    const p = this.data.position()?.page ?? 3;
    return isCoverPage(p) ? 3 : p;
  });
  protected readonly dayOnlyNote = computed(
    () => this.theme.nightActive() || this.prefs().highContrast,
  );

  protected hexInvalid(key: ThemeColorKey): boolean {
    return normalizeHex(this.hexText()[key]) === null;
  }

  protected isCurrent(key: ThemeColorKey, hex: string): boolean {
    return this.colors()[key] === hex;
  }

  protected setColor(key: ThemeColorKey, hex: string): void {
    const n = normalizeHex(hex);
    if (!n) return;
    this.colors.update((c) => ({ ...c, [key]: n }));
    this.hexText.update((t) => ({ ...t, [key]: n }));
  }

  /** Typing in the hex box: apply as soon as it is a complete colour, keep the text as typed. */
  protected typeHex(key: ThemeColorKey, text: string): void {
    this.hexText.update((t) => ({ ...t, [key]: text }));
    const n = normalizeHex(text);
    if (n) this.colors.update((c) => ({ ...c, [key]: n }));
  }

  protected commitHex(key: ThemeColorKey): void {
    const n = normalizeHex(this.hexText()[key]);
    if (n) this.hexText.update((t) => ({ ...t, [key]: n }));
  }

  protected applyStarter(c: ThemeColors): void {
    this.colors.set({ ...c });
    this.hexText.set({ ...c });
  }

  protected reset(): void {
    this.applyStarter(this.initial);
  }

  protected async save(): Promise<void> {
    const colors = this.colors();
    if (this.full()) {
      this.nameError.set(`Maksimal ${CUSTOM_THEME_LIMIT} tema. Hapus salah satu dulu di Pengaturan.`);
      return;
    }
    const err = validateThemeDraft(this.name(), colors);
    if (err) {
      this.nameError.set(err);
      return;
    }
    this.nameError.set(null);
    const name = this.name().trim();
    const id = this.editing?.id ?? newCustomThemeId();
    const theme = { id, name, ...colors };
    const list = this.prefs().customThemes;
    const customThemes = this.editing
      ? list.map((t) => (t.id === id ? theme : t))
      : [...list, theme];
    await this.data.setPrefs({ customThemes, paperTheme: customPaperId(id) });
    this.ui.showToast({ message: `Tema "${name}" disimpan dan dipakai` });
    this.back();
  }

  protected back(): void {
    const page = this.data.position()?.page ?? this.ui.currentPage();
    void this.router.navigate(['/hal', page]);
  }
}

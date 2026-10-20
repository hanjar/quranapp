import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { ReaderUiService } from '../../core/reader-ui.service';
import { SheetHistory } from './sheet-history';

describe('SheetHistory.navigateTo', () => {
  let ui: ReaderUiService;
  let history: SheetHistory;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigate } }] });
    ui = TestBed.inject(ReaderUiService);
    history = TestBed.inject(SheetHistory);
  });

  it('replaces the sheet history entry instead of popping it (no router race)', () => {
    const back = vi.spyOn(window.history, 'back');
    ui.openSheet('browse');
    history.opened();

    history.navigateTo(50);

    expect(back).not.toHaveBeenCalled();
    expect(ui.sheet()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/hal', 50], { replaceUrl: true });
    back.mockRestore();
  });

  it('pushes a normal entry when no sheet entry was pushed', () => {
    history.navigateTo(7, { highlight: { surah: 2, ayah: 255 } });
    expect(navigate).toHaveBeenCalledWith(['/hal', 7], { replaceUrl: false });
    expect(ui.selectedVerse()).toEqual({ surah: 2, ayah: 255, page: 7 });
  });
});

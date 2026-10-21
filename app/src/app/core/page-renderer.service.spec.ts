import { TestBed } from '@angular/core/testing';
import { MUSHAF_STYLES, PageRendererService, isRendererId } from './page-renderer.service';
import { fakeUserData } from './testing-prefs';
import { ReaderUiService } from './reader-ui.service';

describe('PageRendererService', () => {
  let d: ReturnType<typeof fakeUserData>;
  beforeEach(() => {
    TestBed.resetTestingModule();
    d = fakeUserData();
    TestBed.configureTestingModule({ providers: [d.provider] });
  });

  const make = () => TestBed.inject(PageRendererService);

  it('defaults to the classic renderer', () => {
    const s = make();
    expect(s.style()).toBe('classic');
    expect(s.effective()).toBe('classic');
  });

  it('reads the synced preference and writes the choice through setPrefs', () => {
    const s = make();
    s.set('qcf-tajweed');
    expect(d.setPrefs).toHaveBeenCalledWith({ pageRenderer: 'qcf-tajweed' });
    expect(s.style()).toBe('qcf-tajweed');
    s.set('classic');
    expect(d.setPrefs).toHaveBeenLastCalledWith({ pageRenderer: 'classic' });
    expect(s.style()).toBe('classic');
  });

  it('knows the renderer ids', () => {
    expect(isRendererId('bogus')).toBe(false);
    expect(MUSHAF_STYLES.map((m) => m.id)).toEqual(['classic', 'qcf-tajweed']);
  });

  it('falls back to classic once with a single toast, until the style is chosen again', () => {
    const s = make();
    const ui = TestBed.inject(ReaderUiService);
    s.set('qcf-tajweed');
    s.reportFailure();
    expect(s.effective()).toBe('classic');
    expect(s.style()).toBe('qcf-tajweed');
    const first = ui.toast();
    expect(first?.message).toContain('tajwid');
    ui.dismissToast();
    s.reportFailure();
    expect(ui.toast()).toBeNull();
    s.set('qcf-tajweed');
    expect(s.effective()).toBe('qcf-tajweed');
  });
});

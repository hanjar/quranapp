import { TestBed } from '@angular/core/testing';
import { MUSHAF_STYLES, PageRendererService, RENDERER_KEY, isRendererId } from './page-renderer.service';
import { ReaderUiService } from './reader-ui.service';

describe('PageRendererService', () => {
  beforeEach(() => localStorage.removeItem(RENDERER_KEY));
  afterEach(() => localStorage.removeItem(RENDERER_KEY));

  const make = () => TestBed.inject(PageRendererService);

  it('defaults to the classic renderer', () => {
    const s = make();
    expect(s.style()).toBe('classic');
    expect(s.effective()).toBe('classic');
  });

  it('persists the choice per device and restores it', () => {
    make().set('qcf-tajweed');
    expect(localStorage.getItem(RENDERER_KEY)).toBe('qcf-tajweed');
    TestBed.resetTestingModule();
    expect(make().style()).toBe('qcf-tajweed');
    make().set('classic');
    expect(localStorage.getItem(RENDERER_KEY)).toBeNull();
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem(RENDERER_KEY, 'bogus');
    expect(make().style()).toBe('classic');
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

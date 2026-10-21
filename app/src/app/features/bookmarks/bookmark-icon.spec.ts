import { describe, expect, it } from 'vitest';
import { BOOKMARK_ICON_LABEL, bookmarkIconKind, loadBookmarkTab, saveBookmarkTab } from './bookmark-icon';

describe('bookmarkIconKind', () => {
  it('distinguishes the three kinds', () => {
    expect(bookmarkIconKind('page', false)).toBe('page');
    expect(bookmarkIconKind('verse', true)).toBe('end');
    expect(bookmarkIconKind('verse', false)).toBe('verse');
    expect(BOOKMARK_ICON_LABEL.page).toBe('Penanda halaman');
  });
});

describe('bookmark tab persistence', () => {
  it('defaults to all, round-trips, ignores junk and survives throwing storage', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadBookmarkTab(st)).toBe('all');
    saveBookmarkTab('page', st);
    expect(loadBookmarkTab(st)).toBe('page');
    m.set('mf.bookmarkTab', 'zzz');
    expect(loadBookmarkTab(st)).toBe('all');
    const bad = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(loadBookmarkTab(bad)).toBe('all');
    expect(() => saveBookmarkTab('verse', bad)).not.toThrow();
  });
});

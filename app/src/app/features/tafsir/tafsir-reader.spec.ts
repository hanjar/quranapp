import {
  READ_SIZE_MAX,
  READ_SIZE_MIN,
  READ_VIEW_DEFAULT,
  readView,
  tafsirLast,
} from './tafsir-reader';

describe('readView', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    expect(readView(null)).toEqual(READ_VIEW_DEFAULT);
    expect(readView('{not json')).toEqual(READ_VIEW_DEFAULT);
  });

  it('defaults to the serif reading font and 1.2x Arabic', () => {
    expect(READ_VIEW_DEFAULT.font).toBe('serif');
    expect(READ_VIEW_DEFAULT.arabic).toBe(1.2);
  });

  it('keeps valid choices and clamps the size', () => {
    expect(
      readView(
        JSON.stringify({ font: 'plex', spacing: 'loose', size: 21, arabic: 1.5, notes: true }),
      ),
    ).toEqual({
      font: 'plex',
      spacing: 'loose',
      size: 21,
      arabic: 1.5,
      notes: true,
    });
    expect(readView(JSON.stringify({ size: 99 })).size).toBe(READ_SIZE_MAX);
    expect(readView(JSON.stringify({ size: 2 })).size).toBe(READ_SIZE_MIN);
  });

  it('rejects unknown values', () => {
    const v = readView(JSON.stringify({ font: 'comic', spacing: 'huge', notes: 'yes' }));
    expect(v.font).toBe(READ_VIEW_DEFAULT.font);
    expect(v.spacing).toBe(READ_VIEW_DEFAULT.spacing);
    expect(v.notes).toBe(false);
  });

  it('accepts every reading font', () => {
    for (const font of ['serif', 'newsreader', 'poppins', 'jakarta', 'plex', 'system']) {
      expect(readView(JSON.stringify({ font })).font).toBe(font);
    }
  });

  it('keeps a font saved before the new fonts existed', () => {
    const v = readView(
      JSON.stringify({ font: 'poppins', size: 18, spacing: 'normal', notes: false }),
    );
    expect(v.font).toBe('poppins');
    expect(v.arabic).toBe(READ_VIEW_DEFAULT.arabic);
  });

  it('snaps the Arabic multiplier to the allowed set', () => {
    expect(readView(JSON.stringify({ arabic: 1 })).arabic).toBe(1);
    expect(readView(JSON.stringify({ arabic: 1.3 })).arabic).toBe(1.2);
    expect(readView(JSON.stringify({ arabic: 9 })).arabic).toBe(1.5);
    expect(readView(JSON.stringify({ arabic: 0 })).arabic).toBe(1);
    expect(readView(JSON.stringify({ arabic: 'big' })).arabic).toBe(READ_VIEW_DEFAULT.arabic);
    expect(readView(JSON.stringify({ arabic: null })).arabic).toBe(READ_VIEW_DEFAULT.arabic);
  });
});

describe('tafsirLast', () => {
  it('reads a saved position', () => {
    expect(tafsirLast(JSON.stringify({ s: 2, a: 255, src: 'ik' }))).toEqual({
      s: 2,
      a: 255,
      src: 'ik',
    });
  });

  it('treats an unknown source as Kemenag', () => {
    expect(tafsirLast(JSON.stringify({ s: 2, a: 5, src: 'x' }))?.src).toBe('kemenag');
  });

  it('rejects missing, broken or out-of-range values', () => {
    expect(tafsirLast(null)).toBeNull();
    expect(tafsirLast('{nope')).toBeNull();
    expect(tafsirLast('"text"')).toBeNull();
    expect(tafsirLast(JSON.stringify({ s: 0, a: 1 }))).toBeNull();
    expect(tafsirLast(JSON.stringify({ s: 115, a: 1 }))).toBeNull();
    expect(tafsirLast(JSON.stringify({ s: 2, a: 0 }))).toBeNull();
    expect(tafsirLast(JSON.stringify({ s: 2, a: 1.5 }))).toBeNull();
    expect(tafsirLast(JSON.stringify({ s: 2 }))).toBeNull();
  });
});

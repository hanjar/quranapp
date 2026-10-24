import { READ_SIZE_MAX, READ_SIZE_MIN, READ_VIEW_DEFAULT, readView } from './tafsir-reader';

describe('readView', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    expect(readView(null)).toEqual(READ_VIEW_DEFAULT);
    expect(readView('{not json')).toEqual(READ_VIEW_DEFAULT);
  });

  it('keeps valid choices and clamps the size', () => {
    expect(readView(JSON.stringify({ font: 'serif', spacing: 'loose', size: 21, notes: true }))).toEqual({
      font: 'serif',
      spacing: 'loose',
      size: 21,
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
});

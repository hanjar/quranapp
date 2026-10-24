import { emphasis, parseInline, parseRef, parseTafsir, sectionIndexFor } from './tafsir-format';

describe('tafsir-format', () => {
  it('parses refs', () => {
    expect(parseRef('2:255')).toEqual({ s: 2, from: 255, to: 255 });
    expect(parseRef(' 78:6-10 ')).toEqual({ s: 78, from: 6, to: 10 });
    expect(parseRef('?')).toBeNull();
    expect(parseRef('2:1-5 x')).toBeNull();
  });

  it('splits bold and italic, leaves stray asterisks', () => {
    expect(emphasis('a *isti\'adzah* b **c** d * e')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'text', v: "isti'adzah", em: true },
      { t: 'text', v: ' b ' },
      { t: 'text', v: 'c', strong: true },
      { t: 'text', v: ' d * e' },
    ]);
  });

  it('parses ayah markers, fragments, unknown refs and RAGU notes', () => {
    const parts = parseInline(
      'Firman-Nya: {{QS:78:1}}, lalu {{QS:78:2|النبأ العظيم}} dan {{QS:?|الر}} [[RAGU: sumber «[ x ]» janggal]] selesai [[RAGU]].',
    );
    expect(parts).toEqual([
      { t: 'text', v: 'Firman-Nya: ' },
      { t: 'qs', s: 78, from: 1, to: 1 },
      { t: 'text', v: ', lalu ' },
      { t: 'frag', s: 78, from: 2, to: 2, arabic: 'النبأ العظيم' },
      { t: 'text', v: ' dan ' },
      { t: 'unknown', arabic: 'الر' },
      { t: 'text', v: ' ' },
      { t: 'ragu', note: 'sumber «[ x ]» janggal' },
      { t: 'text', v: ' selesai ' },
      { t: 'ragu', note: '' },
      { t: 'text', v: '.' },
    ]);
  });

  it('builds blocks, dropping a section repeated at a chunk boundary', () => {
    const blocks = parseTafsir({
      chunks: [
        { id: '78-01', verses: '78:1-5', text: '=== 78:1 ===\n\nSatu.\n\n=== 78:2-3 ===\n\nDua\nbaris.' },
        { id: '78-02', verses: '78:3-5', text: '=== 78:2-3 ===\n\nLanjutan.\n\n=== 78:4-5 ===\n\nEmpat.' },
      ],
    });
    expect(blocks.map((b) => (b.kind === 'section' ? `#${b.label}` : (b.parts[0] as { v: string }).v))).toEqual([
      '#78:1',
      'Satu.',
      '#78:2-3',
      'Dua baris.',
      'Lanjutan.',
      '#78:4-5',
      'Empat.',
    ]);
    expect(sectionIndexFor(blocks, 3)).toBe(2);
    expect(sectionIndexFor(blocks, 5)).toBe(5);
    expect(sectionIndexFor(blocks, 40)).toBe(5);
  });
});

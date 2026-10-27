import {
  Block,
  compareRows,
  emphasis,
  kemenagBlocks,
  parseInline,
  parseRef,
  parseTafsir,
  sectionIndexFor,
} from './tafsir-format';

describe('tafsir-format', () => {
  it('parses refs', () => {
    expect(parseRef('2:255')).toEqual({ s: 2, from: 255, to: 255 });
    expect(parseRef(' 78:6-10 ')).toEqual({ s: 78, from: 6, to: 10 });
    expect(parseRef('?')).toBeNull();
    expect(parseRef('2:1-5 x')).toBeNull();
  });

  it('splits bold and italic, leaves stray asterisks', () => {
    expect(emphasis("a *isti'adzah* b **c** d * e")).toEqual([
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
        {
          id: '78-01',
          verses: '78:1-5',
          text: '=== 78:1 ===\n\nSatu.\n\n=== 78:2-3 ===\n\nDua\nbaris.',
        },
        {
          id: '78-02',
          verses: '78:3-5',
          text: '=== 78:2-3 ===\n\nLanjutan.\n\n=== 78:4-5 ===\n\nEmpat.',
        },
      ],
    });
    expect(
      blocks.map((b) => (b.kind === 'section' ? `#${b.label}` : (b.parts[0] as { v: string }).v)),
    ).toEqual(['#78:1', 'Satu.', '#78:2-3', 'Dua baris.', 'Lanjutan.', '#78:4-5', 'Empat.']);
    expect(sectionIndexFor(blocks, 3)).toBe(2);
    expect(sectionIndexFor(blocks, 5)).toBe(5);
    expect(sectionIndexFor(blocks, 40)).toBe(5);
  });
});

describe('kemenagBlocks', () => {
  it('one section per ayah in order, paragraphs split on new lines, text kept literal', () => {
    const b = kemenagBlocks(112, { '2': 'Dua *a*.', '1': 'Satu.\n\nLanjut.' });
    expect(
      b.map((x) => (x.kind === 'section' ? `#${x.from}` : (x.parts[0] as { v: string }).v)),
    ).toEqual(['#1', 'Satu.', 'Lanjut.', '#2', 'Dua *a*.']);
  });
});

describe('compareRows', () => {
  const sec = (s: number, from: number, to = from): Block => ({
    kind: 'section',
    label: `${s}:${from}`,
    s,
    from,
    to,
  });
  const p = (v: string): Block => ({ kind: 'p', parts: [{ t: 'text', v }] });
  const txt = (bs: Block[]) =>
    bs.map((b) =>
      b.kind === 'section' ? `#${b.s}:${b.from}-${b.to}` : (b.parts[0] as { v: string }).v,
    );

  it('lines a ranged right side up with the per-ayah left sections it covers', () => {
    const left = [sec(2, 1), p('k1'), sec(2, 2), p('k2'), sec(2, 3), p('k3'), sec(2, 4), p('k4')];
    const right = [sec(2, 1, 3), p('i1'), sec(2, 4), p('i4')];
    const rows = compareRows(2, left, right);
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      [1, 3],
      [4, 4],
    ]);
    expect(txt(rows[0]!.left)).toEqual(['#2:1-1', 'k1', '#2:2-2', 'k2', '#2:3-3', 'k3']);
    expect(txt(rows[0]!.right)).toEqual(['#2:1-3', 'i1']);
    expect(txt(rows[1]!.left)).toEqual(['#2:4-4', 'k4']);
    expect(txt(rows[1]!.right)).toEqual(['#2:4-4', 'i4']);
  });

  it('chains overlapping ranges of both sides into one row', () => {
    const left = [sec(1, 1, 2), p('a'), sec(1, 3, 4), p('b'), sec(1, 5), p('c')];
    const right = [sec(1, 2, 3), p('x'), sec(1, 4, 4), p('y')];
    const rows = compareRows(1, left, right);
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      [1, 4],
      [5, 5],
    ]);
    expect(txt(rows[0]!.left)).toEqual(['#1:1-2', 'a', '#1:3-4', 'b']);
    expect(txt(rows[0]!.right)).toEqual(['#1:2-3', 'x', '#1:4-4', 'y']);
    expect(rows[1]!.right).toEqual([]);
    expect(txt(rows[1]!.left)).toEqual(['#1:5-5', 'c']);
  });

  it('puts leading intro blocks in the first row', () => {
    const rows = compareRows(3, [sec(3, 1), p('k')], [p('intro'), sec(3, 1, 2), p('i')]);
    expect(rows).toHaveLength(1);
    expect(txt(rows[0]!.right)).toEqual(['intro', '#3:1-2', 'i']);
  });

  it('keeps sections quoting other surahs inside the group they follow', () => {
    const right = [sec(5, 1, 2), p('a'), sec(2, 9), p('quoted'), sec(5, 3), p('b')];
    const rows = compareRows(5, [sec(5, 1, 3), p('k')], right);
    expect(rows).toHaveLength(1);
    expect(txt(rows[0]!.right)).toEqual(['#5:1-2', 'a', '#2:9-9', 'quoted', '#5:3-3', 'b']);
  });

  it('gives an empty side []', () => {
    const rows = compareRows(7, [sec(7, 1), p('k'), sec(7, 2), p('l')], []);
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(rows.every((r) => r.right.length === 0)).toBe(true);
    expect(compareRows(7, [], [])).toEqual([]);
  });
});

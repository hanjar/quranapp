import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQcfPage, groupByPage, validateQcf, apiUrl } from '../lib/qcf.mjs';

const w = (code, line, kind = 'word', page = 2) => ({ code_v2: code, line_number: line, char_type_name: kind, page_number: page });
const payload = (verses) => ({ verses });

test('api url asks for QCF V4 layout words', () => {
  const u = apiUrl(7);
  assert.match(u, /by_page\/7\?/);
  assert.match(u, /mushaf=19/);
  assert.match(u, /code_v2,line_number/);
});

test('page 2 style: surah name + basmalah lines inferred before ayah 1', () => {
  const p = buildQcfPage(
    payload([
      { verse_key: '2:1', words: [w('a', 3), w('b', 3, 'end')] },
      { verse_key: '2:2', words: [w('c', 3), w('d', 4, 'end')] },
    ]),
    2,
  );
  assert.deepEqual(p.lines.map((l) => [l.n, l.type]), [[1, 'surah'], [2, 'bism'], [3, 'text'], [4, 'text']]);
  assert.equal(p.lines[0].surah, 2);
  assert.deepEqual(p.lines[2].words[1], { code: 'b', verse: '2:1', type: 'end' });
  assert.equal(p.lines[2].words[0].type, undefined);
});

test('surah 1 and 9 have only a name line (no separate basmalah)', () => {
  const p1 = buildQcfPage(payload([{ verse_key: '1:1', words: [w('a', 2, 'word', 1)] }]), 1);
  assert.deepEqual(p1.lines.map((l) => l.type), ['surah', 'text']);
  const p9 = buildQcfPage(payload([{ verse_key: '9:1', words: [w('a', 5, 'word', 187)] }]), 187);
  assert.deepEqual(p9.lines.map((l) => [l.n, l.type]), [[4, 'surah'], [5, 'text']]);
});

test('continuation of a surah gets no header; mid-page surah start does', () => {
  const p = buildQcfPage(
    payload([
      { verse_key: '2:286', words: [w('a', 1, 'word', 50)] },
      { verse_key: '3:1', words: [w('b', 9, 'word', 50)] },
    ]),
    50,
  );
  // 3:1 on line 9 -> header lines 7, 8; no header at line 1
  assert.deepEqual(p.lines.map((l) => l.type), ['text', 'surah', 'bism', 'text']);
});

test('single free line: basmalah shares the surah frame (page 77)', () => {
  const p = buildQcfPage(payload([{ verse_key: '4:1', words: [w('a', 2, 'word', 77)] }]), 77);
  assert.deepEqual(p.lines[0], { n: 1, type: 'surah', surah: 4, bism: true });
  assert.equal(p.lines.length, 2);
});

test('rejects bad lines, wrong page and missing room for a header', () => {
  assert.throws(() => buildQcfPage(payload([{ verse_key: '2:3', words: [w('a', 16)] }]), 2));
  // words that belong to another page (verse spans pages) are skipped, not an error
  const spill = buildQcfPage(payload([{ verse_key: '2:3', words: [w('a', 3, 'word', 9), w('b', 3)] }]), 2);
  assert.deepEqual(spill.lines[0].words.map((x) => x.code), ['b']);
  assert.throws(() => buildQcfPage(payload([{ verse_key: '2:1', words: [w('a', 1)] }]), 2));
  assert.throws(() => buildQcfPage(payload([{ verse_key: '2:2', words: [w('a', 3)] }, { verse_key: '3:1', words: [w('a', 4, 'word', 2)] }]), 2));
  assert.throws(() => buildQcfPage(payload([{ verse_key: '2:3', words: [{ ...w('a', 3), code_v2: '' }] }]), 2));
});

test('validate: page count, missing ayah, line limit', () => {
  const surahs = [{ number: 1, ayahCount: 1 }];
  const errs = validateQcf([{ page: 1, lines: [] }], surahs);
  assert.ok(errs.some((e) => e.includes('604')));
  assert.ok(errs.some((e) => e.includes('missing ayah 1:1')));
  const many = { page: 1, lines: Array.from({ length: 16 }, (_, i) => ({ n: i + 1, type: 'surah', surah: 1 })) };
  assert.ok(validateQcf([many], surahs).some((e) => e.includes('16 lines')));
});

test('groupByPage regroups words by their own page and dedupes', () => {
  const a = { verses: [{ verse_key: '88:22', words: [{ id: 1, position: 1, page_number: 592 }] }, { verse_key: '88:23', words: [{ id: 2, position: 1, page_number: 593 }] }] };
  const b = { verses: [{ verse_key: '88:23', words: [{ id: 2, position: 1, page_number: 593 }, { id: 3, position: 2, page_number: 593 }] }] };
  const g = groupByPage([a, b]);
  assert.deepEqual([...g.keys()].sort(), [592, 593]);
  assert.equal(g.get(593).verses[0].words.length, 2);
  assert.equal(g.get(592).verses.length, 1);
});

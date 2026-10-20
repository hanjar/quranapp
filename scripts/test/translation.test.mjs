import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTranslation, hasFootnoteMarker, findFootnoteMarkers, buildTranslationMap } from '../lib/translation.mjs';

test('normaliseTranslation keeps tag text, collapses space, NFC', () => {
  assert.equal(normaliseTranslation('Dengan  <i>nama</i> Allah<sup>1</sup>\n Yang <br/>Maha'), 'Dengan nama Allah1 Yang Maha');
  assert.equal(normaliseTranslation('é'), 'é');
});

test('normaliseTranslation rejects bad input', () => {
  assert.throws(() => normaliseTranslation('<script>x</script>'), /script/);
  assert.throws(() => normaliseTranslation(' <i></i> '), /empty/);
  assert.throws(() => normaliseTranslation('a'.repeat(6001)), /6000/);
  assert.throws(() => normaliseTranslation(undefined));
});

test('footnote marker detection', () => {
  assert.equal(hasFootnoteMarker('kepada Allah1 dan'), true);
  assert.equal(hasFootnoteMarker('Allah¹'), true);
  assert.equal(hasFootnoteMarker('lihat QS 2:3 dan ayat 5.'), false);
  assert.equal(hasFootnoteMarker('tanpa angka'), false);
  assert.deepEqual(findFootnoteMarkers({ '1:1': 'ok', '1:2': 'x2' }), ['1:2']);
});

test('buildTranslationMap validates counts', () => {
  const counts = Array(114).fill(1);
  counts[0] = 6236 - 113;
  const surahs = counts.map((c) => ({ ayahCount: c }));
  const payloads = counts.map((c, i) => ({
    data: { ayat: Array.from({ length: c }, (_, k) => ({ nomorAyat: k + 1, teksIndonesia: `t${i + 1}.${k + 1}` })) },
  }));
  const m = buildTranslationMap(payloads, surahs);
  assert.equal(Object.keys(m).length, 6236);
  assert.equal(m['3:1'], 't3.1');
  payloads[4].data.ayat.pop();
  assert.throws(() => buildTranslationMap(payloads, surahs), /expected/);
});

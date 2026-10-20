import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseLatin, buildLatinMap } from '../lib/latin.mjs';

test('normaliseLatin strips tags, collapses whitespace, keeps diacritics', () => {
  assert.equal(normaliseLatin('  <i>Bismillāhi</i>\n  ar-raḥmāni  '), 'Bismillāhi ar-raḥmāni');
  assert.equal(normaliseLatin('ā'), 'ā'); // NFC
  assert.equal(normaliseLatin("Ya'tūn 'Abasa"), "Ya'tūn 'Abasa");
});

test('normaliseLatin rejects bad input', () => {
  assert.throws(() => normaliseLatin('x<script>1</script>'), /script/);
  assert.throws(() => normaliseLatin('  <b></b> '), /empty/);
  assert.throws(() => normaliseLatin('a'.repeat(2001)), /2000/);
  assert.throws(() => normaliseLatin(5));
});

function fake(counts) {
  return {
    surahs: counts.map((c) => ({ ayahCount: c })),
    payloads: counts.map((c, i) => ({ data: { ayat: Array.from({ length: c }, (_, k) => ({ nomorAyat: k + 1, teksLatin: `s${i + 1}a${k + 1}` })) } })),
  };
}

test('buildLatinMap validates counts', () => {
  const counts = Array(114).fill(1);
  counts[0] = 6236 - 113; // total 6236
  const f = fake(counts);
  const m = buildLatinMap(f.payloads, f.surahs);
  assert.equal(Object.keys(m).length, 6236);
  assert.equal(m['2:1'], 's2a1');
  const bad = fake(counts);
  bad.payloads[5].data.ayat.pop();
  assert.throws(() => buildLatinMap(bad.payloads, bad.surahs), /expected/);
  const small = fake(Array(114).fill(1));
  assert.throws(() => buildLatinMap(small.payloads, small.surahs), /6236/);
  assert.throws(() => buildLatinMap(f.payloads.slice(1), f.surahs), /114/);
});

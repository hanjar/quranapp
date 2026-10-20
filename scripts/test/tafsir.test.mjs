import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTafsir, buildTafsirMaps } from '../lib/tafsir.mjs';

test('normaliseTafsir keeps paragraphs, strips html', () => {
  assert.equal(normaliseTafsir('Satu <i>dua</i>\n\nTiga<br>empat &amp; lima\r\n\r\n\r\nEnam'), 'Satu dua\n\nTiga\nempat & lima\n\nEnam'.replace('Tiga\nempat', 'Tiga empat'));
  assert.equal(normaliseTafsir('<p>A</p><p>B</p>'), 'A\n\nB');
});

test('normaliseTafsir rejects bad input', () => {
  assert.throws(() => normaliseTafsir('<script>x</script>'), /script/);
  assert.throws(() => normaliseTafsir(' <i></i> '), /empty/);
  assert.throws(() => normaliseTafsir(null));
});

test('buildTafsirMaps validates counts', () => {
  const surahs = Array.from({ length: 114 }, (_, i) => ({ ayahCount: i === 0 ? 3 : 1 }));
  const payloads = surahs.map((s, i) => ({
    data: { tafsir: Array.from({ length: s.ayahCount }, (_, k) => ({ ayat: k + 1, teks: `t${i + 1}.${k + 1}` })) },
  }));
  const maps = buildTafsirMaps(payloads, surahs);
  assert.equal(maps.length, 114);
  assert.equal(maps[0]['3'], 't1.3');
  payloads[0].data.tafsir.pop();
  assert.throws(() => buildTafsirMaps(payloads, surahs), /expected/);
});

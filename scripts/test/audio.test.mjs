import test from 'node:test';
import assert from 'node:assert/strict';
import { allAyahs, globalNumber, ayahBase, fileName, pickSample, durationOk, buildManifest, perJuzAverage, AYAH_TOTAL } from '../lib/audio.mjs';

const counts = Array(114).fill(1);
counts[0] = 7;
counts[1] = 286;
counts[2] = 6236 - 7 - 286 - 111; // pad so total == 6236
const surahs = counts.map((c, i) => ({ number: i + 1, ayahCount: c }));

test('global numbering', () => {
  const all = allAyahs(surahs);
  assert.equal(all.length, AYAH_TOTAL);
  assert.equal(all[0].n, 1);
  assert.equal(all.at(-1).n, AYAH_TOTAL);
  assert.equal(globalNumber(surahs, 1, 7), 7);
  assert.equal(globalNumber(surahs, 2, 1), 8);
  assert.equal(globalNumber(surahs, 114, 1), AYAH_TOTAL);
  assert.throws(() => globalNumber(surahs, 1, 8));
  const r = all[globalNumber(surahs, 3, 5) - 1];
  assert.deepEqual([r.surah, r.ayah], [3, 5]);
});

test('file naming', () => {
  assert.equal(ayahBase(55, 13), '055013');
  assert.equal(fileName(2, 255, 'webm'), '002255.webm');
});

test('sample is deterministic and includes surahs 1 and 114', () => {
  const all = allAyahs(surahs);
  const a = pickSample(all, 300);
  const b = pickSample(all, 300);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 300 + 7);
  assert.ok(a.some((r) => r.surah === 1 && r.ayah === 7) && a.some((r) => r.surah === 114));
});

test('duration tolerance', () => {
  assert.equal(durationOk(10, 10.2), true); // within 3%
  assert.equal(durationOk(10, 10.4), false);
  assert.equal(durationOk(2, 2.14), true); // within 0.15 s
  assert.equal(durationOk(2, 2.2), false);
  assert.equal(durationOk(0, 1), false);
  assert.equal(durationOk(5, NaN), false);
});

test('manifest shape and validation', () => {
  const bytes = Array(AYAH_TOTAL).fill(10);
  const m = buildManifest({ bytesByVariant: { opus24: bytes, opus32: bytes, mp364: bytes }, builtAt: 'x' });
  assert.equal(m.format, 'mushaf-audio');
  assert.equal(m.ayahCount, 6236);
  assert.equal(m.variants.opus24.totalBytes, 62360);
  assert.equal(m.variants.mp364.ext, 'mp3');
  assert.equal(m.variants.opus32.label, 'Standar');
  const bad = bytes.slice();
  bad[5] = 0;
  assert.throws(() => buildManifest({ bytesByVariant: { opus24: bad, opus32: bytes, mp364: bytes }, builtAt: 'x' }));
  assert.throws(() => buildManifest({ bytesByVariant: { opus24: bytes.slice(1), opus32: bytes, mp364: bytes }, builtAt: 'x' }));
});

test('perJuzAverage sums per juz', () => {
  const bytes = Array(AYAH_TOTAL).fill(1);
  const juz = [{ start: { surah: 1, ayah: 1 } }, { start: { surah: 2, ayah: 1 } }];
  const r = perJuzAverage(juz, surahs, bytes);
  assert.deepEqual(r, [7, AYAH_TOTAL - 7]);
});

import { looksLikeMp3, acceptableAudio } from '../lib/audio.mjs';
test('mp3 sniffing and content-type acceptance', () => {
  const id3 = Buffer.from('ID3\x04rest');
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const html = Buffer.from('<html>');
  assert.equal(looksLikeMp3(id3), true);
  assert.equal(looksLikeMp3(frame), true);
  assert.equal(looksLikeMp3(html), false);
  assert.equal(acceptableAudio('audio/mpeg', frame), true);
  assert.equal(acceptableAudio('application/octet-stream', id3), true);
  assert.equal(acceptableAudio('application/octet-stream', html), false);
  assert.equal(acceptableAudio('text/html', id3), false);
});

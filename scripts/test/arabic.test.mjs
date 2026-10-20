import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArabicMap, normaliseArabic } from '../lib/arabic.mjs';

test('normaliseArabic trims, collapses whitespace, keeps harakat', () => {
  assert.equal(normaliseArabic('  بِسْمِ \n ٱللَّهِ  '), 'بِسْمِ ٱللَّهِ');
});

test('normaliseArabic rejects markup, empty and non-Arabic', () => {
  assert.throws(() => normaliseArabic('<b>بسم</b>'));
  assert.throws(() => normaliseArabic('   '));
  assert.throws(() => normaliseArabic('bismillah'));
  assert.throws(() => normaliseArabic(null));
});

test('buildArabicMap validates counts and total', () => {
  const surahs = Array.from({ length: 114 }, () => ({ ayahCount: 1 }));
  const payloads = surahs.map(() => ({ data: { ayat: [{ nomorAyat: 1, teksArab: 'بسم' }] } }));
  assert.throws(() => buildArabicMap(payloads, surahs), /expected 6236/);
  assert.throws(() => buildArabicMap(payloads.slice(1), surahs), /114/);
  const bad = payloads.map((p) => ({ data: { ayat: [...p.data.ayat, ...p.data.ayat] } }));
  assert.throws(() => buildArabicMap(bad, surahs), /expected 1/);
});

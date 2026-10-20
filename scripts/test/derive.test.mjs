import test from 'node:test';
import assert from 'node:assert/strict';
import { JUZ_STARTS, NAMES_LATIN, cmpRef, juzOf, pageAyahs, derivePages, deriveJuz, deriveSurahs, checkIntegrity } from '../lib/derive.mjs';
import { validateSvg } from '../lib/svg-validate.mjs';

const e = (s, a) => ({ surahNumber: s, ayahNumber: a });

test('constants', () => {
  assert.equal(JUZ_STARTS.length, 30);
  assert.equal(NAMES_LATIN.length, 114);
  assert.equal(NAMES_LATIN[1], 'Al-Baqarah');
});

test('juzOf boundaries', () => {
  assert.equal(juzOf({ surah: 1, ayah: 7 }), 1);
  assert.equal(juzOf({ surah: 2, ayah: 141 }), 1);
  assert.equal(juzOf({ surah: 2, ayah: 142 }), 2);
  assert.equal(juzOf({ surah: 114, ayah: 6 }), 30);
  assert.equal(cmpRef({ surah: 2, ayah: 1 }, { surah: 1, ayah: 9 }) > 0, true);
});

test('pageAyahs sorts, dedupes, rejects bad input', () => {
  assert.deepEqual(pageAyahs([e(2, 3), e(2, 1), e(2, 3)]), [{ surah: 2, ayah: 1 }, { surah: 2, ayah: 3 }]);
  assert.throws(() => pageAyahs([]));
  assert.throws(() => pageAyahs([{ surahNumber: '2', ayahNumber: 1 }]));
});

const fixture = [
  [e(1, 1), e(1, 2)],
  [e(1, 3), e(2, 1), e(2, 141)],
  [e(2, 141), e(2, 142), e(2, 143)], // 2:141 spans two pages
];

test('derivePages handles shared verse and juz starts', () => {
  const p = derivePages(fixture);
  assert.equal(p.length, 3);
  assert.deepEqual(p[1].surahs, [1, 2]);
  assert.deepEqual(p[1].first, { surah: 1, ayah: 3 });
  assert.equal(p[1].juz, 1);
  assert.deepEqual(p[2].juzStarts, [2]);
  assert.equal(p[2].juz, 1); // first (2:141) still in juz 1
  assert.deepEqual(p[0].juzStarts, [1]);
});

test('deriveJuz finds first page and throws when absent', () => {
  assert.throws(() => deriveJuz(fixture));
  const starts = [[1, 1], [2, 142]];
  const j = deriveJuz(fixture, 1, starts);
  assert.deepEqual(j, [
    { number: 1, start: { surah: 1, ayah: 1 }, page: 1 },
    { number: 2, start: { surah: 2, ayah: 142 }, page: 3 },
  ]);
});

test('deriveSurahs', () => {
  const up = [
    { number: 2, nameArabic: 'ب', nameEnglish: 'Al-Baqara', ayahCount: 286, pageNumber: 2 },
    { number: 1, nameArabic: 'ا', nameEnglish: 'Al-Fatiha', ayahCount: 7, pageNumber: 1 },
  ];
  const s = deriveSurahs(up, derivePages(fixture));
  assert.equal(s[0].number, 1);
  assert.equal(s[0].nameLatin, 'Al-Fatihah');
  assert.equal(s[0].endPage, 2);
  assert.equal(s[1].endPage, 3);
  assert.equal(s[1].juz, 1);
});

test('checkIntegrity', () => {
  const pages = derivePages(fixture);
  const lists = fixture.map((x) => pageAyahs(x));
  assert.deepEqual(checkIntegrity({ surahs: [], pages, juz: [], pageAyahLists: lists, partial: true }), []);
  const bad = [pages[1], pages[0]];
  assert.ok(checkIntegrity({ surahs: [], pages: bad, juz: [], pageAyahLists: lists, partial: true }).length > 0);
  assert.ok(checkIntegrity({ surahs: [], pages, juz: [], pageAyahLists: lists, partial: false }).length > 0);
});

const okSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path class="ayahPolygon" fill-opacity="0" surah="2" ayah="6" d="M0 0Z"/></svg>';

test('validateSvg accepts clean svg', () => {
  assert.equal(validateSvg(okSvg).polygons, 1);
  assert.equal(validateSvg(okSvg.replace('<path', '<use href="#a"/><path')).polygons, 1);
});

test('validateSvg rejects unsafe content', () => {
  const bad = [
    okSvg.replace('</svg>', '<script>1</script></svg>'),
    okSvg.replace('</svg>', '<foreignObject/></svg>'),
    okSvg.replace('</svg>', '<image href="#a"/></svg>'),
    okSvg.replace('<path', '<path onload="x()"'),
    okSvg.replace('<path', '<use xlink:href="http://x/y.svg#a"/><path'),
    okSvg.replace('<path', '<rect fill="url(http://x/a)"/><path'),
    okSvg.replace('<path', '<style>@import "x.css";</style><path'),
    okSvg.replace('surah="2"', 'surah="x"'),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'not svg',
  ];
  for (const b of bad) assert.throws(() => validateSvg(b), /SVG security validation failed/, b.slice(0, 80));
});

#!/usr/bin/env node
// Builds app/public/content/hafs-kfqc/ from a pinned commit of quranpedia/quran-svg.
// Usage: node scripts/build-content.mjs [--commit <sha>] [--pages 1-10] [--concurrency 8]
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUZ_STARTS, deriveJuz, derivePages, deriveSurahs, pageAyahs, checkIntegrity } from './lib/derive.mjs';
import { LATIN_SOURCE, buildLatinMap } from './lib/latin.mjs';
import { ARABIC_SOURCE, buildArabicMap } from './lib/arabic.mjs';
import { TAFSIR_SOURCE, buildTafsirMaps } from './lib/tafsir.mjs';
import { TRANSLATION_SOURCE, buildTranslationMap, findFootnoteMarkers } from './lib/translation.mjs';
import { validateSvg } from './lib/svg-validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'quranpedia/quran-svg';
const UPSTREAM_PATH = 'mushafs/hafs/kfqc';
const OUT = path.join(ROOT, 'app', 'public', 'content', 'hafs-kfqc');
const pad = (n) => String(n).padStart(3, '0');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const o = { commit: null, pages: [1, 604], concurrency: 8, skipLatin: false, skipTranslation: false, skipTafsir: false, latinRefresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') o.commit = argv[++i];
    else if (a === '--pages') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(argv[++i] ?? '');
      if (!m) throw new Error('--pages expects N or N-M');
      o.pages = [Number(m[1]), Number(m[2] ?? m[1])];
    } else if (a === '--skip-latin') o.skipLatin = true;
    else if (a === '--skip-translation') o.skipTranslation = true;
    else if (a === '--skip-tafsir') o.skipTafsir = true;
    else if (a === '--latin-refresh') o.latinRefresh = true;
    else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  const [a, b] = o.pages;
  if (!(a >= 1 && b <= 604 && a <= b)) throw new Error('--pages must satisfy 1 <= N <= M <= 604');
  if (o.commit && !/^[0-9a-f]{40}$/.test(o.commit)) throw new Error('--commit must be a full 40-hex SHA');
  return o;
}

async function withRetry(fn, label, tries = 5) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`${label}: ${err?.message ?? err}`);
}

async function resolveCommit() {
  const j = await withRetry(async () => {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mushaf-digital-build' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, 'resolve commit');
  if (!/^[0-9a-f]{40}$/.test(j.sha ?? '')) throw new Error('GitHub API returned no commit sha');
  return j.sha;
}

/** Download (or reuse cached) file; returns Buffer. */
async function cached(cacheDir, sha, rel) {
  const file = path.join(cacheDir, rel);
  try {
    const s = await stat(file);
    if (s.size > 0) return await readFile(file);
  } catch {
    /* not cached */
  }
  const url = `https://raw.githubusercontent.com/${REPO}/${sha}/${UPSTREAM_PATH}/${rel}`;
  const buf = await withRetry(async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
  }, `download ${rel}`);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  await writeFile(tmp, buf);
  await rename(tmp, file);
  return buf;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      if (++done % 50 === 0 || done === items.length) process.stdout.write(`  ${done}/${items.length}\r`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  process.stdout.write('\n');
  return results;
}

/** Fetch per-surah EQuran.id payloads (latin + translation share them); cached in .content-cache/latin/<date>/. */
async function fetchEquran(refresh) {
  const dir = path.join(ROOT, '.content-cache', 'latin', new Date().toISOString().slice(0, 10));
  const nums = Array.from({ length: 114 }, (_, i) => i + 1);
  const payloads = await pool(nums, 4, async (n) => {
    const file = path.join(dir, `${pad(n)}.json`);
    if (!refresh) {
      try {
        return JSON.parse(await readFile(file, 'utf8'));
      } catch {
        /* not cached */
      }
    }
    const url = `https://equran.id/api/v2/surat/${n}`;
    const text = await withRetry(async () => {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.text();
    }, `latin surah ${n}`);
    const json = JSON.parse(text);
    await mkdir(dir, { recursive: true });
    await writeFile(file, text);
    return json;
  });
  return payloads;
}

/** Fetch per-surah tafsir payloads from EQuran.id; cached in .content-cache/tafsir/<date>/ (concurrency 3). */
async function fetchTafsir(refresh) {
  const dir = path.join(ROOT, '.content-cache', 'tafsir', new Date().toISOString().slice(0, 10));
  const nums = Array.from({ length: 114 }, (_, i) => i + 1);
  return pool(nums, 3, async (n) => {
    const file = path.join(dir, `${pad(n)}.json`);
    if (!refresh) {
      try {
        return JSON.parse(await readFile(file, 'utf8'));
      } catch {
        /* not cached */
      }
    }
    const url = `https://equran.id/api/v2/tafsir/${n}`;
    const text = await withRetry(async () => {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.text();
    }, `tafsir surah ${n}`);
    const json = JSON.parse(text);
    await mkdir(dir, { recursive: true });
    await writeFile(file, text);
    return json;
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [from, to] = opts.pages;
  const partial = !(from === 1 && to === 604);
  const sha = opts.commit ?? (await resolveCommit());
  console.log(`Upstream ${REPO} @ ${sha}${partial ? `  (PARTIAL pages ${from}-${to})` : ''}`);
  const cacheDir = path.join(ROOT, '.content-cache', sha);
  const pageNums = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  console.log('Downloading surah.json ...');
  const surahBuf = await cached(cacheDir, sha, 'json/surah.json');
  const upstreamSurahs = JSON.parse(surahBuf.toString('utf8'));

  console.log('Downloading + validating pages ...');
  const pageData = await pool(pageNums, opts.concurrency, async (p) => {
    const [svg, json] = await Promise.all([
      cached(cacheDir, sha, `svg/${pad(p)}.svg`),
      cached(cacheDir, sha, `json/${pad(p)}.json`),
    ]);
    validateSvg(svg.toString('utf8'), `svg/${pad(p)}.svg`);
    return { p, svg, json, entries: JSON.parse(json.toString('utf8')) };
  });

  const entriesByPage = pageData.map((d) => d.entries);
  const pageAyahLists = entriesByPage.map((e, i) => pageAyahs(e, pageNums[i]));
  const pages = derivePages(entriesByPage, from);
  const surahs = deriveSurahs(upstreamSurahs, pages);
  // Partial builds list only juz whose start ayah falls inside the downloaded range.
  const juz = partial
    ? JUZ_STARTS.map(([s, a], i) => {
        const idx = pageAyahLists.findIndex((l) => l.some((r) => r.surah === s && r.ayah === a));
        return idx < 0 ? null : { number: i + 1, start: { surah: s, ayah: a }, page: from + idx };
      }).filter(Boolean)
    : deriveJuz(entriesByPage, from);

  const errs = checkIntegrity({ surahs, pages, juz, pageAyahLists, partial });
  if (errs.length) {
    console.error(`Integrity check FAILED (${errs.length}):`);
    for (const e of errs.slice(0, 30)) console.error('  - ' + e);
    process.exit(1);
  }

  const contentVersion = sha.slice(0, 12);
  const edition = {
    editionId: 'hafs-kfqc',
    riwayah: 'hafs',
    pageCount: 604,
    contentVersion,
    source: { repo: `https://github.com/${REPO}`, commit: sha, path: UPSTREAM_PATH },
    license: {
      artwork:
        "Mushaf artwork (c) King Fahd Glorious Qur'an Printing Complex, Madinah; free for digital use, not for commercial printing of physical mushafs.",
      metadata: 'Ayah polygons and page/surah metadata from quranpedia/quran-svg, CC BY 4.0.',
    },
    attribution:
      "Mushaf Madinah (Hafs) (c) Kompleks Percetakan Al-Qur'an Raja Fahd. Data poligon ayat dan metadata: quranpedia/quran-svg (CC BY 4.0). / Madinah Mushaf (Hafs) (c) King Fahd Glorious Qur'an Printing Complex. Ayah polygons and metadata: quranpedia/quran-svg (CC BY 4.0).",
  };

  let latin = null;
  let translation = null;
  let arabic = null;
  let footnotes = [];
  if (!opts.skipLatin || !opts.skipTranslation) {
    console.log('Fetching EQuran.id (latin + translation) ...');
    if (partial) console.log('  (partial build: still covers all 114 surahs)');
    const payloads = await fetchEquran(opts.latinRefresh);
    if (!opts.skipLatin) latin = buildLatinMap(payloads, surahs);
    arabic = buildArabicMap(payloads, surahs);
    if (!opts.skipTranslation) {
      translation = buildTranslationMap(payloads, surahs);
      footnotes = findFootnoteMarkers(translation);
      if (footnotes.length) console.warn(`WARNING: ${footnotes.length} translation entries with probable footnote markers (left unaltered)`);
    }
  }

  let tafsir = null;
  if (!opts.skipTafsir) {
    console.log('Fetching EQuran.id tafsir ...');
    tafsir = buildTafsirMaps(await fetchTafsir(opts.latinRefresh), surahs);
  }

  // Write to a fresh temp dir then swap in, so a failed build never leaves a mixed folder.
  const tmpOut = `${OUT}.tmp`;
  await rm(tmpOut, { recursive: true, force: true });
  await mkdir(path.join(tmpOut, 'svg'), { recursive: true });
  const files = {};
  const emit = async (rel, buf) => {
    await writeFile(path.join(tmpOut, rel), buf);
    files[rel] = { sha256: sha256(buf), bytes: buf.length };
  };
  let largest = { bytes: 0, page: 0 };
  for (const d of pageData) {
    await emit(`svg/${pad(d.p)}.svg`, d.svg); // byte-for-byte, unmodified
    if (d.svg.length > largest.bytes) largest = { bytes: d.svg.length, page: d.p };
  }
  const json = (o) => Buffer.from(JSON.stringify(o, null, 1) + '\n', 'utf8');
  await emit('edition.json', json({ ...edition, partial: partial || undefined }));
  await emit('surahs.json', json(surahs));
  await emit('pages.json', json(pages));
  await emit('juz.json', json(juz));
  if (latin) {
    await emit(
      'latin.json',
      Buffer.from(
        JSON.stringify({ format: 'mushaf-latin', version: 1, source: { ...LATIN_SOURCE, fetchedAt: new Date().toISOString() }, ayahs: latin }) + '\n',
        'utf8',
      ),
    );
  }
  if (arabic) {
    const a = { format: 'mushaf-arabic', version: 1, source: { ...ARABIC_SOURCE, fetchedAt: new Date().toISOString() }, ayahs: arabic };
    await emit('arabic.json', Buffer.from(JSON.stringify(a) + '\n', 'utf8'));
  }
  if (translation) {
    const t = { format: 'mushaf-translation', version: 1, lang: 'id', source: { ...TRANSLATION_SOURCE, fetchedAt: new Date().toISOString() }, ayahs: translation };
    await emit('translation-id.json', Buffer.from(JSON.stringify(t) + '\n', 'utf8'));
  }
  let tafsirTotal = 0;
  let tafsirLargest = { bytes: 0, surah: 0 };
  if (tafsir) {
    await mkdir(path.join(tmpOut, 'tafsir'), { recursive: true });
    const fetchedAt = new Date().toISOString();
    const sizes = {};
    for (let i = 0; i < 114; i++) {
      const n = i + 1;
      const buf = Buffer.from(
        JSON.stringify({ format: 'mushaf-tafsir', version: 1, source: { ...TAFSIR_SOURCE, fetchedAt }, surah: n, ayahs: tafsir[i] }) + '\n',
        'utf8',
      );
      await emit(`tafsir/${n}.json`, buf);
      sizes[n] = buf.length;
      tafsirTotal += buf.length;
      if (buf.length > tafsirLargest.bytes) tafsirLargest = { bytes: buf.length, surah: n };
    }
    await emit('tafsir/index.json', json({ format: 'mushaf-tafsir-index', version: 1, source: { ...TAFSIR_SOURCE, fetchedAt }, sizes, totalBytes: tafsirTotal }));
  }
  // Keep the optional tajweed layouts (built separately by build-qcf.mjs) across rebuilds.
  try {
    const qcfDir = path.join(OUT, 'qcf');
    const names = await readdir(qcfDir);
    await mkdir(path.join(tmpOut, 'qcf'), { recursive: true });
    for (const name of names) await emit(`qcf/${name}`, await readFile(path.join(qcfDir, name)));
  } catch {
    /* no qcf folder yet */
  }
  const totalBytes = Object.values(files).reduce((n, f) => n + f.bytes, 0);
  const manifest = { editionId: 'hafs-kfqc', contentVersion, files, totalBytes, ...(partial ? { partial: true, pages: [from, to] } : {}) };
  await writeFile(path.join(tmpOut, 'manifest.json'), json(manifest));
  await rm(OUT, { recursive: true, force: true });
  await rename(tmpOut, OUT);

  const mb = (n) => (n / 1048576).toFixed(1);
  console.log('\nBuild OK');
  console.log(`  commit       ${sha}`);
  console.log(`  pages        ${pages.length}${partial ? ' (partial)' : ''}`);
  console.log(`  surahs       ${surahs.length}   juz ${juz.length}`);
  console.log(`  latin        ${latin ? Object.keys(latin).length + ' ayahs' : 'skipped'}`);
  console.log(`  arabic       ${arabic ? Object.keys(arabic).length + ' ayahs' : 'skipped'}`);
  console.log(`  translation  ${translation ? Object.keys(translation).length + ' ayahs, footnote-marker entries: ' + footnotes.length : 'skipped'}`);
  console.log(`  tafsir       ${tafsir ? `114 files, ${tafsirTotal} bytes (${mb(tafsirTotal)} MB), largest surah ${tafsirLargest.surah} = ${tafsirLargest.bytes} bytes` : 'skipped'}`);
  console.log(`  files        ${Object.keys(files).length}`);
  console.log(`  total bytes  ${totalBytes} (${mb(totalBytes)} MB)`);
  console.log(`  largest page ${pad(largest.page)} = ${largest.bytes} bytes (${(largest.bytes / 1024).toFixed(0)} KB)`);
  console.log(`  output       ${OUT}`);
}

main().catch((e) => {
  console.error('Build FAILED: ' + (e?.message ?? e));
  process.exit(1);
});

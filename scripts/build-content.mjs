#!/usr/bin/env node
// Builds app/public/content/hafs-kfqc/ from a pinned commit of quranpedia/quran-svg.
// Usage: node scripts/build-content.mjs [--commit <sha>] [--pages 1-10] [--concurrency 8]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUZ_STARTS, deriveJuz, derivePages, deriveSurahs, pageAyahs, checkIntegrity } from './lib/derive.mjs';
import { LATIN_SOURCE, buildLatinMap } from './lib/latin.mjs';
import { validateSvg } from './lib/svg-validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'quranpedia/quran-svg';
const UPSTREAM_PATH = 'mushafs/hafs/kfqc';
const OUT = path.join(ROOT, 'app', 'public', 'content', 'hafs-kfqc');
const pad = (n) => String(n).padStart(3, '0');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const o = { commit: null, pages: [1, 604], concurrency: 8, skipLatin: false, latinRefresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') o.commit = argv[++i];
    else if (a === '--pages') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(argv[++i] ?? '');
      if (!m) throw new Error('--pages expects N or N-M');
      o.pages = [Number(m[1]), Number(m[2] ?? m[1])];
    } else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
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

/** Fetch per-surah transliteration from EQuran.id; cached in .content-cache/latin/<date>/. */
async function fetchLatin(surahs, refresh) {
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
  return buildLatinMap(payloads, surahs);
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
  if (!opts.skipLatin) {
    console.log('Fetching Latin transliteration (EQuran.id) ...');
    if (partial) console.log('  (partial build: latin still covers all 114 surahs)');
    latin = await fetchLatin(surahs, opts.latinRefresh);
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
  console.log(`  files        ${Object.keys(files).length}`);
  console.log(`  total bytes  ${totalBytes} (${mb(totalBytes)} MB)`);
  console.log(`  largest page ${pad(largest.page)} = ${largest.bytes} bytes (${(largest.bytes / 1024).toFixed(0)} KB)`);
  console.log(`  output       ${OUT}`);
}

main().catch((e) => {
  console.error('Build FAILED: ' + (e?.message ?? e));
  process.exit(1);
});

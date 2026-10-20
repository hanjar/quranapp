#!/usr/bin/env node
// Builds the QCF V4 (tajweed) page layouts into app/public/content/<edition>/qcf/{page}.json.
// Source: Quran.com API v4 (mushaf=19). Polite: concurrency <= 3, retries, cache in .content-cache/qcf/.
// Usage: node scripts/build-qcf.mjs [--refresh] [--concurrency 3] [--pages a-b]
import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiUrl, buildQcfPage, groupByPage, validateQcf } from './lib/qcf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'app', 'public', 'content', 'hafs-kfqc');
const CACHE = path.join(ROOT, '.content-cache', 'qcf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function parseArgs(argv) {
  const o = { refresh: false, concurrency: 3, pages: [1, 604] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--refresh') o.refresh = true;
    else if (a === '--concurrency') o.concurrency = Math.min(3, Number(argv[++i]));
    else if (a === '--pages') o.pages = argv[++i].split('-').map(Number);
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

async function withRetry(fn, label, tries = 6) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await sleep(500 * 2 ** i);
    }
  }
  throw new Error(`${label}: ${err?.message ?? err}`);
}

async function fetchPage(page, refresh) {
  const file = path.join(CACHE, `${page}.json`);
  if (!refresh) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      /* not cached */
    }
  }
  const payload = await withRetry(async () => {
    const r = await fetch(apiUrl(page), { headers: { accept: 'application/json' } });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.pagination?.next_page) throw new Error('unexpected pagination (raise per_page)');
    return j;
  }, `page ${page}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(payload));
  await sleep(120); // be polite
  return payload;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [from, to] = opts.pages;
  const partial = !(from === 1 && to === 604);
  const surahs = JSON.parse(await readFile(path.join(CONTENT, 'surahs.json'), 'utf8')).map((s) => ({
    number: s.number,
    ayahCount: s.ayahCount,
  }));
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const payloads = new Array(nums.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < nums.length) {
      const i = next++;
      payloads[i] = await fetchPage(nums[i], opts.refresh);
      if (++done % 50 === 0 || done === nums.length) console.log(`  ${done}/${nums.length}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const grouped = groupByPage(payloads);
  const built = nums.map((n) => buildQcfPage(grouped.get(n) ?? { verses: [] }, n));

  if (!partial) {
    const errs = validateQcf(built, surahs);
    if (errs.length) {
      console.error(`Validation FAILED (${errs.length}):`);
      errs.slice(0, 30).forEach((e) => console.error('  - ' + e));
      process.exit(1);
    }
  }

  const out = path.join(CONTENT, 'qcf');
  const tmp = `${out}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const entries = {};
  let total = 0;
  for (const p of built) {
    const buf = Buffer.from(JSON.stringify(p) + '\n', 'utf8');
    await writeFile(path.join(tmp, `${p.page}.json`), buf);
    entries[`qcf/${p.page}.json`] = { sha256: sha256(buf), bytes: buf.length };
    total += buf.length;
  }
  await rm(out, { recursive: true, force: true });
  await rename(tmp, out);

  // Merge into manifest.json (drop stale qcf entries first); totalBytes = sum of all files, like build-content.
  const mfFile = path.join(CONTENT, 'manifest.json');
  const manifest = JSON.parse(await readFile(mfFile, 'utf8'));
  for (const k of Object.keys(manifest.files)) if (k.startsWith('qcf/')) delete manifest.files[k];
  Object.assign(manifest.files, entries);
  manifest.totalBytes = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
  await writeFile(mfFile, JSON.stringify(manifest, null, 1) + '\n');

  const lines = built.reduce((n, p) => n + p.lines.length, 0);
  console.log(`\nQCF OK: ${built.length} pages, ${lines} lines, ${total} bytes (${(total / 1048576).toFixed(2)} MB)${partial ? ' (PARTIAL, not validated)' : ''}`);
  console.log(`  output ${out}`);
}

main().catch((e) => {
  console.error('Build FAILED: ' + (e?.message ?? e));
  process.exit(1);
});

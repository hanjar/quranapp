#!/usr/bin/env node
// Builds offline audio packages (qari Alafasy) into .content-cache/audio/out/.
// Usage: node scripts/build-audio.mjs [--limit N] [--concurrency 8] [--jobs <cpu>] [--skip-verify]
// Requires ffmpeg (libopus) and ffprobe on PATH. No uploads are performed.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, stat, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS, acceptableAudio, allAyahs, ayahBase, buildManifest, durationOk, perJuzAverage, pickSample } from './lib/audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'app', 'public', 'content', 'hafs-kfqc');
const AUDIO = path.join(ROOT, '.content-cache', 'audio');
const OUT = path.join(AUDIO, 'out');
const CDN = 'https://cdn.islamic.network/quran/audio';

function parseArgs(argv) {
  const o = { limit: null, concurrency: 8, jobs: os.cpus().length, skipVerify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (a === '--jobs') o.jobs = Number(argv[++i]);
    else if (a === '--skip-verify') o.skipVerify = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

async function pool(items, n, fn, label) {
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
      if (++done % 200 === 0 || done === items.length) {
        console.log(`  ${label}: ${done}/${items.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

const size = async (f) => {
  try {
    return (await stat(f)).size;
  } catch {
    return 0;
  }
};

async function download(kbps, n, dest) {
  if ((await size(dest)) > 0) return;
  const url = `${CDN}/${kbps}/ar.alafasy/${n}.mp3`;
  const buf = await withRetry(async () => {
    const r = await fetch(url);
    if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`);
    const ct = r.headers.get('content-type') ?? '';
    const b = Buffer.from(await r.arrayBuffer());
    if (!acceptableAudio(ct, b)) throw new Error(`non-audio response (content-type "${ct}") for ${url}`);
    if (b.length === 0) throw new Error(`empty body for ${url}`);
    const len = Number(r.headers.get('content-length'));
    if (len && len !== b.length) throw new Error(`truncated body for ${url}`);
    return b;
  }, `download ${kbps}/${n}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(`${dest}.part`, buf);
  await rename(`${dest}.part`, dest);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`))));
  });
}

async function encode(src, dest, kbps) {
  const srcStat = await stat(src);
  try {
    const d = await stat(dest);
    if (d.size > 0 && d.mtimeMs >= srcStat.mtimeMs) return;
  } catch {
    /* missing */
  }
  const tmp = `${dest}.part`;
  await run('ffmpeg', [
    '-nostdin', '-v', 'error', '-y', '-i', src,
    '-ac', '1', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-application', 'audio',
    '-f', 'webm', tmp,
  ]);
  await rename(tmp, dest);
}

const probe = async (f) => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).trim());

async function main() {
  const t0 = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const surahs = JSON.parse(await readFile(path.join(CONTENT, 'surahs.json'), 'utf8'));
  const juz = JSON.parse(await readFile(path.join(CONTENT, 'juz.json'), 'utf8'));
  let ayahs = allAyahs(surahs);
  if (ayahs.length !== 6236) throw new Error(`surahs.json yields ${ayahs.length} ayahs, expected 6236`);
  const full = !opts.limit;
  if (opts.limit) ayahs = ayahs.slice(0, opts.limit);

  const src = (kbps, r) => path.join(AUDIO, `src${kbps}`, `${r.n}.mp3`);
  const out = (variant, r) => path.join(OUT, variant, `${ayahBase(r.surah, r.ayah)}.${VARIANTS[variant].ext}`);
  for (const v of Object.keys(VARIANTS)) await mkdir(path.join(OUT, v), { recursive: true });

  console.log(`Downloading ${ayahs.length} ayahs x 2 bitrates (concurrency ${opts.concurrency}) ...`);
  const jobs = ayahs.flatMap((r) => [[128, r], [64, r]]);
  await pool(jobs, opts.concurrency, ([k, r]) => download(k, r.n, src(k, r)), 'download');

  console.log(`Encoding with ffmpeg (${opts.jobs} parallel) ...`);
  const enc = ayahs.flatMap((r) => [['opus24', 24, r], ['opus32', 32, r]]);
  await pool(enc, opts.jobs, ([v, k, r]) => encode(src(128, r), out(v, r), k), 'encode');

  console.log('Copying 64 kbps MP3 (byte-for-byte) ...');
  await pool(ayahs, 16, async (r) => {
    const dest = out('mp364', r);
    if ((await size(dest)) !== (await size(src(64, r)))) await copyFile(src(64, r), dest);
  }, 'copy');

  const bytesByVariant = {};
  for (const v of Object.keys(VARIANTS)) {
    const bytes = [];
    for (const r of ayahs) {
      const b = await size(out(v, r));
      if (b <= 0) throw new Error(`${v}: missing or empty ${path.basename(out(v, r))}`);
      bytes.push(b);
    }
    if (bytes.length !== ayahs.length) throw new Error(`${v}: wrong file count`);
    bytesByVariant[v] = bytes;
  }
  // mp364 must equal the source exactly
  for (const r of ayahs) {
    if ((await size(out('mp364', r))) !== (await size(src(64, r)))) throw new Error(`mp364 differs from source at ${r.n}`);
  }

  if (!opts.skipVerify) {
    const sample = pickSample(ayahs, full ? 300 : Math.min(30, ayahs.length));
    console.log(`Verifying durations of ${sample.length} ayahs x 3 variants ...`);
    const bad = [];
    await pool(sample, opts.jobs, async (r) => {
      const ref = await probe(src(128, r));
      for (const v of Object.keys(VARIANTS)) {
        const d = await probe(out(v, r));
        if (!durationOk(ref, d)) bad.push(`${v} ${ayahBase(r.surah, r.ayah)}: ref ${ref.toFixed(2)}s got ${d.toFixed(2)}s`);
      }
    }, 'verify');
    if (bad.length) {
      console.error(`Duration verification FAILED (${bad.length}):`);
      for (const b of bad.slice(0, 30)) console.error('  - ' + b);
      process.exit(1);
    }
  }

  if (full) {
    const manifest = buildManifest({ bytesByVariant, builtAt: new Date().toISOString() });
    await writeFile(path.join(OUT, 'audio-manifest.json'), JSON.stringify(manifest) + '\n');
    const mb = (n) => (n / 1048576).toFixed(1);
    console.log('\nAudio build OK');
    for (const [id, v] of Object.entries(manifest.variants)) {
      const perJuz = perJuzAverage(juz, surahs, v.bytes);
      const avg = perJuz.reduce((a, b) => a + b, 0) / perJuz.length;
      console.log(`  ${id.padEnd(7)} ${v.label.padEnd(10)} ${mb(v.totalBytes).padStart(8)} MB  files ${v.bytes.length}  avg/juz ${mb(avg)} MB  (min ${mb(Math.min(...perJuz))}, max ${mb(Math.max(...perJuz))})`);
    }
  } else {
    console.log('\nPartial run OK (manifest not written)');
  }
  console.log(`  wall time ${((Date.now() - t0) / 1000).toFixed(0)}s   output ${OUT}`);
}

main().catch((e) => {
  console.error('Audio build FAILED: ' + (e?.message ?? e));
  process.exit(1);
});

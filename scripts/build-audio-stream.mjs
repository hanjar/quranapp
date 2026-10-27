#!/usr/bin/env node
// Builds our own Opus 32 kbps copy of a streaming-only qari (no offline packages) into
// .content-cache/audio/<qari>/opus32/, for devices that cannot decode the source MP3s (D45).
// Usage: node scripts/build-audio-stream.mjs ghamdi [--limit N] [--jobs 8]
// Requires ffmpeg (libopus). Writes upload-<qari>.json (key/file pairs for `wrangler r2 bulk put`).
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allAyahs, ayahBase } from './lib/audio.mjs';

const SOURCES = {
  ghamdi: (base) => `https://everyayah.com/data/Ghamadi_40kbps/${base}.mp3`,
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qari = process.argv[2];
if (!SOURCES[qari]) throw new Error(`unknown qari: ${qari}`);
const args = process.argv.slice(3);
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const limit = opt('--limit', Infinity);
const jobs = opt('--jobs', os.cpus().length);

const DIR = path.join(ROOT, '.content-cache', 'audio', qari);
const SRC = path.join(DIR, 'src');
const OUT = path.join(DIR, 'opus32');

const exists = (f) => stat(f).then((s) => s.size > 0, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${c}: ${err.slice(0, 300)}`))));
  });
}

async function download(url, dest) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`too small (${buf.length})`);
      await writeFile(`${dest}.part`, buf);
      await rename(`${dest}.part`, dest);
      return;
    } catch (e) {
      if (i === 5) throw new Error(`${url}: ${e.message}`);
      await sleep(500 * 2 ** i);
    }
  }
}

async function one(r) {
  const base = ayahBase(r.surah, r.ayah);
  const src = path.join(SRC, `${base}.mp3`);
  const dest = path.join(OUT, `${base}.webm`);
  if (await exists(dest)) return;
  if (!(await exists(src))) await download(SOURCES[qari](base), src);
  await run('ffmpeg', [
    '-nostdin', '-v', 'error', '-y', '-i', src,
    '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'audio',
    '-f', 'webm', `${dest}.part`,
  ]);
  await rename(`${dest}.part`, dest);
}

const surahs = JSON.parse(await readFile(path.join(ROOT, 'app/public/content/hafs-kfqc/surahs.json'), 'utf8'));
const list = allAyahs(Array.isArray(surahs) ? surahs : surahs.surahs).slice(0, limit);
await mkdir(SRC, { recursive: true });
await mkdir(OUT, { recursive: true });

let next = 0;
let done = 0;
const failed = [];
const t0 = Date.now();
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < list.length) {
      const r = list[next++];
      try {
        await one(r);
      } catch (e) {
        failed.push(`${r.surah}:${r.ayah} ${e.message}`);
      }
      if (++done % 250 === 0 || done === list.length)
        console.log(`${done}/${list.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }),
);
if (failed.length) {
  console.error(`FAILED ${failed.length}:\n${failed.slice(0, 20).join('\n')}`);
  process.exit(1);
}
const pairs = list.map((r) => {
  const base = ayahBase(r.surah, r.ayah);
  return { key: `${qari}/opus32/${base}.webm`, file: path.join(OUT, `${base}.webm`) };
});
await writeFile(path.join(DIR, `upload-${qari}.json`), JSON.stringify(pairs));
console.log(`done: ${list.length} files in ${OUT}`);

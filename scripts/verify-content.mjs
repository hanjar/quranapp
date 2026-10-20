#!/usr/bin/env node
// Re-hashes generated content against manifest.json. Usage: node scripts/verify-content.mjs [dir]
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] ?? path.join(ROOT, 'app', 'public', 'content', 'hafs-kfqc'));

try {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const entries = Object.entries(manifest.files ?? {});
  if (!entries.length) throw new Error('manifest lists no files');
  const bad = [];
  let total = 0;
  for (const [rel, meta] of entries) {
    if (rel.includes('..') || path.isAbsolute(rel)) throw new Error(`unsafe path in manifest: ${rel}`);
    let buf;
    try {
      buf = await readFile(path.join(dir, rel));
    } catch {
      bad.push(`${rel}: missing`);
      continue;
    }
    total += buf.length;
    if (buf.length !== meta.bytes) bad.push(`${rel}: size ${buf.length} != ${meta.bytes}`);
    else if (createHash('sha256').update(buf).digest('hex') !== meta.sha256) bad.push(`${rel}: sha256 mismatch`);
  }
  if (total !== manifest.totalBytes && !bad.length) bad.push(`totalBytes ${total} != ${manifest.totalBytes}`);
  if (bad.length) {
    console.error(`Content verification FAILED (${bad.length}):`);
    for (const b of bad.slice(0, 30)) console.error('  - ' + b);
    process.exit(1);
  }
  console.log(`Content OK: ${entries.length} files, ${total} bytes, version ${manifest.contentVersion}`);
} catch (e) {
  console.error('Content verification FAILED: ' + (e?.message ?? e));
  process.exit(1);
}

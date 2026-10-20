// Production build with the build identity (version, git commit, time) baked in.
// Usage: npm run build   (extra args are passed to `ng build`)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

function git(args) {
  try {
    return execFileSync('git', args, { cwd: appDir, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const sha = git(['rev-parse', '--short=7', 'HEAD']) || 'unknown';
const dirty = git(['status', '--porcelain', '--', '.']) !== '';
const info = {
  MF_APP_VERSION: pkg.version,
  MF_BUILD_SHA: dirty ? `${sha}-dirty` : sha,
  MF_BUILD_TIME: new Date().toISOString(),
};
console.log(`Building Mushaf Digital v${info.MF_APP_VERSION} (${info.MF_BUILD_SHA})`);

const defines = Object.entries(info).flatMap(([k, v]) => ['--define', `${k}=${JSON.stringify(v)}`]);
const ng = join(appDir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const res = spawnSync(process.execPath, [ng, 'build', ...defines, ...process.argv.slice(2)], {
  cwd: appDir,
  stdio: 'inherit',
});
process.exit(res.status ?? 1);

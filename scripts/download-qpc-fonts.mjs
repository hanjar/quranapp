#!/usr/bin/env node
/**
 * Download all 604 QPC (QCF) Mushaf font files (woff2).
 * Source: https://github.com/mustafa0x/qpc-fonts (mushaf-woff2)
 * 
 * Usage: node scripts/download-qpc-fonts.mjs
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(__dirname, '..', 'frontend', 'public', 'fonts', 'qpc');
const BASE_URL = 'https://raw.githubusercontent.com/mustafa0x/qpc-fonts/f93bf5f3/mushaf-woff2';
const TOTAL_PAGES = 604;
const CONCURRENCY = 10;

// Ensure directory exists
mkdirSync(FONT_DIR, { recursive: true });

// Check which fonts already exist
const existing = new Set(readdirSync(FONT_DIR));

async function downloadFont(pageNum) {
    const paddedNum = String(pageNum).padStart(3, '0');
    const filename = `QCF_P${paddedNum}.woff2`;
    const filepath = join(FONT_DIR, filename);

    if (existing.has(filename)) {
        return { page: pageNum, status: 'skipped' };
    }

    const url = `${BASE_URL}/${filename}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        if (buffer.length < 1000) {
            throw new Error(`File too small (${buffer.length} bytes)`);
        }

        writeFileSync(filepath, buffer);
        return { page: pageNum, status: 'ok', size: buffer.length };
    } catch (e) {
        return { page: pageNum, status: 'error', error: e.message };
    }
}

async function main() {
    console.log(`📦 Downloading QPC fonts to: ${FONT_DIR}`);
    console.log(`🔍 ${existing.size} fonts already exist\n`);

    const pages = [];
    for (let i = 1; i <= TOTAL_PAGES; i++) pages.push(i);

    let done = 0;
    let errors = 0;
    let skipped = 0;

    // Process in batches
    for (let i = 0; i < pages.length; i += CONCURRENCY) {
        const batch = pages.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(downloadFont));

        for (const r of results) {
            done++;
            if (r.status === 'error') {
                errors++;
                console.error(`  ❌ Page ${r.page}: ${r.error}`);
            } else if (r.status === 'skipped') {
                skipped++;
            } else {
                process.stdout.write(`  ✅ Page ${r.page} (${(r.size / 1024).toFixed(1)}KB)\n`);
            }
        }

        // Progress
        const pct = Math.round((done / TOTAL_PAGES) * 100);
        process.stdout.write(`\r  Progress: ${done}/${TOTAL_PAGES} (${pct}%) | Errors: ${errors} | Skipped: ${skipped}  `);
    }

    console.log(`\n\n✨ Done! Downloaded: ${done - errors - skipped}, Skipped: ${skipped}, Errors: ${errors}`);

    if (errors > 0) {
        console.log('⚠️  Re-run script to retry failed downloads');
    }
}

main().catch(console.error);

import { describe, expect, it } from 'vitest';
import {
  exportFilename,
  formatBytes,
  formatDateTime,
  formatMb,
  formatRelativeTime,
  importSummary,
} from './format';

describe('formatRelativeTime', () => {
  const now = new Date(2026, 9, 20, 15, 0, 0).getTime();
  it('baru saja', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('baru saja');
    expect(formatRelativeTime(now + 5_000, now)).toBe('baru saja');
  });
  it('minutes', () => expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 menit lalu'));
  it('hours same day', () =>
    expect(formatRelativeTime(new Date(2026, 9, 20, 11, 0).getTime(), now)).toBe('4 jam lalu'));
  it('yesterday', () =>
    expect(formatRelativeTime(new Date(2026, 9, 19, 21, 14).getTime(), now)).toBe('kemarin 21.14'));
  it('older', () =>
    expect(formatRelativeTime(new Date(2026, 9, 12, 8, 5).getTime(), now)).toBe('12 Okt 08.05'));
});

describe('bytes', () => {
  it('formats with decimal comma', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12,4 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
    expect(formatBytes(-5)).toBe('0 B');
  });
  it('formatMb', () => expect(formatMb(86.4 * 1024 * 1024)).toBe('86,4 MB'));
});

describe('misc', () => {
  it('exportFilename', () =>
    expect(exportFilename(new Date(2026, 0, 5))).toBe('mushaf-digital-2026-01-05.json'));
  it('importSummary', () =>
    expect(importSummary({ added: 3, skipped: 1 })).toBe('3 penanda ditambahkan, 1 dilewati'));
});

describe('formatDateTime', () => {
  it('formats day, Indonesian month, year and 24h clock with a dot', () => {
    expect(formatDateTime(new Date(2026, 9, 20, 9, 5).getTime())).toBe('20 Okt 2026 09.05');
  });
});

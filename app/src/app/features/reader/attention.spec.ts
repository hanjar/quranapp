import { describe, expect, it } from 'vitest';
import {
  SYNC_PENDING_TOO_LONG_MS,
  menuNeedsAttention,
  offlineNeedsAttention,
  syncNeedsAttention,
} from './attention';

describe('syncNeedsAttention', () => {
  const now = 1_000_000_000;
  it('flags error, unauthorized and conflict', () => {
    for (const s of ['error', 'unauthorized', 'conflict'] as const) {
      expect(syncNeedsAttention(s, now, now)).toBe(true);
    }
  });
  it('ignores guests and healthy or transient states', () => {
    for (const s of ['off', 'idle', 'synced', 'syncing', 'offline'] as const) {
      expect(syncNeedsAttention(s, null, now)).toBe(false);
    }
  });
  it('flags pending only after it waited too long', () => {
    expect(syncNeedsAttention('pending', now - 1000, now)).toBe(false);
    expect(syncNeedsAttention('pending', now - SYNC_PENDING_TOO_LONG_MS - 1, now)).toBe(true);
    expect(syncNeedsAttention('pending', null, now)).toBe(false);
  });
});

describe('offlineNeedsAttention / menuNeedsAttention', () => {
  it('flags paused, error and quota downloads', () => {
    for (const state of ['paused', 'error', 'quota'] as const) {
      expect(offlineNeedsAttention({ state })).toBe(true);
    }
    for (const state of ['idle', 'downloading', 'done'] as const) {
      expect(offlineNeedsAttention({ state })).toBe(false);
    }
  });
  it('is the OR of the three sources', () => {
    expect(menuNeedsAttention({ sync: false, update: false, offline: false })).toBe(false);
    expect(menuNeedsAttention({ sync: false, update: true, offline: false })).toBe(true);
  });
});

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// Tests share one D1; reset all data between tests (child tables first).
beforeEach(async () => {
  for (const t of [
    'group_juz',
    'group_members',
    'khatam_groups',
    'op_log',
    'feedback',
    'folders',
    'read_marks',
    'reading_days',
    'khatam_rounds',
    'bookmarks',
    'reading_progress',
    'preferences',
    'sessions',
    'oauth_states',
    'user_revisions',
    'users',
    'rate_limits',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

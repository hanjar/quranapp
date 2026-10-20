import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runCleanup } from '../src/housekeeping';
import { sanitizeReturnPath } from '../src/util';
import { cookieFrom, json, makeClient, prefsPayload, uid, verseOp } from './helpers';

const { call, login } = makeClient();

async function batch(cookie: string, ops: unknown[]) {
  const res = await call('POST', '/sync/batch', { cookie, body: { ops } });
  return { res, body: await json(res) };
}
async function pull(cookie: string, qs = '') {
  const res = await call('GET', `/sync${qs}`, { cookie });
  return (await json(res)).data;
}

describe('auth guard, CSRF, headers', () => {
  it('requires a session for protected routes', async () => {
    for (const [m, p] of [
      ['GET', '/sync'],
      ['POST', '/sync/batch'],
      ['GET', '/export'],
      ['DELETE', '/me/data'],
    ] as const) {
      const res = await call(m, p, { body: m === 'POST' ? { ops: [] } : undefined });
      expect(res.status).toBe(401);
      expect((await json(res)).error.code).toBe('unauthenticated');
    }
  });

  it('/health and anonymous /me work without a session', async () => {
    expect((await json(await call('GET', '/health'))).data).toEqual({ ok: true });
    expect((await json(await call('GET', '/me'))).data).toEqual({ user: null });
  });

  it('rejects non-GET without X-Mushaf-Client', async () => {
    const res = await call('POST', '/auth/logout', { csrf: false });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe('csrf');
  });

  it('rejects a foreign Origin on GET and POST, accepts APP_ORIGIN', async () => {
    const evil = { Origin: 'https://evil.example' };
    expect((await call('GET', '/me', { headers: evil })).status).toBe(403);
    expect((await call('POST', '/auth/logout', { headers: evil })).status).toBe(403);
    expect((await call('POST', '/auth/logout', { headers: { Origin: 'https://mushaf.test' } })).status).toBe(200);
  });

  it('sets security headers and never leaks internals on errors', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await json(res)).toEqual({ success: false, error: { code: 'not_found', message: 'Not found.' } });
  });
});

describe('dev-login and sessions', () => {
  it('is 404 unless DEV_AUTH=1', async () => {
    const res = await call('POST', '/auth/dev-login', { body: { email: 'a@b.co' }, envOverride: { DEV_AUTH: '0' } });
    expect(res.status).toBe(404);
    const none = await call('POST', '/auth/dev-login', { body: { email: 'a@b.co' }, envOverride: { DEV_AUTH: undefined } });
    expect(none.status).toBe(404);
  });

  it('creates a hardened cookie, stores only the token hash, and logout invalidates it', async () => {
    const res = await call('POST', '/auth/dev-login', { body: { email: 'Ani@Example.com' } });
    expect(res.status).toBe(200);
    const raw = res.headers.getSetCookie().find((c) => c.startsWith('mf_session='))!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Path=\/api(;|$)/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/Max-Age=2592000/);
    const token = raw.split(';')[0]!.split('=')[1]!;
    const stored = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(stored.results).toHaveLength(1);
    expect(stored.results[0]!.id).not.toContain(token);
    expect(stored.results[0]!.id).toHaveLength(64);

    const cookie = cookieFrom(res);
    expect((await json(await call('GET', '/me', { cookie }))).data.user.email).toBe('ani@example.com');
    expect((await call('POST', '/auth/logout', { cookie })).status).toBe(200);
    expect((await json(await call('GET', '/me', { cookie }))).data.user).toBeNull();
  });

  it('omits Secure only for http://localhost', async () => {
    const { app } = makeClient();
    const res = await app.request(
      'http://localhost:8787/api/v1/auth/dev-login',
      {
        method: 'POST',
        headers: { 'X-Mushaf-Client': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'l@x.co' }),
      },
      { ...env, APP_ORIGIN: 'http://localhost:4200' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).not.toMatch(/Secure/);
  });

  it('slides the expiry and expires old sessions', async () => {
    let t = 1_800_000_000_000;
    const c = makeClient({ now: () => t });
    const cookie = await c.login('slide@x.co');
    t += 2 * 3600_000;
    const res = await c.call('GET', '/me', { cookie });
    expect(res.headers.getSetCookie().some((s) => s.startsWith('mf_session='))).toBe(true);
    t += 31 * 24 * 3600_000;
    expect((await json(await c.call('GET', '/me', { cookie }))).data.user).toBeNull();
  });

  it('rejects an invalid dev-login email', async () => {
    const res = await call('POST', '/auth/dev-login', { body: { email: 'nope' } });
    expect(res.status).toBe(400);
  });
});

describe('return path sanitising', () => {
  it('accepts only same-origin relative paths', () => {
    expect(sanitizeReturnPath('/halaman/3?x=1#a')).toBe('/halaman/3?x=1#a');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, 'foo', '/a\nb']) {
      expect(sanitizeReturnPath(bad)).toBe('/');
    }
  });
});

describe('bookmark sync semantics', () => {
  it('applies, then replays the same opId idempotently', async () => {
    const cookie = await login('a@x.co');
    const op = verseOp('bm-1', 2, 255);
    const first = await batch(cookie, [op]);
    expect(first.body.data.results[0]).toMatchObject({ opId: op.opId, status: 'applied', rev: 1 });
    const again = await batch(cookie, [op]);
    expect(again.body.data.results[0]).toEqual(first.body.data.results[0]);
    const s = await pull(cookie);
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0]).toMatchObject({ entity: 'bookmark', id: 'bm-1', rev: 1, deleted: false });
    expect(s.changes[0].data.key).toBe('hafs-kfqc|verse|2:255');
  });

  it('replays the first result even if state changed afterwards', async () => {
    const cookie = await login('a@x.co');
    const op = verseOp('bm-1', 2, 255);
    await batch(cookie, [op]);
    await batch(cookie, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 1 }]);
    const replay = await batch(cookie, [op]);
    expect(replay.body.data.results[0].status).toBe('applied');
    expect((await pull(cookie)).changes[0].deleted).toBe(true);
  });

  it('flags a duplicate semantic key under another id and returns the current bookmark', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 2, 255)]);
    const { body } = await batch(cookie, [verseOp('bm-2', 2, 255)]);
    const r = body.data.results[0];
    expect(r.status).toBe('duplicate');
    expect(r.current).toMatchObject({ id: 'bm-1', rev: 1, deleted: false });
    expect((await pull(cookie)).changes).toHaveLength(1);
  });

  it('detects duplicates inside one batch', async () => {
    const cookie = await login('a@x.co');
    const { body } = await batch(cookie, [verseOp('bm-1', 1, 1), verseOp('bm-2', 1, 1), verseOp('bm-3', 1, 2)]);
    expect(body.data.results.map((r: { status: string }) => r.status)).toEqual(['applied', 'duplicate', 'applied']);
    expect(body.data.cursor).toBe(2);
  });

  it('returns conflict for a stale baseRev and applies a fresh one', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 2, 255)]);
    const edit = (baseRev: number, ayah: number) => ({ ...verseOp('bm-1', 2, ayah), baseRev });
    expect((await batch(cookie, [edit(1, 256)])).body.data.results[0]).toMatchObject({ status: 'applied', rev: 2 });
    const stale = (await batch(cookie, [edit(1, 257)])).body.data.results[0];
    expect(stale.status).toBe('conflict');
    expect(stale.current).toMatchObject({ id: 'bm-1', rev: 2 });
    expect(stale.current.data.ayah).toBe(256);
  });

  it('delete beats a stale edit; re-adding the deleted id is refused, a new id works', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 2, 255)]);
    const del = { opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 0 };
    expect((await batch(cookie, [del])).body.data.results[0]).toMatchObject({ status: 'applied', rev: 2 });
    const staleEdit = (await batch(cookie, [{ ...verseOp('bm-1', 2, 255), baseRev: 1 }])).body.data.results[0];
    expect(staleEdit.status).toBe('conflict');
    expect(staleEdit.current).toMatchObject({ deleted: true, data: null });
    const reuse = (await batch(cookie, [verseOp('bm-1', 2, 255)])).body.data.results[0];
    expect(reuse.status).toBe('rejected');
    const fresh = (await batch(cookie, [verseOp('bm-9', 2, 255)])).body.data.results[0];
    expect(fresh.status).toBe('applied');
  });

  it('propagates tombstones through /sync and keeps cursors monotonic', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 1, 1), verseOp('bm-2', 1, 2)]);
    const s1 = await pull(cookie);
    expect(s1.cursor).toBe(2);
    await batch(cookie, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 1 }]);
    const s2 = await pull(cookie, `?cursor=${s1.cursor}`);
    expect(s2.reset).toBe(false);
    expect(s2.changes).toEqual([{ entity: 'bookmark', id: 'bm-1', rev: 3, deleted: true, data: null }]);
    expect(s2.cursor).toBe(3);
    const s3 = await pull(cookie, `?cursor=${s2.cursor}`);
    expect(s3.changes).toEqual([]);
    expect(s3.cursor).toBe(3);
  });

  it('allows the same verse again once the previous bookmark is deleted', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 5, 5)]);
    await batch(cookie, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 1 }]);
    expect((await batch(cookie, [verseOp('bm-2', 5, 5)])).body.data.results[0].status).toBe('applied');
  });

  it('paginates with hasMore', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [1, 2, 3, 4, 5].map((n) => verseOp(`bm-${n}`, 1, n)));
    const seen: number[] = [];
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const s = await pull(cookie, `?cursor=${cursor}&limit=2`);
      seen.push(...s.changes.map((c: { rev: number }) => c.rev));
      cursor = s.cursor;
      pages++;
      if (!s.hasMore) break;
      expect(s.changes).toHaveLength(2);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(pages).toBe(3);
  });

  it('rejects bad query parameters', async () => {
    const cookie = await login('a@x.co');
    expect((await call('GET', '/sync?cursor=abc', { cookie })).status).toBe(400);
    expect((await call('GET', '/sync?limit=-1', { cookie })).status).toBe(400);
  });
});

describe('reset horizon', () => {
  it('answers reset:true with a full snapshot when the cursor is older than purged tombstones', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 1, 1), verseOp('bm-2', 1, 2)]);
    await batch(cookie, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 1 }]);
    // Pretend the tombstone is 181 days old, then run the daily cleanup.
    await env.DB.prepare('UPDATE bookmarks SET deleted_at = ?1 WHERE id = ?2')
      .bind(Date.now() - 181 * 24 * 3600_000, 'bm-1')
      .run();
    await runCleanup(env.DB, Date.now());
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM bookmarks').first<{ n: number }>())!.n).toBe(1);

    const stale = await pull(cookie, '?cursor=1');
    expect(stale.reset).toBe(true);
    expect(stale.hasMore).toBe(false);
    expect(stale.changes.map((c: { id: string }) => c.id)).toEqual(['bm-2']);
    expect(stale.cursor).toBe(3);
    // A fresh client (cursor 0) and an up-to-date client are not reset.
    expect((await pull(cookie, '?cursor=0')).reset).toBe(false);
    expect((await pull(cookie, '?cursor=3')).reset).toBe(false);
  });

  it('resets a cursor that is ahead of the server (account recreated)', async () => {
    const cookie = await login('a@x.co');
    expect((await pull(cookie, '?cursor=999')).reset).toBe(true);
  });

  it('cleanup removes expired sessions, states, rate-limit rows and keeps recent tombstones', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 1, 1)]);
    await batch(cookie, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 1 }]);
    await env.DB.prepare('INSERT INTO oauth_states VALUES (?1, ?2, ?3, ?4, ?5)').bind('s', 'v', 'n', '/', 1).run();
    await runCleanup(env.DB, Date.now());
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_states').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM bookmarks').first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n).toBe(1);
  });
});

describe('position and prefs', () => {
  const pos = (over: Record<string, unknown> = {}, id = 'hafs-kfqc') => ({
    opId: uid(),
    entity: 'position',
    entityId: id,
    action: 'upsert',
    baseRev: null,
    payload: { editionId: 'hafs-kfqc', page: 10, surah: 2, ayah: 30, updatedAt: 1, deviceId: 'dev-1', ...over },
  });

  it('always applies position upserts in server rev order', async () => {
    const cookie = await login('a@x.co');
    const r = (await batch(cookie, [pos({ page: 50 }), pos({ page: 5, updatedAt: 0 })])).body.data.results;
    expect(r.map((x: { status: string }) => x.status)).toEqual(['applied', 'applied']);
    const s = await pull(cookie);
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0]).toMatchObject({ entity: 'position', id: 'hafs-kfqc', rev: 2 });
    expect(s.changes[0].data.page).toBe(5);
  });

  it('rejects position deletes and entityId mismatches', async () => {
    const cookie = await login('a@x.co');
    const del = { ...pos(), action: 'delete' };
    const r = (await batch(cookie, [del, pos({}, 'other-ed')])).body.data.results;
    expect(r.map((x: { status: string }) => x.status)).toEqual(['rejected', 'rejected']);
  });

  const prefsOp = (baseRev: number | null, over: Record<string, unknown> = {}) => ({
    opId: uid(),
    entity: 'prefs',
    entityId: 'prefs',
    action: 'upsert',
    baseRev,
    payload: prefsPayload(over),
  });

  it('prefs: LWW by rev, stale baseRev conflicts with current', async () => {
    const cookie = await login('a@x.co');
    expect((await batch(cookie, [prefsOp(null)])).body.data.results[0]).toMatchObject({ status: 'applied', rev: 1 });
    expect((await batch(cookie, [prefsOp(1, { uiTheme: 'samudra' })])).body.data.results[0]).toMatchObject({ status: 'applied', rev: 2 });
    const stale = (await batch(cookie, [prefsOp(1, { uiTheme: 'ceria' })])).body.data.results[0];
    expect(stale.status).toBe('conflict');
    expect(stale.current).toMatchObject({ entity: 'prefs', id: 'prefs', rev: 2 });
    expect(stale.current.data.uiTheme).toBe('samudra');
    const noBase = (await batch(cookie, [prefsOp(null)])).body.data.results[0];
    expect(noBase.status).toBe('conflict');
  });

  it('prefs validation rejects unknown enum values', async () => {
    const cookie = await login('a@x.co');
    const r = (await batch(cookie, [prefsOp(null, { uiTheme: 'neon' })])).body.data.results[0];
    expect(r.status).toBe('rejected');
  });
});

describe('validation', () => {
  it('rejects page 605, surah 0, bad kind, verse without ayah', async () => {
    const cookie = await login('a@x.co');
    const ops = [
      verseOp('bm-1', 1, 1, { page: 605 }),
      verseOp('bm-2', 0, 1),
      verseOp('bm-3', 1, 1, { kind: 'folder' }),
      verseOp('bm-4', 1, 1, { ayah: null }),
      verseOp('bm-5', 115, 1),
      verseOp('bm-6', 1, 1, { page: 0 }),
    ];
    const r = (await batch(cookie, ops)).body.data.results;
    expect(r.map((x: { status: string }) => x.status)).toEqual(Array(6).fill('rejected'));
    expect((await pull(cookie)).changes).toEqual([]);
  });

  it('rejects an oversized batch (>100 ops) and non-array ops', async () => {
    const cookie = await login('a@x.co');
    const ops = Array.from({ length: 101 }, (_, i) => verseOp(`bm-${i}`, 1, (i % 7) + 1));
    const big = await batch(cookie, ops);
    expect(big.res.status).toBe(400);
    expect(big.body.error.code).toBe('too_many_ops');
    const bad = await call('POST', '/sync/batch', { cookie, body: { ops: 'x' } });
    expect(bad.status).toBe(400);
  });

  it('accepts exactly 100 ops', async () => {
    const cookie = await login('a@x.co');
    const ops = Array.from({ length: 100 }, (_, i) => verseOp(`bm-${i}`, 2, i + 1));
    const { res, body } = await batch(cookie, ops);
    expect(res.status).toBe(200);
    expect(body.data.results.every((r: { status: string }) => r.status === 'applied')).toBe(true);
    expect(body.data.cursor).toBe(100);
  });

  it('rejects oversized bodies, non-JSON and wrong content types', async () => {
    const cookie = await login('a@x.co');
    const huge = await call('POST', '/sync/batch', { cookie, rawBody: JSON.stringify({ ops: [], pad: 'x'.repeat(300_000) }) });
    expect(huge.status).toBe(413);
    const bad = await call('POST', '/sync/batch', { cookie, rawBody: '{nope' });
    expect(bad.status).toBe(400);
    const wrongType = await call('POST', '/sync/batch', { cookie, rawBody: '{}', headers: { 'Content-Type': 'text/plain' } });
    expect(wrongType.status).toBe(415);
  });

  it('rejects malformed ops individually without failing the batch', async () => {
    const cookie = await login('a@x.co');
    const { body } = await batch(cookie, [{ opId: 'short', entity: 'bookmark' }, { ...verseOp('bm-1', 1, 1), entity: 'folder' }, verseOp('bm-2', 1, 2)]);
    expect(body.data.results.map((r: { status: string }) => r.status)).toEqual(['rejected', 'rejected', 'applied']);
  });

  it('ignores a client-supplied key and user id fields (server derives them)', async () => {
    const cookie = await login('a@x.co');
    const op = verseOp('bm-1', 2, 2, { key: 'hafs-kfqc|verse|9:9', userId: 'someone-else' });
    await batch(cookie, [op]);
    const s = await pull(cookie);
    expect(s.changes[0].data.key).toBe('hafs-kfqc|verse|2:2');
    expect(s.changes[0].data).not.toHaveProperty('userId');
  });
});

describe('isolation, export and deletion', () => {
  it("user B cannot read or modify user A's bookmark", async () => {
    const a = await login('a@x.co');
    const b = await login('b@x.co');
    await batch(a, [verseOp('bm-1', 2, 255)]);

    expect((await pull(b)).changes).toEqual([]);
    expect((await json(await call('GET', '/export', { cookie: b }))).data.bookmarks).toEqual([]);

    // B edits / deletes A's id: sees nothing there (creates own, delete is a no-op).
    const edit = (await batch(b, [{ ...verseOp('bm-1', 3, 3), baseRev: 1 }])).body.data.results[0];
    expect(edit.status).toBe('rejected');
    const del = (await batch(b, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-1', action: 'delete', baseRev: 1 }])).body.data.results[0];
    expect(del.status).toBe('applied');
    expect(del.rev).toBeUndefined();

    const aState = await pull(a);
    expect(aState.changes).toHaveLength(1);
    expect(aState.changes[0]).toMatchObject({ id: 'bm-1', deleted: false, rev: 1 });
    // B can bookmark the same verse independently (own scope).
    expect((await batch(b, [verseOp('bm-b', 2, 255)])).body.data.results[0].status).toBe('applied');
  });

  it('opIds are scoped per user', async () => {
    const a = await login('a@x.co');
    const b = await login('b@x.co');
    const op = verseOp('bm-1', 1, 1);
    await batch(a, [op]);
    const r = (await batch(b, [op])).body.data.results[0];
    expect(r).toMatchObject({ status: 'applied', rev: 1 });
  });

  it('exports all cloud data of the user', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [
      verseOp('bm-1', 1, 1),
      {
        opId: uid(),
        entity: 'position',
        entityId: 'hafs-kfqc',
        action: 'upsert',
        baseRev: null,
        payload: { editionId: 'hafs-kfqc', page: 4, surah: 2, ayah: 10, updatedAt: 5, deviceId: 'd1' },
      },
      { opId: uid(), entity: 'prefs', entityId: 'prefs', action: 'upsert', baseRev: null, payload: prefsPayload() },
    ]);
    const d = (await json(await call('GET', '/export', { cookie }))).data;
    expect(d.account.email).toBe('a@x.co');
    expect(d.bookmarks).toHaveLength(1);
    expect(d.positions[0].page).toBe(4);
    expect(d.preferences.uiTheme).toBe('segar');
  });

  it('DELETE /me/data removes everything, clears the cookie and kills the session', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 1, 1)]);
    const res = await call('DELETE', '/me/data', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('mf_session='))).toMatch(/Max-Age=0/);
    for (const t of ['users', 'sessions', 'bookmarks', 'op_log', 'user_revisions']) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
    }
    expect((await call('GET', '/sync', { cookie })).status).toBe(401);
    // Logging in again yields a fresh account (new id, revision restarts), never the old data.
    const again = await login('a@x.co');
    expect((await pull(again)).changes).toEqual([]);
  });

  it('DELETE /me/data does not touch other users', async () => {
    const a = await login('a@x.co');
    const b = await login('b@x.co');
    await batch(b, [verseOp('bm-1', 1, 1)]);
    await call('DELETE', '/me/data', { cookie: a });
    expect((await pull(b)).changes).toHaveLength(1);
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After on auth endpoints after 10/min', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.9' };
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await call('POST', '/auth/dev-login', { body: { email: `u${i}@x.co` }, headers });
      if (i < 10) expect(last.status).toBe(200);
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await json(last!)).error.code).toBe('rate_limited');
  });

  it('limits a session to 120 requests per minute', async () => {
    const cookie = await login('a@x.co');
    let status = 0;
    for (let i = 0; i < 121; i++) {
      status = (await call('GET', '/me', { cookie })).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
    // another user is unaffected
    const b = await login('b@x.co');
    expect((await call('GET', '/me', { cookie: b })).status).toBe(200);
  });
});

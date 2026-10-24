import { Hono } from 'hono';
import {
  type AppBindings,
  type Ctx,
  ApiError,
  buildCookie,
  isLocalHttp,
  readCookie,
  readJsonBody,
} from './http';
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  type FetchFn,
  createJwksCache,
  verifyGoogleIdToken,
} from './google';
import { DIAG_MAX_BODY, DIAG_PER_HOUR, parseDiag } from './diag';
import { FEEDBACK_MAX_BODY, FEEDBACK_PER_DAY, FEEDBACK_PER_HOUR, buildIssue, parseFeedback } from './feedback';
import {
  OAUTH_STATE_TTL_MS,
  SESSION_TOUCH_MS,
  SESSION_TTL_MS,
  rateLimit,
  windowCount,
  windowHit,
} from './housekeeping';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  SyncBusyError,
  applyBatch,
  bookmarkChange,
  marksChange,
  readDayChange,
  roundChange,
  folderChange,
  getRevision,
  positionChange,
  prefsChange,
  pullChanges,
} from './sync';
import {
  isRecord,
  randomToken,
  sanitizeReturnPath,
  sha256Base64Url,
  sha256Hex,
  withSyncParam,
} from './util';
import { MAX_OPS, parseEmail } from './validate';
import { parseSurahParam, tafsirAllowed, tafsirKey } from './tafsir';
import { leaveAllGroups, registerGroups } from './groups';
import { USAGE_PER_HOUR, dayMinus, inList, jakartaDay, parseUsage } from './usage';

const API = '/api/v1';
const SESSION_COOKIE = 'mf_session';
const OAUTH_COOKIE = 'mf_oauth';
const LIMIT_SESSION_PER_MIN = 120;
const LIMIT_ANON_PER_MIN = 60;
const LIMIT_AUTH_PER_MIN = 10;

export interface Deps {
  fetch: FetchFn;
  now: () => number;
}

export function createApp(overrides: Partial<Deps> = {}): Hono<AppBindings> {
  const deps: Deps = {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? (() => Date.now()),
  };
  const jwks = createJwksCache();
  const app = new Hono<AppBindings>().basePath(API);

  // ---- security headers (every response, including errors) ----
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  });

  // ---- same-origin / CSRF ----
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin !== undefined && origin !== c.env.APP_ORIGIN) {
      throw new ApiError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.');
    }
    const m = c.req.method;
    if (m !== 'GET' && m !== 'HEAD' && c.req.header('X-Mushaf-Client') !== '1') {
      throw new ApiError(403, 'csrf', 'Missing X-Mushaf-Client header.');
    }
    await next();
  });

  // ---- session resolution (read-only unless the sliding window needs a touch) ----
  app.use('*', async (c, next) => {
    c.set('auth', null);
    if (c.req.path === `${API}/health`) return next();
    const token = readCookie(c.req.header('Cookie'), SESSION_COOKIE);
    if (token && token.length <= 128) {
      const sid = await sha256Hex(token);
      const now = deps.now();
      const row = await c.env.DB.prepare(
        `SELECT s.last_seen_at, u.id AS user_id, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?1 AND s.expires_at > ?2 AND u.deleted_at IS NULL`,
      )
        .bind(sid, now)
        .first<{ last_seen_at: number; user_id: string; email: string | null; name: string | null }>();
      if (row) {
        c.set('auth', { userId: row.user_id, sessionId: sid, email: row.email, name: row.name });
        if (now - row.last_seen_at > SESSION_TOUCH_MS) {
          await c.env.DB.prepare('UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE id = ?3')
            .bind(now, now + SESSION_TTL_MS, sid)
            .run();
          setSessionCookie(c, token);
        }
      }
    }
    await next();
  });

  // ---- rate limiting ----
  app.use('*', async (c, next) => {
    if (c.req.path === `${API}/health`) return next();
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const auth = c.get('auth');
    let key: string;
    let limit: number;
    if (c.req.path.startsWith(`${API}/auth/`)) {
      key = `auth:${ip}`;
      limit = LIMIT_AUTH_PER_MIN;
    } else if (auth) {
      key = `s:${auth.sessionId}`;
      limit = LIMIT_SESSION_PER_MIN;
    } else {
      key = `ip:${ip}`;
      limit = LIMIT_ANON_PER_MIN;
    }
    const r = await rateLimit(c.env.DB, key, limit, deps.now());
    if (!r.allowed) {
      throw new ApiError(429, 'rate_limited', 'Too many requests.', { 'Retry-After': String(r.retryAfter) });
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { success: false, error: { code: err.code, message: err.message } },
        err.status,
        err.headers,
      );
    }
    if (err instanceof SyncBusyError) {
      return c.json(
        { success: false, error: { code: 'busy', message: 'Concurrent update, please retry.' } },
        503,
        { 'Retry-After': '1' },
      );
    }
    // Never leak internals; log only the error class for operators.
    console.error('unhandled', err instanceof Error ? err.name : 'unknown');
    return c.json({ success: false, error: { code: 'internal_error', message: 'Internal error.' } }, 500);
  });
  app.notFound((c) => c.json({ success: false, error: { code: 'not_found', message: 'Not found.' } }, 404));

  const requireAuth = (c: Ctx) => {
    const auth = c.get('auth');
    if (!auth) throw new ApiError(401, 'unauthenticated', 'Login required.');
    return auth;
  };
  const ok = <T,>(c: Ctx, data: T) => c.json({ success: true as const, data });

  // ---- health / me ----
  app.get('/health', (c) => ok(c, { ok: true }));

  app.get('/me', (c) => {
    const a = c.get('auth');
    return ok(c, { user: a ? { id: a.userId, email: a.email, name: a.name } : null });
  });

  // ---- Google OIDC ----
  app.get('/auth/google/start', async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID;
    if (!clientId || !c.env.GOOGLE_CLIENT_SECRET) {
      throw new ApiError(503, 'auth_unavailable', 'Google login is not configured.');
    }
    const returnTo = sanitizeReturnPath(c.req.query('return'));
    const state = randomToken(24);
    const verifier = randomToken(32);
    const nonce = randomToken(16);
    const challenge = await sha256Base64Url(verifier);
    const now = deps.now();
    await c.env.DB.prepare(
      'INSERT INTO oauth_states (state, code_verifier, nonce, return_to, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind(state, verifier, nonce, returnTo, now + OAUTH_STATE_TTL_MS)
      .run();

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri(c));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    // Binds the flow to this browser (defends against login CSRF / session fixation).
    c.header(
      'Set-Cookie',
      buildCookie(OAUTH_COOKIE, state, {
        maxAge: OAUTH_STATE_TTL_MS / 1000,
        path: `${API}/auth`,
        secure: !isLocalHttp(new URL(c.req.url)),
      }),
      { append: true },
    );
    return c.redirect(url.toString(), 302);
  });

  app.get('/auth/google/callback', async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID;
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new ApiError(503, 'auth_unavailable', 'Google login is not configured.');
    const state = c.req.query('state') ?? '';
    const cookieState = readCookie(c.req.header('Cookie'), OAUTH_COOKIE);
    const now = deps.now();
    c.header(
      'Set-Cookie',
      buildCookie(OAUTH_COOKIE, '', { maxAge: 0, path: `${API}/auth`, secure: !isLocalHttp(new URL(c.req.url)) }),
      { append: true },
    );
    if (!state || state.length > 128) throw new ApiError(400, 'invalid_state', 'Invalid login state.');
    // Consume the state exactly once, whatever happens next.
    const row = await c.env.DB.prepare(
      'DELETE FROM oauth_states WHERE state = ?1 RETURNING code_verifier, nonce, return_to, expires_at',
    )
      .bind(state)
      .first<{ code_verifier: string; nonce: string; return_to: string; expires_at: number }>();
    if (!row || row.expires_at < now || cookieState !== state) {
      throw new ApiError(400, 'invalid_state', 'Invalid or expired login state.');
    }
    const returnTo = sanitizeReturnPath(row.return_to);
    const code = c.req.query('code');
    if (c.req.query('error') || !code || code.length > 2048) {
      return c.redirect(withSyncParam(returnTo, c.req.query('error') === 'access_denied' ? 'denied' : 'error'), 302);
    }
    try {
      const tokenRes = await deps.fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri(c),
          grant_type: 'authorization_code',
          code_verifier: row.code_verifier,
        }).toString(),
      });
      if (!tokenRes.ok) throw new Error('token_exchange_failed');
      const tokenBody: unknown = await tokenRes.json();
      const idToken = isRecord(tokenBody) ? tokenBody['id_token'] : undefined;
      if (typeof idToken !== 'string') throw new Error('no_id_token');
      const identity = await verifyGoogleIdToken(idToken, {
        clientId,
        nonce: row.nonce,
        now,
        fetchFn: deps.fetch,
        jwks,
      });
      const userId = await upsertUser(c.env.DB, 'google', identity.sub, identity.email, identity.name, now);
      const token = await createSession(c.env.DB, userId, now);
      setSessionCookie(c, token);
      return c.redirect(withSyncParam(returnTo, 'connected'), 302);
    } catch {
      return c.redirect(withSyncParam(returnTo, 'error'), 302);
    }
  });

  app.post('/auth/dev-login', async (c) => {
    if (c.env.DEV_AUTH !== '1') throw new ApiError(404, 'not_found', 'Not found.');
    const body = await readJsonBody(c);
    const email = isRecord(body) ? parseEmail(body['email']) : null;
    if (!email) throw new ApiError(400, 'validation_error', 'A valid email is required.');
    const now = deps.now();
    const userId = await upsertUser(c.env.DB, 'dev', email, email, email.split('@')[0] ?? null, now);
    setSessionCookie(c, await createSession(c.env.DB, userId, now));
    return ok(c, { user: { id: userId, email, name: email.split('@')[0] ?? null } });
  });

  app.post('/auth/logout', async (c) => {
    const a = c.get('auth');
    if (a) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(a.sessionId).run();
    clearSessionCookie(c);
    return ok(c, { loggedOut: true });
  });

  // ---- sync ----
  app.get('/sync', async (c) => {
    const auth = requireAuth(c);
    const cursor = parseUint(c.req.query('cursor'), 0);
    const limit = Math.min(Math.max(parseUint(c.req.query('limit'), DEFAULT_PAGE_LIMIT), 1), MAX_PAGE_LIMIT);
    return ok(c, await pullChanges(c.env.DB, auth.userId, cursor, limit));
  });

  app.post('/sync/batch', async (c) => {
    const auth = requireAuth(c);
    const body = await readJsonBody(c);
    const ops = isRecord(body) ? body['ops'] : undefined;
    if (!Array.isArray(ops)) throw new ApiError(400, 'validation_error', '"ops" must be an array.');
    if (ops.length > MAX_OPS) throw new ApiError(400, 'too_many_ops', `At most ${MAX_OPS} operations per batch.`);
    return ok(c, await applyBatch(c.env.DB, auth.userId, ops as unknown[], deps.now()));
  });

  // ---- feedback -> GitHub issue (anonymous allowed) ----
  // ---- private tafsir (allow-listed accounts only) ----
  app.get('/tafsir/access', (c) => {
    const a = c.get('auth');
    return ok(c, { allowed: !!c.env.TAFSIR && tafsirAllowed(c.env.TAFSIR_EMAILS, a?.email) });
  });

  app.get('/tafsir/ik/:surah', async (c) => {
    const a = requireAuth(c);
    if (!c.env.TAFSIR || !tafsirAllowed(c.env.TAFSIR_EMAILS, a.email)) {
      throw new ApiError(403, 'forbidden', 'Not available for this account.');
    }
    const surah = parseSurahParam(c.req.param('surah'));
    if (!surah) throw new ApiError(404, 'not_found', 'Not found.');
    const obj = await c.env.TAFSIR.get(tafsirKey(surah));
    if (!obj) throw new ApiError(404, 'not_found', 'Not found.');
    return new Response(obj.body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });

  app.post('/feedback', async (c) => {
    const body = await readJsonBody(c, FEEDBACK_MAX_BODY);
    // Honeypot: bots fill hidden fields. Pretend success, create nothing, count nothing.
    if (isRecord(body) && body['website'] !== undefined && body['website'] !== null && body['website'] !== '') {
      return ok(c, { issueNumber: 0, issueUrl: `https://github.com/${c.env.GITHUB_REPO ?? ''}/issues` });
    }
    const parsed = parseFeedback(body);
    if (!parsed.ok) throw new ApiError(400, 'invalid_input', parsed.error);

    const token = c.env.GITHUB_TOKEN;
    const repo = c.env.GITHUB_REPO;
    if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new ApiError(503, 'feedback_unavailable', 'Layanan masukan belum tersedia.');
    }

    const now = deps.now();
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const hour = await windowCount(c.env.DB, `fb:h:${ip}`, HOUR, now);
    const day = await windowCount(c.env.DB, `fb:d:${ip}`, DAY, now);
    if (hour.count >= FEEDBACK_PER_HOUR || day.count >= FEEDBACK_PER_DAY) {
      const retry = hour.count >= FEEDBACK_PER_HOUR ? hour.retryAfter : day.retryAfter;
      throw new ApiError(429, 'rate_limited', 'Terlalu banyak kiriman, coba lagi nanti.', {
        'Retry-After': String(retry),
      });
    }
    await windowHit(c.env.DB, `fb:h:${ip}`, HOUR, now);
    await windowHit(c.env.DB, `fb:d:${ip}`, DAY, now);

    const issue = buildIssue(parsed.value);
    let created: { number: number; url: string } | null = null;
    try {
      const res = await deps.fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'mushaf-digital-feedback',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(issue),
      });
      if (res.status === 201) {
        const j: unknown = await res.json();
        if (isRecord(j) && typeof j['number'] === 'number' && typeof j['html_url'] === 'string') {
          created = { number: j['number'], url: j['html_url'] };
        }
      } else {
        console.error('github_status', res.status);
      }
    } catch {
      console.error('github_unreachable');
    }
    if (!created) throw new ApiError(502, 'github_error', 'Layanan masukan sedang tidak tersedia.');

    const day0 = new Date(now).toISOString().slice(0, 10);
    const ipHash = (await sha256Hex(`${ip}|${day0}`)).slice(0, 32);
    await c.env.DB.prepare(
      'INSERT INTO feedback (id, created_at, category, issue_number, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind(crypto.randomUUID(), now, parsed.value.category, created.number, ipHash)
      .run();
    return ok(c, { issueNumber: created.number, issueUrl: created.url });
  });

  // ---- automatic client error reports (anonymous allowed; owner reads them in D1) ----
  app.post('/diag', async (c) => {
    const now = deps.now();
    const parsed = parseDiag(await readJsonBody(c, DIAG_MAX_BODY), now);
    if (!parsed.ok) throw new ApiError(400, 'invalid_input', parsed.error);
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const HOUR = 60 * 60 * 1000;
    const hour = await windowCount(c.env.DB, `diag:${ip}`, HOUR, now);
    if (hour.count >= DIAG_PER_HOUR) {
      throw new ApiError(429, 'rate_limited', 'Too many reports.', { 'Retry-After': String(hour.retryAfter) });
    }
    await windowHit(c.env.DB, `diag:${ip}`, HOUR, now);
    const d = parsed.value;
    const userId = c.get('auth')?.userId ?? null;
    const stmt = c.env.DB.prepare(
      `INSERT INTO client_errors
         (created_at, occurred_at, device_id, user_id, app_version, standalone, platform, op, name, message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    );
    const standalone = d.standalone === null ? null : d.standalone ? 1 : 0;
    await c.env.DB.batch(
      d.entries.map((e) =>
        stmt.bind(now, e.at, d.deviceId, userId, d.appVersion, standalone, d.platform, e.op, e.name, e.message),
      ),
    );
    return ok(c, { stored: d.entries.length });
  });

  // ---- anonymous usage (one row per device per day) and the owner's dashboard ----
  app.post('/usage', async (c) => {
    const now = deps.now();
    const p = parseUsage(await readJsonBody(c, 2048));
    if (!p) throw new ApiError(400, 'invalid_input', 'Data tidak valid.');
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const HOUR = 60 * 60 * 1000;
    const hour = await windowCount(c.env.DB, `usage:${ip}`, HOUR, now);
    if (hour.count >= USAGE_PER_HOUR) {
      throw new ApiError(429, 'rate_limited', 'Too many requests.', { 'Retry-After': String(hour.retryAfter) });
    }
    await windowHit(c.env.DB, `usage:${ip}`, HOUR, now);
    // Salted so the stored value cannot be matched to the device id kept elsewhere (errors, sync).
    const device = (await sha256Hex(`usage:v1:${p.deviceId}`)).slice(0, 24);
    await c.env.DB.prepare(
      `INSERT INTO usage_days (day, device, standalone, signed_in, app_version) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (day, device) DO UPDATE SET standalone = MAX(standalone, excluded.standalone),
         signed_in = MAX(signed_in, excluded.signed_in), app_version = excluded.app_version`,
    )
      .bind(jakartaDay(now), device, p.standalone ? 1 : 0, c.get('auth') ? 1 : 0, p.appVersion)
      .run();
    return ok(c, { ok: true });
  });

  app.get('/stats/access', (c) => ok(c, { allowed: inList(c.env.ADMIN_EMAILS, c.get('auth')?.email) }));

  app.get('/stats', async (c) => {
    const a = requireAuth(c);
    if (!inList(c.env.ADMIN_EMAILS, a.email)) throw new ApiError(403, 'forbidden', 'Not available for this account.');
    const now = deps.now();
    const db = c.env.DB;
    const [days, wau, mau, total, ver, users, khatam] = await db.batch([
      db
        .prepare(
          `SELECT day, COUNT(*) AS active, SUM(standalone) AS installed, SUM(signed_in) AS signed_in
           FROM usage_days WHERE day >= ?1 GROUP BY day ORDER BY day`,
        )
        .bind(dayMinus(now, 89)),
      db.prepare('SELECT COUNT(DISTINCT device) AS n FROM usage_days WHERE day >= ?1').bind(dayMinus(now, 6)),
      db.prepare('SELECT COUNT(DISTINCT device) AS n FROM usage_days WHERE day >= ?1').bind(dayMinus(now, 29)),
      db.prepare('SELECT COUNT(DISTINCT device) AS n FROM usage_days'),
      db
        .prepare(
          `SELECT app_version AS version, COUNT(*) AS n FROM usage_days WHERE day >= ?1
           GROUP BY app_version ORDER BY n DESC LIMIT 8`,
        )
        .bind(dayMinus(now, 6)),
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL'),
      db.prepare('SELECT COUNT(*) AS n FROM khatam_rounds WHERE deleted_at IS NULL AND finished_at IS NOT NULL'),
    ]);
    const n = (r: D1Result | undefined) => Number((r?.results?.[0] as { n?: number } | undefined)?.n ?? 0);
    return ok(c, {
      today: jakartaDay(now),
      days: days?.results ?? [],
      wau: n(wau),
      mau: n(mau),
      totalDevices: n(total),
      versions: ver?.results ?? [],
      accounts: n(users),
      khatamFinished: n(khatam),
    });
  });

  // ---- khatam bersama (groups) ----
  registerGroups(app, { requireAuth, ok, now: deps.now });

  // ---- export / delete ----
  app.get('/export', async (c) => {
    const auth = requireAuth(c);
    const db = c.env.DB;
    const [user, bm, pos, pref, rev, fol, rd, kr, mk] = await db.batch([
      db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?1').bind(auth.userId),
      db.prepare('SELECT * FROM bookmarks WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(auth.userId),
      db.prepare('SELECT * FROM reading_progress WHERE user_id = ?1').bind(auth.userId),
      db.prepare('SELECT payload, rev FROM preferences WHERE user_id = ?1').bind(auth.userId),
      db.prepare('SELECT revision FROM user_revisions WHERE user_id = ?1').bind(auth.userId),
      db.prepare('SELECT * FROM folders WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY rev').bind(auth.userId),
      db.prepare('SELECT * FROM reading_days WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY day').bind(auth.userId),
      db.prepare('SELECT * FROM khatam_rounds WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY n').bind(auth.userId),
      db.prepare("SELECT * FROM read_marks WHERE user_id = ?1 AND marks != '{}'").bind(auth.userId),
    ]);
    const u = user?.results[0] as { id: string; email: string | null; name: string | null; created_at: number } | undefined;
    const bmChanges = ((bm?.results ?? []) as Parameters<typeof bookmarkChange>[0][]).map(bookmarkChange);
    const folChanges = ((fol?.results ?? []) as Parameters<typeof folderChange>[0][]).map(folderChange);
    const posChanges = ((pos?.results ?? []) as Parameters<typeof positionChange>[0][]).map(positionChange);
    const prefChanges = ((pref?.results ?? []) as Parameters<typeof prefsChange>[0][]).map(prefsChange);
    const dayChanges = ((rd?.results ?? []) as Parameters<typeof readDayChange>[0][]).map(readDayChange);
    const roundChanges = ((kr?.results ?? []) as Parameters<typeof roundChange>[0][]).map(roundChange);
    const markChanges = ((mk?.results ?? []) as Parameters<typeof marksChange>[0][]).map(marksChange);
    return ok(c, {
      exportedAt: new Date(deps.now()).toISOString(),
      account: u ? { id: u.id, email: u.email, name: u.name, createdAt: u.created_at } : null,
      revision: (rev?.results[0] as { revision: number } | undefined)?.revision ?? 0,
      bookmarks: bmChanges.map((x) => ({ id: x.id, rev: x.rev, ...x.data })),
      folders: folChanges.map((x) => ({ id: x.id, rev: x.rev, ...x.data })),
      positions: posChanges.map((x) => ({ rev: x.rev, ...x.data })),
      readMarks: markChanges[0] ? { rev: markChanges[0].rev, ...markChanges[0].data } : null,
      readingDays: dayChanges.map((x) => ({ rev: x.rev, ...x.data })),
      khatamRounds: roundChanges.map((x) => ({ id: x.id, rev: x.rev, ...x.data })),
      preferences: prefChanges[0] ? { rev: prefChanges[0].rev, ...prefChanges[0].data } : null,
    });
  });

  app.delete('/me/data', async (c) => {
    const auth = requireAuth(c);
    const db = c.env.DB;
    const id = auth.userId;
    await leaveAllGroups(db, id, deps.now());
    await db.batch([
      db.prepare('DELETE FROM op_log WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM bookmarks WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM folders WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM reading_progress WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM read_marks WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM reading_days WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM khatam_rounds WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM preferences WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM client_errors WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM user_revisions WHERE user_id = ?1').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?1').bind(id),
    ]);
    clearSessionCookie(c);
    return ok(c, { deleted: true });
  });

  return app;
}

// --------------------------------------------------------------------------------------------

function redirectUri(c: Ctx): string {
  return `${c.env.APP_ORIGIN}${API}/auth/google/callback`;
}

function parseUint(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,15}$/.test(raw)) throw new ApiError(400, 'validation_error', 'Invalid numeric parameter.');
  return Number(raw);
}

function setSessionCookie(c: Ctx, token: string): void {
  c.header(
    'Set-Cookie',
    buildCookie(SESSION_COOKIE, token, {
      maxAge: SESSION_TTL_MS / 1000,
      path: '/api',
      secure: !isLocalHttp(new URL(c.req.url)),
    }),
    { append: true },
  );
}

function clearSessionCookie(c: Ctx): void {
  c.header(
    'Set-Cookie',
    buildCookie(SESSION_COOKIE, '', { maxAge: 0, path: '/api', secure: !isLocalHttp(new URL(c.req.url)) }),
    { append: true },
  );
}

async function createSession(db: D1Database, userId: string, now: number): Promise<string> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?3)')
    .bind(id, userId, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

async function upsertUser(
  db: D1Database,
  provider: 'google' | 'dev',
  subject: string,
  email: string | null,
  name: string | null,
  now: number,
): Promise<string> {
  const existing = await db
    .prepare('SELECT id FROM users WHERE auth_provider = ?1 AND auth_subject = ?2 AND deleted_at IS NULL')
    .bind(provider, subject)
    .first<{ id: string }>();
  if (existing) {
    await db.prepare('UPDATE users SET email = ?2, name = ?3 WHERE id = ?1').bind(existing.id, email, name).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO users (id, auth_provider, auth_subject, email, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(id, provider, subject, email, name, now),
    db.prepare('INSERT INTO user_revisions (user_id) VALUES (?1)').bind(id),
  ]);
  return id;
}

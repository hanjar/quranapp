import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { json, makeClient } from './helpers';

interface Captured {
  url: string;
  init: RequestInit;
  payload: { title: string; body: string; labels: string[] };
}

function mockGithub(status = 201) {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: async (input: string, init?: RequestInit) => {
      calls.push({ url: input, init: init ?? {}, payload: JSON.parse(String(init?.body ?? '{}')) });
      if (status !== 201) return new Response('boom', { status });
      return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/owner/repo/issues/42' }), { status: 201 });
    },
  };
}

const IP = { 'CF-Connecting-IP': '203.0.113.50' };
const ctx = {
  appVersion: '1.2.3',
  build: 'abc123',
  page: 12,
  path: '/halaman/12',
  userAgent: 'Mozilla/5.0 Test | `x`',
  paperTheme: 'ivory',
  uiTheme: 'segar',
  layout: 'auto',
  online: true,
  standalone: false,
};
const valid = { category: 'bug', message: 'Tombol bagikan tidak berfungsi di halaman ini.', context: ctx, website: '' };

function setup(status = 201) {
  const gh = mockGithub(status);
  const c = makeClient({ fetch: gh.fetch });
  const send = (body: unknown, extra: Record<string, string> = {}, envOverride?: Record<string, unknown>) =>
    c.call('POST', '/feedback', { body, headers: { ...IP, ...extra }, envOverride });
  return { gh, c, send };
}

describe('POST /feedback', () => {
  it('creates a GitHub issue with exact title, labels and a clean body', async () => {
    const { gh, send } = setup();
    const res = await send(valid, { Cookie: 'mf_session=whatever' });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ issueNumber: 42, issueUrl: 'https://github.com/owner/repo/issues/42' });
    expect(gh.calls).toHaveLength(1);
    const call = gh.calls[0]!;
    expect(call.url).toBe('https://api.github.com/repos/owner/repo/issues');
    const h = call.init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer ghp_testtoken');
    expect(h['Accept']).toBe('application/vnd.github+json');
    expect(h['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(h['User-Agent']).toBe('mushaf-digital-feedback');
    expect(call.payload.title).toBe('[Bug] Tombol bagikan tidak berfungsi di halaman ini.');
    expect(call.payload.labels).toEqual(['feedback', 'feedback:bug']);
    expect(call.payload.body).toBe(
      [
        '> Tombol bagikan tidak berfungsi di halaman ini.',
        '',
        '### Konteks',
        '',
        '| Info | Nilai |',
        '|---|---|',
        '| Versi | 1.2.3 |',
        '| Build | abc123 |',
        '| Halaman | 12 |',
        '| Path | /halaman/12 |',
        "| Browser | Mozilla/5.0 Test \\| 'x' |",
        '| Tema kertas | ivory |',
        '| Tema UI | segar |',
        '| Tata letak | auto |',
        '| Online | true |',
        '| Terpasang (PWA) | false |',
        '',
        '_Dikirim dari aplikasi Mushaf Digital_',
      ].join('\n'),
    );
    const all = JSON.stringify(call.payload);
    expect(all).not.toContain('203.0.113.50');
    expect(all).not.toContain('mf_session');
  });

  it('title uses the category name and truncates to ~60 chars single-line', async () => {
    const { gh, send } = setup();
    await send({ category: 'konten', message: `Koreksi\n\n${'a'.repeat(100)}`, context: null });
    expect(gh.calls[0]!.payload.title).toBe(`[Koreksi konten] Koreksi ${'a'.repeat(52)}...`);
    expect(gh.calls[0]!.payload.labels).toEqual(['feedback', 'feedback:konten']);
    expect(gh.calls[0]!.payload.body).not.toContain('Konteks');
  });

  it('neutralises mentions, issue refs and HTML; collapses blank lines', async () => {
    const { gh, send } = setup();
    await send({
      category: 'saran',
      message: 'Halo @octocat dan @org/team lihat #12 <img src=x onerror=alert(1)> <script>x</script>\n\n\n\n\n\nakhir',
      context: { ...ctx, userAgent: '<b>@evil</b>' },
    });
    const { title, body } = gh.calls[0]!.payload;
    for (const t of [title, body]) {
      expect(t).not.toMatch(/@(?!​)/);
      expect(t).not.toContain('<');
      expect(t).not.toMatch(/#(?=\d)/);
    }
    expect(body).toContain('@​octocat');
    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toMatch(/\n{4,}/);
  });

  it('honeypot returns 200 without calling GitHub or counting', async () => {
    const { gh, send } = setup();
    const res = await send({ ...valid, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(gh.calls).toHaveLength(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE 'fb:%'").first<{ n: number }>())!.n).toBe(0);
  });

  it('validates category, message length and context fields', async () => {
    const { gh, send } = setup();
    const cases: unknown[] = [
      { ...valid, category: 'spam' },
      { ...valid, category: undefined },
      { ...valid, message: 'a'.repeat(9) },
      { ...valid, message: `   ${'a'.repeat(9)}   ` },
      { ...valid, message: 'a'.repeat(2001) },
      { ...valid, message: 42 },
      { ...valid, context: 'x' },
      { ...valid, context: { ...ctx, appVersion: 'v'.repeat(21) } },
      { ...valid, context: { ...ctx, path: 'p'.repeat(101) } },
      { ...valid, context: { ...ctx, userAgent: 'u'.repeat(201) } },
      { ...valid, context: { ...ctx, page: 605 } },
      { ...valid, context: { ...ctx, page: 0 } },
      { ...valid, context: { ...ctx, online: 'yes' } },
      [],
    ];
    for (const body of cases) {
      const res = await send(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect((await json(res)).error.code).toBe('invalid_input');
    }
    expect(gh.calls).toHaveLength(0);
    // boundaries accepted
    expect((await send({ ...valid, message: 'a'.repeat(10), context: { ...ctx, page: null } })).status).toBe(200);
    expect((await send({ ...valid, message: 'a'.repeat(2000), context: null })).status).toBe(200);
  });

  it('rejects bodies over 16 KB with 413', async () => {
    const { gh, send } = setup();
    const res = await send({ ...valid, pad: 'x'.repeat(17 * 1024) });
    expect(res.status).toBe(413);
    expect(gh.calls).toHaveLength(0);
  });

  it('enforces CSRF header and Origin', async () => {
    const { c, gh } = setup();
    expect((await c.call('POST', '/feedback', { body: valid, csrf: false })).status).toBe(403);
    expect((await c.call('POST', '/feedback', { body: valid, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await c.call('POST', '/feedback', { body: valid, headers: { Origin: 'https://mushaf.test' } })).status).toBe(200);
    expect(gh.calls).toHaveLength(1);
  });

  it('allows 5 per hour per IP, the 6th is 429 with Retry-After; other IPs unaffected', async () => {
    const { gh, send } = setup();
    for (let i = 0; i < 5; i++) expect((await send(valid)).status).toBe(200);
    const res = await send(valid);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await json(res)).error.code).toBe('rate_limited');
    expect(gh.calls).toHaveLength(5);
    expect((await send(valid, { 'CF-Connecting-IP': '203.0.113.51' })).status).toBe(200);
  });

  it('caps at 20 per day across hours', async () => {
    let t = Date.UTC(2030, 0, 1, 0, 0, 0);
    const gh = mockGithub();
    const c = makeClient({ fetch: gh.fetch, now: () => t });
    let last = 0;
    for (let i = 0; i < 21; i++) {
      t = Date.UTC(2030, 0, 1, Math.floor(i / 5), i % 5, 0); // 5 per hour, 4+ hours
      last = (await c.call('POST', '/feedback', { body: valid, headers: IP })).status;
      if (i < 20) expect(last).toBe(200);
    }
    expect(last).toBe(429);
  });

  it('invalid submissions do not consume the quota', async () => {
    const { send } = setup();
    for (let i = 0; i < 10; i++) expect((await send({ ...valid, message: 'x' })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await send(valid)).status).toBe(200);
  });

  it('503 when GITHUB_TOKEN is missing', async () => {
    const { gh, send } = setup();
    const res = await send(valid, {}, { GITHUB_TOKEN: undefined });
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe('feedback_unavailable');
    expect(gh.calls).toHaveLength(0);
  });

  it('502 when GitHub fails (5xx or network error) and no audit row is written', async () => {
    const { send } = setup(500);
    const res = await send(valid);
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe('github_error');
    const c2 = makeClient({ fetch: async () => { throw new Error('net'); } });
    expect((await c2.call('POST', '/feedback', { body: valid, headers: IP })).status).toBe(502);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback').first<{ n: number }>())!.n).toBe(0);
  });

  it('writes an audit row without message text or raw IP', async () => {
    const { send } = setup();
    await send(valid);
    const rows = await env.DB.prepare('SELECT * FROM feedback').all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    const row = rows.results[0]!;
    expect(row['category']).toBe('bug');
    expect(row['issue_number']).toBe(42);
    expect(String(row['ip_hash'])).toMatch(/^[0-9a-f]{32}$/);
    const dump = JSON.stringify(row);
    expect(dump).not.toContain('Tombol');
    expect(dump).not.toContain('203.0.113.50');
  });

  it('works anonymously (no session needed) and never echoes the token', async () => {
    const { send } = setup();
    const res = await send(valid);
    expect(JSON.stringify(await json(res))).not.toContain('ghp_');
  });
});

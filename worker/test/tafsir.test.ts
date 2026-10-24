import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { parseSurahParam, tafsirAllowed } from '../src/tafsir';
import { json, makeClient } from './helpers';

describe('tafsir helpers', () => {
  it('allow-list is exact and case-insensitive', () => {
    expect(tafsirAllowed('a@x.com, Reader@Example.com', 'reader@example.com')).toBe(true);
    expect(tafsirAllowed('reader@example.com', 'other@example.com')).toBe(false);
    expect(tafsirAllowed('', 'reader@example.com')).toBe(false);
    expect(tafsirAllowed(undefined, 'reader@example.com')).toBe(false);
    expect(tafsirAllowed('reader@example.com', null)).toBe(false);
  });

  it('surah param is 1..114 digits only', () => {
    expect(parseSurahParam('1')).toBe(1);
    expect(parseSurahParam('114')).toBe(114);
    for (const bad of ['0', '115', '2a', '-1', '01x', '']) expect(parseSurahParam(bad)).toBeNull();
  });
});

describe('GET /tafsir', () => {
  const bucket = env.TAFSIR!;

  it('anonymous: access false, file 401', async () => {
    const c = makeClient();
    expect((await json(await c.call('GET', '/tafsir/access'))).data).toEqual({ allowed: false });
    expect((await c.call('GET', '/tafsir/ik/1')).status).toBe(401);
  });

  it('account not on the list: access false, file 403', async () => {
    const c = makeClient();
    const cookie = await c.login('someone@example.com');
    expect((await json(await c.call('GET', '/tafsir/access', { cookie }))).data).toEqual({ allowed: false });
    expect((await c.call('GET', '/tafsir/ik/1', { cookie })).status).toBe(403);
  });

  it('allowed account reads the file; unknown surah 404; no shared caching', async () => {
    await bucket.put('ibnu-katsir/112.json', JSON.stringify({ surah: 112, chunks: [] }));
    const c = makeClient();
    const cookie = await c.login('reader@example.com');
    expect((await json(await c.call('GET', '/tafsir/access', { cookie }))).data).toEqual({ allowed: true });
    const res = await c.call('GET', '/tafsir/ik/112', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ surah: 112, chunks: [] });
    expect((await c.call('GET', '/tafsir/ik/113', { cookie })).status).toBe(404);
    expect((await c.call('GET', '/tafsir/ik/999', { cookie })).status).toBe(404);
  });
});

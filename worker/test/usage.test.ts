import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { dayMinus, inList, jakartaDay, parseUsage } from '../src/usage';
import { json, makeClient } from './helpers';

describe('usage helpers', () => {
  it('uses the Jakarta calendar day', () => {
    expect(jakartaDay(Date.UTC(2026, 9, 23, 16, 59))).toBe('2026-10-23');
    expect(jakartaDay(Date.UTC(2026, 9, 23, 17, 0))).toBe('2026-10-24');
    expect(dayMinus(Date.UTC(2026, 9, 24, 0, 0), 1)).toBe('2026-10-23');
  });

  it('validates pings and lists', () => {
    expect(parseUsage({ deviceId: 'abcdefgh-1234', standalone: true, appVersion: '0.19.3' })).toEqual({
      deviceId: 'abcdefgh-1234',
      standalone: true,
      appVersion: '0.19.3',
    });
    expect(parseUsage({ deviceId: 'short' })).toBeNull();
    expect(parseUsage({ deviceId: 'abcdefgh', appVersion: 5 })).toBeNull();
    expect(inList('A@x.com, owner@example.com', 'Owner@Example.com')).toBe(true);
    expect(inList('', 'owner@example.com')).toBe(false);
  });
});

describe('POST /usage + GET /stats', () => {
  const IP = { 'CF-Connecting-IP': '203.0.113.77' };

  it('counts each device once per day, hashed; only admins read stats', async () => {
    const c = makeClient({ now: () => Date.UTC(2026, 9, 24, 3, 0) });
    for (const id of ['device-aaaa-1', 'device-aaaa-1', 'device-bbbb-2']) {
      const r = await c.call('POST', '/usage', {
        body: { deviceId: id, standalone: id.endsWith('2'), appVersion: '1.0.0' },
        headers: IP,
      });
      expect(r.status).toBe(200);
    }
    const rows = await env.DB.prepare('SELECT device, standalone FROM usage_days WHERE day = ?1')
      .bind('2026-10-24')
      .all();
    expect(rows.results).toHaveLength(2);
    expect(JSON.stringify(rows.results)).not.toContain('device-aaaa');

    expect((await c.call('GET', '/stats')).status).toBe(401);
    const other = await c.login('someone@example.com');
    expect((await c.call('GET', '/stats', { cookie: other })).status).toBe(403);
    expect((await json(await c.call('GET', '/stats/access', { cookie: other }))).data).toEqual({ allowed: false });

    const owner = await c.login('owner@example.com');
    expect((await json(await c.call('GET', '/stats/access', { cookie: owner }))).data).toEqual({ allowed: true });
    const s = (await json(await c.call('GET', '/stats', { cookie: owner }))).data;
    expect(s.today).toBe('2026-10-24');
    expect(s.days).toEqual([{ day: '2026-10-24', active: 2, installed: 1, signed_in: 0 }]);
    expect(s.wau).toBe(2);
    expect(s.mau).toBe(2);
  });

  it('rejects bad input', async () => {
    const c = makeClient();
    expect((await c.call('POST', '/usage', { body: { deviceId: 'x' }, headers: IP })).status).toBe(400);
  });
});

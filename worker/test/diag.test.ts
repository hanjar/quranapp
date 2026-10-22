import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { DIAG_PER_HOUR } from '../src/diag';
import { json, makeClient } from './helpers';

const entry = { op: 'bookmark-toggle', name: 'StorageUnavailableError', message: 'Tutup tab lain', at: Date.now() };
const body = { deviceId: 'dev-1', appVersion: '0.16.4', standalone: true, platform: 'Android', entries: [entry] };

function setup(ip: string) {
  const c = makeClient();
  return (b: unknown) => c.call('POST', '/diag', { body: b, headers: { 'CF-Connecting-IP': ip } });
}

describe('POST /diag', () => {
  it('stores each entry with device info', async () => {
    const send = setup('203.0.113.80');
    const res = await send({ ...body, entries: [entry, { ...entry, op: 'sync', name: 'TypeError' }] });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ stored: 2 });
    const rows = await env.DB.prepare("SELECT * FROM client_errors WHERE device_id = 'dev-1' ORDER BY id").all();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({ op: 'bookmark-toggle', standalone: 1, app_version: '0.16.4', user_id: null });
  });

  it('rejects malformed input', async () => {
    const send = setup('203.0.113.81');
    expect((await send({ ...body, entries: [] })).status).toBe(400);
    expect((await send({ ...body, entries: [{ ...entry, message: 'x'.repeat(301) }] })).status).toBe(400);
    expect((await send({ ...body, standalone: 'yes' })).status).toBe(400);
  });

  it('rate limits per IP per hour', async () => {
    const send = setup('203.0.113.82');
    for (let i = 0; i < DIAG_PER_HOUR; i++) expect((await send(body)).status).toBe(200);
    expect((await send(body)).status).toBe(429);
  });
});

import { SyncApiClient, SyncHttpError } from './sync-api-client';

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

describe('SyncApiClient', () => {
  const client = new SyncApiClient();
  afterEach(() => vi.unstubAllGlobals());

  it('sends credentials + client header and unwraps the envelope', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        res(200, { success: true, data: { user: { id: 'u1', email: 'a@b', name: 'A' } } }),
      );
    vi.stubGlobal('fetch', f);
    const user = await client.me();
    expect(user?.id).toBe('u1');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Mushaf-Client']).toBe('1');
  });

  it('posts JSON bodies', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(res(200, { success: true, data: { results: [], cursor: 3 } }));
    vi.stubGlobal('fetch', f);
    const r = await client.pushBatch([]);
    expect(r.cursor).toBe(3);
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"ops":[]}');
  });

  it('me() treats 401 as logged out', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          res(401, { success: false, error: { code: 'unauthorized', message: 'x' } }),
        ),
    );
    expect(await client.me()).toBeNull();
  });

  it('types errors: 401, 429 + Retry-After, 5xx, network, 4xx', async () => {
    const kind = async (r: Response | Error) => {
      vi.stubGlobal(
        'fetch',
        r instanceof Error ? vi.fn().mockRejectedValue(r) : vi.fn().mockResolvedValue(r),
      );
      try {
        await client.pull(0);
      } catch (e) {
        return e as SyncHttpError;
      }
      throw new Error('expected failure');
    };
    expect((await kind(res(401, {}))).kind).toBe('unauthorized');
    const rl = await kind(res(429, { success: false }, { 'Retry-After': '12' }));
    expect(rl.kind).toBe('rate-limited');
    expect(rl.retryAfterMs).toBe(12_000);
    expect((await kind(res(503, {}))).kind).toBe('server');
    expect((await kind(new TypeError('Failed to fetch'))).kind).toBe('network');
    const c = await kind(
      res(400, { success: false, error: { code: 'bad_request', message: 'x' } }),
    );
    expect(c.kind).toBe('client');
    expect(c.code).toBe('bad_request');
  });

  it('builds the OAuth start URL', () => {
    expect(client.startUrl('/hal/5')).toBe('/api/v1/auth/google/start?return=%2Fhal%2F5');
  });
});

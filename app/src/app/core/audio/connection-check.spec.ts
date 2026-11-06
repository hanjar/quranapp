import { audioProblemMessage, checkInternet } from './connection-check';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('checkInternet', () => {
  it('is offline without asking when the browser knows there is no network', async () => {
    const f = vi.fn();
    expect(await checkInternet(f as unknown as typeof fetch, 5000, false)).toBe('offline');
    expect(f).not.toHaveBeenCalled();
  });

  it('is ok when our server answers its health body', async () => {
    const f = vi.fn(() => json({ success: true, data: { ok: true } }));
    expect(await checkInternet(f as unknown as typeof fetch, 5000, true)).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/health\?t=\d+/);
    expect(init.cache).toBe('no-store');
  });

  it('blames the connection when the request fails', async () => {
    const f = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await checkInternet(f as unknown as typeof fetch, 5000, true)).toBe('no-internet');
  });

  it('blames the connection for an operator page instead of our JSON', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('<html>Kuota habis</html>')));
    expect(await checkInternet(f as unknown as typeof fetch, 5000, true)).toBe('no-internet');
  });

  it('blames the connection on an unexpected status', async () => {
    const f = vi.fn(() => json({ data: { ok: true } }, 302));
    expect(await checkInternet(f as unknown as typeof fetch, 5000, true)).toBe('no-internet');
  });

  it('gives up after the timeout', async () => {
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    expect(await checkInternet(f as unknown as typeof fetch, 10, true)).toBe('no-internet');
  });
});

describe('audioProblemMessage', () => {
  it('names the internet when the connection is the problem', () => {
    expect(audioProblemMessage('no-internet', 'error')).toContain('Koneksi internet bermasalah');
    expect(audioProblemMessage('offline', 'slow')).toContain('Tidak ada internet');
  });

  it('names the audio server when the internet works', () => {
    expect(audioProblemMessage('ok', 'error')).toContain('Server audio');
    expect(audioProblemMessage('ok', 'slow')).toContain('lambat');
  });
});

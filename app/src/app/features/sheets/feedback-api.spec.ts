import { describe, expect, it, vi } from 'vitest';
import {
  FeedbackError,
  buildContext,
  buildRequest,
  contextRows,
  mapError,
  messageLength,
  submitFeedback,
  validateMessage,
} from './feedback-api';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const req = buildRequest('bug', '  halaman tidak termuat  ', null);

describe('validation + helpers', () => {
  it('counts trimmed length and validates bounds', () => {
    expect(messageLength('  abc  ')).toBe(3);
    expect(validateMessage('pendek')).toMatch(/minimal 10/);
    expect(validateMessage('x'.repeat(10))).toBeNull();
    expect(validateMessage('x'.repeat(2000))).toBeNull();
    expect(validateMessage('x'.repeat(2001))).toMatch(/Maksimal 2000/);
    expect(validateMessage(' '.repeat(50))).not.toBeNull();
  });

  it('buildRequest trims and always sets an empty honeypot', () => {
    expect(req).toEqual({
      category: 'bug',
      message: 'halaman tidak termuat',
      context: null,
      website: '',
    });
  });

  it('buildContext applies limits and nulls invalid pages', () => {
    const c = buildContext({
      appVersion: 'v'.repeat(40),
      build: 'b'.repeat(40),
      page: 700,
      path: '/'.repeat(300),
      userAgent: 'u'.repeat(500),
      paperTheme: 'ivory',
      uiTheme: 'segar',
      layout: 'auto',
      online: true,
      standalone: false,
    });
    expect(c.appVersion).toHaveLength(20);
    expect(c.build).toHaveLength(20);
    expect(c.path).toHaveLength(100);
    expect(c.userAgent).toHaveLength(200);
    expect(c.page).toBeNull();
    expect(buildContext({ ...c, page: 604 }).page).toBe(604);
    expect(contextRows(c)).toHaveLength(10);
  });
});

describe('mapError', () => {
  it('maps statuses', () => {
    expect(mapError(429).kind).toBe('rate_limited');
    expect(mapError(503, 'feedback_unavailable').kind).toBe('unavailable');
    expect(mapError(502, 'github_error').kind).toBe('unavailable');
    expect(mapError(400, 'invalid_input').kind).toBe('invalid');
    expect(mapError(500).kind).toBe('network');
  });
});

describe('submitFeedback', () => {
  it('sends the right request shape', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        json(200, {
          success: true,
          data: { issueNumber: 7, issueUrl: 'https://github.com/x/y/issues/7' },
        }),
      );
    const r = await submitFeedback(req, {
      fetchFn: fetchFn as unknown as typeof fetch,
      online: true,
    });
    expect(r).toEqual({ issueNumber: 7, issueUrl: 'https://github.com/x/y/issues/7' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/v1/feedback');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Mushaf-Client']).toBe('1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      category: 'bug',
      message: 'halaman tidak termuat',
      context: null,
      website: '',
    });
  });

  it('forces the honeypot empty even if tampered', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json(200, { success: true, data: { issueNumber: 1, issueUrl: 'u' } }));
    await submitFeedback(
      { ...req, website: 'spam' as unknown as '' },
      { fetchFn: fetchFn as unknown as typeof fetch, online: true },
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).website).toBe('');
  });

  it.each([
    [429, 'rate_limited', 'rate_limited'],
    [503, 'feedback_unavailable', 'unavailable'],
    [502, 'github_error', 'unavailable'],
    [400, 'invalid_input', 'invalid'],
  ])('maps %i to %s', async (status, code, kind) => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json(status, { success: false, error: { code, message: 'x' } }));
    await expect(
      submitFeedback(req, { fetchFn: fetchFn as unknown as typeof fetch, online: true }),
    ).rejects.toMatchObject({ kind });
  });

  it('rejects as offline without fetching when offline', async () => {
    const fetchFn = vi.fn();
    await expect(
      submitFeedback(req, { fetchFn: fetchFn as unknown as typeof fetch, online: false }),
    ).rejects.toBeInstanceOf(FeedbackError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a network failure to offline', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('failed'));
    await expect(
      submitFeedback(req, { fetchFn: fetchFn as unknown as typeof fetch, online: true }),
    ).rejects.toMatchObject({ kind: 'offline' });
  });
});

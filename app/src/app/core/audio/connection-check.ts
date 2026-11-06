import { APP_CONFIG } from '../config';

/**
 * Why streaming stopped, told apart by asking a second, unrelated host (our own Worker).
 * - `offline`: the browser knows it has no network (airplane mode, data off).
 * - `no-internet`: our server is unreachable too, or answers with something else (an operator's
 *   "quota exhausted" page): the device's connection is the common factor.
 * - `ok`: our server answers, so the internet works and the audio host is the problem.
 * `navigator.onLine` stays true when the data package runs out, so only a real request tells.
 */
export type NetVerdict = 'offline' | 'no-internet' | 'ok';

export async function checkInternet(
  fetchFn: typeof fetch = (i, o) => fetch(i, o),
  timeoutMs = 5000,
  onLine: boolean = typeof navigator === 'undefined' || navigator.onLine !== false,
): Promise<NetVerdict> {
  if (!onLine) return 'offline';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Unique URL + no-store: never answered from the HTTP or service-worker cache.
    const r = await fetchFn(`${APP_CONFIG.apiBase}/health?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal,
    });
    if (!r.ok) return 'no-internet';
    const body = (await r.json()) as { data?: { ok?: unknown } } | null;
    return body?.data?.ok === true ? 'ok' : 'no-internet';
  } catch {
    return 'no-internet';
  } finally {
    clearTimeout(timer);
  }
}

/** Plain-language message for a failed (`error`) or stuck (`slow`) recitation. */
export function audioProblemMessage(verdict: NetVerdict, kind: 'error' | 'slow'): string {
  if (verdict === 'offline') return 'Tidak ada internet. Nyalakan data seluler atau Wi-Fi.';
  if (verdict === 'no-internet')
    return 'Koneksi internet bermasalah. Periksa paket data atau sinyal.';
  return kind === 'slow'
    ? 'Audio lambat dimuat. Coba lagi atau ganti qari.'
    : 'Server audio sedang gangguan. Coba lagi atau ganti qari.';
}

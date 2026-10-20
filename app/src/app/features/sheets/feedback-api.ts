import { APP_CONFIG } from '../../core/config';

export type FeedbackCategory = 'saran' | 'bug' | 'konten' | 'lainnya';

export const FEEDBACK_CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: 'saran', label: 'Saran' },
  { id: 'bug', label: 'Masalah (bug)' },
  { id: 'konten', label: 'Koreksi konten' },
  { id: 'lainnya', label: 'Lainnya' },
];

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

export interface FeedbackContext {
  appVersion: string;
  build: string;
  page: number | null;
  path: string;
  userAgent: string;
  paperTheme: string;
  uiTheme: string;
  layout: string;
  online: boolean;
  standalone: boolean;
}

export interface FeedbackRequest {
  category: FeedbackCategory;
  message: string;
  context: FeedbackContext | null;
  /** Honeypot: always empty. */
  website: '';
}

export interface FeedbackResult {
  issueNumber: number;
  issueUrl: string;
}

export type FeedbackErrorKind = 'offline' | 'invalid' | 'rate_limited' | 'unavailable' | 'network';

export class FeedbackError extends Error {
  constructor(
    readonly kind: FeedbackErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'FeedbackError';
  }
}

const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Trimmed length used for validation and the live counter. */
export function messageLength(message: string): number {
  return message.trim().length;
}

/** Returns an Indonesian error message, or null when the message is acceptable. */
export function validateMessage(message: string): string | null {
  const n = messageLength(message);
  if (n < MESSAGE_MIN) return `Tulis minimal ${MESSAGE_MIN} karakter.`;
  if (n > MESSAGE_MAX) return `Maksimal ${MESSAGE_MAX} karakter.`;
  return null;
}

export interface ContextInputs {
  appVersion: string;
  build: string;
  page: number | null;
  path: string;
  userAgent: string;
  paperTheme: string;
  uiTheme: string;
  layout: string;
  online: boolean;
  standalone: boolean;
}

/** Applies the API's length limits. Never includes IP, account or session data. */
export function buildContext(i: ContextInputs): FeedbackContext {
  const page = Number.isInteger(i.page) && i.page! >= 1 && i.page! <= 604 ? i.page : null;
  return {
    appVersion: trunc(i.appVersion, 20),
    build: trunc(i.build, 20),
    page,
    path: trunc(i.path, 100),
    userAgent: trunc(i.userAgent, 200),
    paperTheme: trunc(i.paperTheme, 20),
    uiTheme: trunc(i.uiTheme, 20),
    layout: trunc(i.layout, 20),
    online: i.online,
    standalone: i.standalone,
  };
}

/** Label/value pairs shown in the "Lihat yang dikirim" disclosure. */
export function contextRows(c: FeedbackContext): { label: string; value: string }[] {
  return [
    { label: 'Versi aplikasi', value: c.appVersion },
    { label: 'Build', value: c.build },
    { label: 'Halaman', value: c.page === null ? '-' : String(c.page) },
    { label: 'Alamat', value: c.path },
    { label: 'Peramban', value: c.userAgent },
    { label: 'Warna kertas', value: c.paperTheme },
    { label: 'Gaya antarmuka', value: c.uiTheme },
    { label: 'Tata letak', value: c.layout },
    { label: 'Daring', value: c.online ? 'ya' : 'tidak' },
    { label: 'Terpasang (PWA)', value: c.standalone ? 'ya' : 'tidak' },
  ];
}

export function buildRequest(
  category: FeedbackCategory,
  message: string,
  context: FeedbackContext | null,
): FeedbackRequest {
  return { category, message: message.trim(), context, website: '' };
}

/** Maps an HTTP status + envelope error code to a typed error with Indonesian copy. */
export function mapError(status: number, code?: string): FeedbackError {
  if (status === 429 || code === 'rate_limited') {
    return new FeedbackError('rate_limited', 'Terlalu banyak kiriman, coba lagi nanti.');
  }
  if (
    status === 502 ||
    status === 503 ||
    code === 'feedback_unavailable' ||
    code === 'github_error'
  ) {
    return new FeedbackError('unavailable', 'Layanan masukan sedang tidak tersedia.');
  }
  if (status === 400 || code === 'invalid_input') {
    return new FeedbackError('invalid', 'Masukan tidak valid. Periksa isi pesan lalu coba lagi.');
  }
  return new FeedbackError('network', 'Gagal mengirim masukan. Coba lagi nanti.');
}

export async function submitFeedback(
  req: FeedbackRequest,
  opts: { fetchFn?: typeof fetch; online?: boolean } = {},
): Promise<FeedbackResult> {
  const online = opts.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  if (!online) {
    throw new FeedbackError(
      'offline',
      'Anda sedang offline. Tulisan Anda tetap tersimpan; kirim saat tersambung.',
    );
  }
  const f = opts.fetchFn ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await f(`${APP_CONFIG.apiBase}/feedback`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Mushaf-Client': '1' },
      body: JSON.stringify({ ...req, website: '' }),
    });
  } catch {
    throw new FeedbackError(
      'offline',
      'Tidak dapat terhubung. Tulisan Anda tetap tersimpan; coba lagi nanti.',
    );
  }
  let body: {
    success?: boolean;
    data?: Partial<FeedbackResult>;
    error?: { code?: string };
  } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (
    res.ok &&
    body?.success &&
    typeof body.data?.issueNumber === 'number' &&
    typeof body.data.issueUrl === 'string'
  ) {
    return { issueNumber: body.data.issueNumber, issueUrl: body.data.issueUrl };
  }
  if (res.ok && body?.success) {
    // honeypot-style silent success: no issue created, nothing to link to.
    return { issueNumber: 0, issueUrl: '' };
  }
  throw mapError(res.status, body?.error?.code);
}

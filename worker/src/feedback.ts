import { isRecord } from './util';
import type { Result } from './validate';

export const FEEDBACK_MAX_BODY = 16 * 1024;
export const FEEDBACK_PER_HOUR = 5;
export const FEEDBACK_PER_DAY = 20;

export const CATEGORIES = ['saran', 'bug', 'konten', 'lainnya'] as const;
export type Category = (typeof CATEGORIES)[number];

const LABELS: Record<Category, string> = {
  saran: 'Saran',
  bug: 'Bug',
  konten: 'Koreksi konten',
  lainnya: 'Lainnya',
};

export interface FeedbackContext {
  appVersion: string | null;
  build: string | null;
  page: number | null;
  path: string | null;
  userAgent: string | null;
  paperTheme: string | null;
  uiTheme: string | null;
  layout: string | null;
  online: boolean | null;
  standalone: boolean | null;
}

export interface FeedbackInput {
  category: Category;
  message: string;
  context: FeedbackContext | null;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const STRING_FIELDS: [keyof FeedbackContext, number][] = [
  ['appVersion', 20],
  ['build', 20],
  ['path', 100],
  ['userAgent', 200],
  ['paperTheme', 20],
  ['uiTheme', 20],
  ['layout', 20],
];

export function parseFeedback(raw: unknown): Result<FeedbackInput> {
  if (!isRecord(raw)) return fail('Data tidak valid.');
  const category = CATEGORIES.find((c) => c === raw['category']);
  if (!category) return fail('Kategori tidak valid.');
  const message = typeof raw['message'] === 'string' ? raw['message'].trim() : '';
  if (message.length < 10) return fail('Pesan terlalu pendek (minimal 10 karakter).');
  if (message.length > 2000) return fail('Pesan terlalu panjang (maksimal 2000 karakter).');

  const c = raw['context'];
  if (c === null || c === undefined) return { ok: true, value: { category, message, context: null } };
  if (!isRecord(c)) return fail('Info teknis tidak valid.');
  const ctx: FeedbackContext = {
    appVersion: null,
    build: null,
    page: null,
    path: null,
    userAgent: null,
    paperTheme: null,
    uiTheme: null,
    layout: null,
    online: null,
    standalone: null,
  };
  for (const [key, max] of STRING_FIELDS) {
    const v = c[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length > max) return fail(`Info teknis tidak valid: ${key}.`);
    (ctx as unknown as Record<string, unknown>)[key] = v;
  }
  const page = c['page'];
  if (page !== undefined && page !== null) {
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 604) {
      return fail('Info teknis tidak valid: page.');
    }
    ctx.page = page;
  }
  for (const key of ['online', 'standalone'] as const) {
    const v = c[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'boolean') return fail(`Info teknis tidak valid: ${key}.`);
    ctx[key] = v;
  }
  return { ok: true, value: { category, message, context: ctx } };
}

const ZWSP = '\u200b';

/** Neutralises mentions, issue refs, HTML and control characters in user text. */
export function neutralize(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/@/g, `@${ZWSP}`)
      .replace(/#(?=\d)/g, `#${ZWSP}`)
      .replace(/\n{4,}/g, '\n\n\n')
  );
}

function cell(v: string | number | boolean | null): string {
  if (v === null) return '-';
  return neutralize(String(v)).replace(/\n/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
}

export function buildIssue(input: FeedbackInput): { title: string; body: string; labels: string[] } {
  const oneLine = input.message.replace(/\s+/g, ' ').trim();
  const snippet = oneLine.length > 60 ? `${oneLine.slice(0, 60).trimEnd()}...` : oneLine;
  const title = `[${LABELS[input.category]}] ${neutralize(snippet).replace(/\n/g, ' ')}`;

  const quote = neutralize(input.message)
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
  const parts = [quote];
  const c = input.context;
  if (c) {
    parts.push(
      [
        '### Konteks',
        '',
        '| Info | Nilai |',
        '|---|---|',
        `| Versi | ${cell(c.appVersion)} |`,
        `| Build | ${cell(c.build)} |`,
        `| Halaman | ${cell(c.page)} |`,
        `| Path | ${cell(c.path)} |`,
        `| Browser | ${cell(c.userAgent)} |`,
        `| Tema kertas | ${cell(c.paperTheme)} |`,
        `| Tema UI | ${cell(c.uiTheme)} |`,
        `| Tata letak | ${cell(c.layout)} |`,
        `| Online | ${cell(c.online)} |`,
        `| Terpasang (PWA) | ${cell(c.standalone)} |`,
      ].join('\n'),
    );
  }
  parts.push('_Dikirim dari aplikasi Mushaf Digital_');
  return {
    title,
    body: parts.join('\n\n'),
    labels: ['feedback', `feedback:${input.category}`],
  };
}

import { isDevMode } from '@angular/core';
import { BUILD_INFO } from '../build-info';
import { APP_CONFIG } from '../config';

/**
 * Sends storage and app errors to the Worker (`POST /diag`) so a failure on one device
 * can be diagnosed without the user copying messages. Only the error name, message,
 * operation, app version and browser are sent: never page content or bookmarks.
 * It can be switched off (Pengaturan › Kirim laporan galat otomatis); the choice follows the
 * account and is mirrored to the local key read here on every report (see synced-setting.ts).
 */
export interface ReportedError {
  op: string;
  name: string;
  message: string;
  at: number;
}

const KEY = 'mf-error-report';
const FLUSH_DELAY_MS = 5000;
const BATCH_MAX = 20;
/** Per page load: a crash loop must not flood the endpoint. */
const SESSION_MAX = 60;
/** The same op/name/message is sent at most once in this window. */
const REPEAT_MS = 10 * 60 * 1000;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let deviceId: string | null = null;
let queue: ReportedError[] = [];
let sent = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const lastSent = new Map<string, number>();

export function setErrorReportDevice(id: string): void {
  deviceId = id || null;
}

/** Off under `ng serve` and in tests; only production builds report. */
function active(): boolean {
  return !isDevMode() && APP_CONFIG.syncEnabled && readEnabled() && typeof fetch === 'function';
}

export function reportError(e: ReportedError): void {
  if (!active() || sent + queue.length >= SESSION_MAX) return;
  const key = `${e.op}|${e.name}|${e.message}`;
  const prev = lastSent.get(key);
  if (prev !== undefined && e.at - prev < REPEAT_MS) return;
  lastSent.set(key, e.at);
  queue.push(e);
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushErrorReports();
    });
  }
  if (queue.length >= BATCH_MAX) flushErrorReports();
  else timer ??= setTimeout(flushErrorReports, FLUSH_DELAY_MS);
}

export function flushErrorReports(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const entries = queue.slice(0, BATCH_MAX);
  queue = queue.slice(BATCH_MAX);
  sent += entries.length;
  const body = JSON.stringify({
    deviceId,
    appVersion: BUILD_INFO.version.slice(0, 20),
    standalone: typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)').matches : null,
    platform: typeof navigator !== 'undefined' ? navigator.userAgent.trim().slice(0, 120) : null,
    entries,
  });
  // keepalive lets the report leave while the app is being closed.
  void fetch(`${APP_CONFIG.apiBase}/diag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mushaf-Client': '1' },
    credentials: 'same-origin',
    keepalive: true,
    body,
  }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flushErrorReports, FLUSH_DELAY_MS);
}

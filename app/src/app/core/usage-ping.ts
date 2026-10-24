import { APP_CONFIG } from './config';
import { BUILD_INFO } from './build-info';

const DAY_KEY = 'mf-usage-day';

/** Local calendar day "YYYY-MM-DD". */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Do Not Track / Global Privacy Control: the browser asked not to be counted. */
function optedOut(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.doNotTrack === '1' || n.globalPrivacyControl === true;
}

/**
 * Anonymous "this device opened the app today": at most once a day, no page, no account
 * content. The server stores only a salted hash of the random device id (see privasi.html).
 */
export function sendUsagePing(deviceId: string): void {
  try {
    if (!deviceId || optedOut() || localStorage.getItem(DAY_KEY) === today()) return;
    const standalone =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    void fetch(`${APP_CONFIG.apiBase}/usage`, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Mushaf-Client': '1' },
      body: JSON.stringify({ deviceId, standalone, appVersion: BUILD_INFO.version }),
    })
      .then((r) => {
        if (r.ok) localStorage.setItem(DAY_KEY, today());
      })
      .catch(() => undefined);
  } catch {
    /* storage or fetch unavailable: skip */
  }
}

/** Pure formatting helpers (Indonesian locale) for settings/account/offline UI. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function clock(d: Date): string {
  return `${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "baru saja", "5 menit lalu", "2 jam lalu", "kemarin 21.14", "12 Okt 08.05". */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return 'baru saja'; // also covers small clock skew (future)
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} menit lalu`;
  const d = new Date(ts);
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000);
  if (dayDiff <= 0) return `${Math.floor(minutes / 60)} jam lalu`;
  if (dayDiff === 1) return `kemarin ${clock(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(d)}`;
}

function decimal(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

/** Bytes → "820 KB", "12,4 MB", "1,2 GB" with Indonesian decimal comma. */
export function formatBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${decimal(b / (1024 * 1024))} MB`;
  return `${decimal(b / (1024 * 1024 * 1024))} GB`;
}

/** Always megabytes, one decimal: "86,4 MB". */
export function formatMb(bytes: number): string {
  return `${decimal(Math.max(0, bytes) / (1024 * 1024))} MB`;
}

/** `mushaf-digital-YYYY-MM-DD.json` (local date). */
export function exportFilename(date: Date = new Date()): string {
  return `mushaf-digital-${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}.json`;
}

/** Toast copy after an import. */
export function importSummary(r: { added: number; skipped: number }): string {
  return `${r.added} penanda ditambahkan, ${r.skipped} dilewati`;
}

/** "20 Okt 2026 12.30" (local time). */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${clock(d)}`;
}

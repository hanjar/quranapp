import { daysBetween, localDay } from '../../core/progress/progress-logic';

const DATE_FMT = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const SHORT_FMT = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const WEEKDAY_FMT = new Intl.DateTimeFormat('id-ID', { weekday: 'short' });
const NUM_FMT = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** Local noon of a 'YYYY-MM-DD' day (avoids DST edges). */
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

/** "12 Oktober 2026" (Indonesian). */
export function formatLongDate(d: Date): string {
  return DATE_FMT.format(d);
}

/** "Sen", "Sel", ... for a 'YYYY-MM-DD' day. */
export function weekdayShort(day: string): string {
  return WEEKDAY_FMT.format(dayToDate(day)).replace('.', '');
}

/** "12,5" (id-ID decimal comma, at most one decimal). */
export function formatDecimal(n: number): string {
  return NUM_FMT.format(n);
}

/** "Hari ini", "Kemarin", "3 hari lalu", else "12 Okt 2026". */
export function relativeDay(lastAt: number, now: number): string {
  const diff = daysBetween(localDay(lastAt), localDay(now));
  if (diff <= 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return `${diff} hari lalu`;
  return SHORT_FMT.format(new Date(lastAt));
}

/** Bar height in px for the 7-day chart: min 4px for non-zero, 2px baseline for zero. */
export function barHeight(count: number, max: number, maxPx = 76): number {
  if (max <= 0) return 2;
  return Math.max((count / max) * maxPx, count > 0 ? 4 : 2);
}

/** Text alternative for the 7-day chart. */
export function weekSummary(week: readonly { day: string; count: number }[], target: number): string {
  const parts = week.map((w, i) => `${i === week.length - 1 ? 'hari ini' : weekdayShort(w.day)} ${w.count}`);
  return `Halaman dibaca 7 hari terakhir: ${parts.join(', ')}. Target ${target} halaman.`;
}

/** ETA paragraph under the progress bar. */
export function etaText(remaining: number, eta: Date | null, avgPerDay: number): string {
  if (remaining <= 0) return 'Alhamdulillah, semua halaman sudah dibaca.';
  const avg = `Rata-rata 7 hari terakhir: ${formatDecimal(avgPerDay)} halaman per hari.`;
  if (!eta) return `Sisa ${remaining} halaman. Baca beberapa halaman untuk melihat perkiraan khatam. ${avg}`;
  return `Sisa ${remaining} halaman. Dengan kecepatan sekarang, khatam sekitar ${formatLongDate(eta)}. ${avg}`;
}

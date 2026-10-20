/** Pure helpers for the automatic night-mode schedule. Times are local 'HH:MM'. */

export function parseHHMM(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** True when `date` falls in [start, end); crosses midnight when end <= start. start === end means never. */
export function isNightAt(date: Date, start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null || s === e) return false;
  const m = minutesOf(date);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The next moment after `date` at which the schedule flips, or null when it never does. */
export function nextBoundary(date: Date, start: string, end: string): Date | null {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null || s === e) return null;
  let best: Date | null = null;
  for (const mins of [s, e]) {
    const c = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(mins / 60), mins % 60, 0, 0);
    if (c.getTime() <= date.getTime()) c.setDate(c.getDate() + 1);
    if (!best || c < best) best = c;
  }
  return best;
}

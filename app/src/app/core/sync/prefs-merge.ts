/**
 * Per-setting merge of two preference payloads (wire format). Every setting carries its own change
 * time in `fieldTimes` (key → epoch ms; `extra.<key>` for the small settings in `extra`), so a
 * device only overrides what it actually changed. Payloads without `fieldTimes` (older clients)
 * (or with an empty one) use their `updatedAt` for every setting; a payload with `fieldTimes` but no entry for a key
 * never changed it (time 0). Ties go to `b`.
 *
 * Kept identical to worker/src/prefs-merge.ts.
 */

type Rec = Record<string, unknown>;

const META = new Set(['updatedAt', 'fieldTimes', 'extra']);

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function timeOf(p: Rec): (key: string) => number {
  // No (or an empty) fieldTimes: an older client, or settings saved before per-setting times.
  const ft = isRec(p['fieldTimes']) && Object.keys(p['fieldTimes']).length ? p['fieldTimes'] : null;
  const u = num(p['updatedAt']) ?? 0;
  return (key) => (ft ? (num(ft[key]) ?? 0) : u);
}

export function mergePrefs(a: Rec, b: Rec): Rec {
  const ta = timeOf(a);
  const tb = timeOf(b);
  const out: Rec = {};
  const times: Record<string, number> = {};
  const pick = (key: string, inA: boolean, inB: boolean, va: unknown, vb: unknown, set: (v: unknown) => void) => {
    const x = inA ? ta(key) : -1;
    const y = inB ? tb(key) : -1;
    if (inB && y >= x) {
      set(vb);
      times[key] = y;
    } else if (inA) {
      set(va);
      times[key] = x;
    }
  };
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (META.has(k)) continue;
    pick(k, k in a, k in b, a[k], b[k], (v) => (out[k] = v));
  }
  const ea = isRec(a['extra']) ? a['extra'] : {};
  const eb = isRec(b['extra']) ? b['extra'] : {};
  const extra: Rec = {};
  for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
    pick(`extra.${k}`, k in ea, k in eb, ea[k], eb[k], (v) => (extra[k] = v));
  }
  out['extra'] = extra;
  out['fieldTimes'] = times;
  out['updatedAt'] = Math.max(num(a['updatedAt']) ?? 0, num(b['updatedAt']) ?? 0);
  return out;
}

/** True when `a` has a setting changed later than `b` has it (so `a` must be sent on). */
export function newerIn(a: Rec, b: Rec): boolean {
  const ta = timeOf(a);
  const tb = timeOf(b);
  for (const k of Object.keys(a)) {
    if (META.has(k)) continue;
    if (ta(k) > (k in b ? tb(k) : 0) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  const ea = isRec(a['extra']) ? a['extra'] : {};
  const eb = isRec(b['extra']) ? b['extra'] : {};
  for (const k of Object.keys(ea)) {
    if (ta(`extra.${k}`) > (k in eb ? tb(`extra.${k}`) : 0) && JSON.stringify(ea[k]) !== JSON.stringify(eb[k]))
      return true;
  }
  return false;
}

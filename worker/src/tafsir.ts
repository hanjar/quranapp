/**
 * Private tafsir (Ibnu Katsir, AI translation, not reviewed): served only to the accounts
 * listed in TAFSIR_EMAILS, from a private R2 bucket. Never public, never cached by shared caches.
 */

/** R2 key of one surah's file. */
export const tafsirKey = (surah: number) => `ibnu-katsir/${surah}.json`;

/** True when `email` is on the comma-separated allow-list (case-insensitive). */
export function tafsirAllowed(allowList: string | undefined, email: string | null | undefined): boolean {
  if (!allowList || !email) return false;
  const e = email.trim().toLowerCase();
  return allowList
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .some((x) => x !== '' && x === e);
}

/** "1".."114" only. */
export function parseSurahParam(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 114 ? n : null;
}

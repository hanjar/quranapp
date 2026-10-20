import { PAGE_COUNT, SurahMeta } from '../../core/models';
import { nameMatchRank } from './search-parser';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** epoch ms -> "12 Okt 2026" (local time). */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Surah list filter for the browse sheet: name (Latin/English), number, Arabic. */
export function filterSurahs(surahs: readonly SurahMeta[], query: string): SurahMeta[] {
  const q = query.trim();
  if (!q) return [...surahs];
  if (/^\d+$/.test(q)) return surahs.filter((s) => String(s.number) === q);
  return surahs.filter((s) => nameMatchRank(s, q) !== null);
}

/** Juz filter: empty = all, digits = that juz. */
export function filterJuz<T extends { number: number }>(juz: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...juz];
  const digits = q.replace(/\D/g, '');
  return digits ? juz.filter((j) => String(j.number) === digits) : [];
}

/** Strict page-number parse: "42" -> 42; "", "0", "605", "4.5", "abc" -> null. */
export function parsePageInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = +t;
  return n >= 1 && n <= PAGE_COUNT ? n : null;
}

/** Reference text used by "Salin rujukan" and "Bagikan". */
export function verseReference(
  surah: Pick<SurahMeta, 'nameLatin' | 'number'>,
  ayah: number,
  page: number,
): string {
  return `QS. ${surah.nameLatin} ${surah.number}:${ayah} (hal. ${page})`;
}

/** Text for "Salin bacaan": "QS. At-Tur 52:47 — <latin>". */
export function latinCopyText(
  surah: Pick<SurahMeta, 'nameLatin' | 'number'>,
  ayah: number,
  latin: string,
): string {
  return `QS. ${surah.nameLatin} ${surah.number}:${ayah} — ${latin.trim()}`;
}

/** Text for "Salin terjemahan". */
export function translationCopyText(
  surah: Pick<SurahMeta, 'nameLatin' | 'number'>,
  ayah: number,
  translation: string,
): string {
  return `QS. ${surah.nameLatin} ${surah.number}:${ayah} — ${translation.trim()} (Terjemahan Kemenag RI)`;
}

/** Share text: reference, then Latin and translation when available. */
export function shareText(parts: {
  reference: string;
  latin?: string | null;
  translation?: string | null;
}): string {
  const out = [parts.reference];
  const latin = parts.latin?.trim();
  const tr = parts.translation?.trim();
  if (latin) out.push(latin);
  if (tr) out.push(`${latin ? '\n' : ''}"${tr}" (Terjemahan Kemenag RI)`);
  return out.join('\n');
}

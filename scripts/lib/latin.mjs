// Pure helpers for the Indonesian Latin transliteration (EQuran.id API v2, Kemenag RI).

export const LATIN_SOURCE = {
  name: 'Transliterasi Kemenag RI (via EQuran.id API v2)',
  url: 'https://equran.id/apidev',
  origin: 'Kementerian Agama RI — quran.kemenag.go.id',
  license: 'Data Kemenag RI; penggunaan non-komersial dengan atribusi, menunggu izin tertulis LPMQ',
};

/** Strip HTML tags, normalise whitespace, NFC. Throws on <script. Diacritics are preserved. */
export function normaliseLatin(text, label = 'latin') {
  if (typeof text !== 'string') throw new Error(`${label}: not a string`);
  if (/<\s*script/i.test(text)) throw new Error(`${label}: contains <script`);
  const out = text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
  if (!out) throw new Error(`${label}: empty after normalisation`);
  if (out.length > 2000) throw new Error(`${label}: longer than 2000 chars`);
  return out;
}

/**
 * Build the "s:a" map from per-surah API payloads (index 0 = surah 1).
 * Validates ayah numbering against surahs[].ayahCount and the 6236 total.
 */
export function buildLatinMap(payloads, surahs) {
  if (payloads.length !== 114 || surahs.length !== 114) throw new Error('latin: expected 114 surahs');
  const ayahs = {};
  let total = 0;
  payloads.forEach((p, i) => {
    const n = i + 1;
    const list = p?.data?.ayat;
    if (!Array.isArray(list)) throw new Error(`latin surah ${n}: missing data.ayat`);
    if (list.length !== surahs[i].ayahCount) {
      throw new Error(`latin surah ${n}: ${list.length} ayahs, expected ${surahs[i].ayahCount}`);
    }
    for (const a of list) {
      if (!Number.isInteger(a?.nomorAyat) || a.nomorAyat < 1 || a.nomorAyat > surahs[i].ayahCount) {
        throw new Error(`latin surah ${n}: bad nomorAyat ${a?.nomorAyat}`);
      }
      const key = `${n}:${a.nomorAyat}`;
      if (key in ayahs) throw new Error(`latin: duplicate ${key}`);
      ayahs[key] = normaliseLatin(a.teksLatin, key);
      total++;
    }
  });
  if (total !== 6236) throw new Error(`latin: ${total} ayahs, expected 6236`);
  return ayahs;
}

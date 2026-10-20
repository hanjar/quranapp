// Pure helpers for the Arabic ayah text (Kemenag RI, via EQuran.id API v2 `teksArab`).
// Used only for sharing/copying; the mushaf page itself is rendered from the KFQC artwork.

export const ARABIC_SOURCE = {
  name: 'Teks Arab Kemenag RI (via EQuran.id API v2)',
  url: 'https://equran.id/apidev',
  origin: 'Kementerian Agama RI — quran.kemenag.go.id',
  license: 'Data Kemenag RI; penggunaan non-komersial dengan atribusi, menunggu izin tertulis LPMQ',
};

/** Verbatim Arabic: only trim, collapse whitespace and NFC. Throws on markup or empty text. */
export function normaliseArabic(text, label = 'arabic') {
  if (typeof text !== 'string') throw new Error(`${label}: not a string`);
  if (/<[^>]*>/.test(text)) throw new Error(`${label}: contains markup`);
  const out = text.replace(/\s+/g, ' ').trim().normalize('NFC');
  if (!out) throw new Error(`${label}: empty after normalisation`);
  if (out.length > 3000) throw new Error(`${label}: longer than 3000 chars`);
  if (!/[؀-ۿ]/.test(out)) throw new Error(`${label}: no Arabic letters`);
  return out;
}

/** Build the "s:a" map from per-surah API payloads (index 0 = surah 1). Validates counts and the 6236 total. */
export function buildArabicMap(payloads, surahs) {
  if (payloads.length !== 114 || surahs.length !== 114) throw new Error('arabic: expected 114 surahs');
  const ayahs = {};
  let total = 0;
  payloads.forEach((p, i) => {
    const n = i + 1;
    const list = p?.data?.ayat;
    if (!Array.isArray(list)) throw new Error(`arabic surah ${n}: missing data.ayat`);
    if (list.length !== surahs[i].ayahCount) {
      throw new Error(`arabic surah ${n}: ${list.length} ayahs, expected ${surahs[i].ayahCount}`);
    }
    for (const a of list) {
      if (!Number.isInteger(a?.nomorAyat) || a.nomorAyat < 1 || a.nomorAyat > surahs[i].ayahCount) {
        throw new Error(`arabic surah ${n}: bad nomorAyat ${a?.nomorAyat}`);
      }
      const key = `${n}:${a.nomorAyat}`;
      if (key in ayahs) throw new Error(`arabic: duplicate ${key}`);
      ayahs[key] = normaliseArabic(a.teksArab, key);
      total++;
    }
  });
  if (total !== 6236) throw new Error(`arabic: ${total} ayahs, expected 6236`);
  return ayahs;
}

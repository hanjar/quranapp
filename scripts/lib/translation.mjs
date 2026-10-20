// Pure helpers for the Indonesian translation (Kemenag RI via EQuran.id API v2).

export const TRANSLATION_SOURCE = {
  name: 'Terjemahan Kemenag RI',
  edition: 'Al-Qur’an dan Terjemahannya, edisi penyempurnaan 2019',
  url: 'https://equran.id/apidev',
  origin: 'Kementerian Agama RI — quran.kemenag.go.id',
  license: 'Data Kemenag RI; penggunaan non-komersial dengan atribusi, menunggu izin tertulis LPMQ',
};

/** Strip HTML tags (keeping their text), collapse whitespace, NFC. Throws on <script. */
export function normaliseTranslation(text, label = 'translation') {
  if (typeof text !== 'string') throw new Error(`${label}: not a string`);
  if (/<\s*script/i.test(text)) throw new Error(`${label}: contains <script`);
  const out = text
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
  if (!out) throw new Error(`${label}: empty after normalisation`);
  if (out.length > 6000) throw new Error(`${label}: longer than 6000 chars`);
  return out;
}

/** True when text has a likely leftover footnote marker: digit glued to a letter, or superscript digits. */
export function hasFootnoteMarker(text) {
  return /[\p{L}\p{M}][0-9]|[¹²³⁰⁴-⁹]/u.test(text);
}

/** Keys of entries with a probable footnote marker. */
export function findFootnoteMarkers(ayahs) {
  return Object.keys(ayahs).filter((k) => hasFootnoteMarker(ayahs[k]));
}

/** Build the "s:a" map from per-surah API payloads (index 0 = surah 1). */
export function buildTranslationMap(payloads, surahs) {
  if (payloads.length !== 114 || surahs.length !== 114) throw new Error('translation: expected 114 surahs');
  const ayahs = {};
  let total = 0;
  payloads.forEach((p, i) => {
    const n = i + 1;
    const list = p?.data?.ayat;
    if (!Array.isArray(list)) throw new Error(`translation surah ${n}: missing data.ayat`);
    if (list.length !== surahs[i].ayahCount) {
      throw new Error(`translation surah ${n}: ${list.length} ayahs, expected ${surahs[i].ayahCount}`);
    }
    for (const a of list) {
      if (!Number.isInteger(a?.nomorAyat) || a.nomorAyat < 1 || a.nomorAyat > surahs[i].ayahCount) {
        throw new Error(`translation surah ${n}: bad nomorAyat ${a?.nomorAyat}`);
      }
      const key = `${n}:${a.nomorAyat}`;
      if (key in ayahs) throw new Error(`translation: duplicate ${key}`);
      ayahs[key] = normaliseTranslation(a.teksIndonesia, key);
      total++;
    }
  });
  if (total !== 6236) throw new Error(`translation: ${total} ayahs, expected 6236`);
  return ayahs;
}

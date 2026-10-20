// Pure helpers for Tafsir Kemenag RI per ayah (via EQuran.id API v2 /tafsir/{n}).

export const TAFSIR_SOURCE = {
  name: 'Tafsir Kemenag RI',
  origin: 'Kementerian Agama RI — quran.kemenag.go.id',
  url: 'https://equran.id/apidev',
  license: 'Data Kemenag RI; penggunaan non-komersial dengan atribusi, menunggu izin tertulis LPMQ',
};

/** HTML/plain tafsir -> plain text with "\n\n"-separated paragraphs. Throws on <script or empty. */
export function normaliseTafsir(text, label = 'tafsir') {
  if (typeof text !== 'string') throw new Error(`${label}: not a string`);
  if (/<\s*script/i.test(text)) throw new Error(`${label}: contains <script`);
  const decoded = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r\n?/g, '\n');
  const paras = decoded
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  const out = paras.join('\n\n').normalize('NFC');
  if (!out) throw new Error(`${label}: empty after normalisation`);
  return out;
}

/** Build per-surah maps {"<ayah>": text} from API payloads (index 0 = surah 1). Returns array of 114 maps. */
export function buildTafsirMaps(payloads, surahs) {
  if (payloads.length !== 114 || surahs.length !== 114) throw new Error('tafsir: expected 114 surahs');
  return payloads.map((p, i) => {
    const n = i + 1;
    const list = p?.data?.tafsir;
    if (!Array.isArray(list)) throw new Error(`tafsir surah ${n}: missing data.tafsir`);
    if (list.length !== surahs[i].ayahCount) {
      throw new Error(`tafsir surah ${n}: ${list.length} ayahs, expected ${surahs[i].ayahCount}`);
    }
    const map = {};
    for (const a of list) {
      if (!Number.isInteger(a?.ayat) || a.ayat < 1 || a.ayat > surahs[i].ayahCount) {
        throw new Error(`tafsir surah ${n}: bad ayat ${a?.ayat}`);
      }
      const key = String(a.ayat);
      if (key in map) throw new Error(`tafsir surah ${n}: duplicate ayat ${key}`);
      map[key] = normaliseTafsir(a.teks, `tafsir ${n}:${key}`);
    }
    return map;
  });
}

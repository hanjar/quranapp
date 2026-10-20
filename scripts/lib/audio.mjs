// Pure helpers for the offline audio packages (no I/O).

export const QARI = {
  id: 'alafasy',
  name: 'Mishary Rasyid Alafasy',
  source: 'Al Quran Cloud / Islamic Network CDN',
  license: 'Non-commercial; recordings © reciter/rights holders',
};

export const VARIANTS = {
  opus24: { label: 'Hemat', ext: 'webm', mime: 'audio/webm; codecs=opus', kbps: 24 },
  opus32: { label: 'Standar', ext: 'webm', mime: 'audio/webm; codecs=opus', kbps: 32 },
  mp364: { label: 'Kompatibel', ext: 'mp3', mime: 'audio/mpeg', kbps: 64 },
};

export const AYAH_TOTAL = 6236;

/** Ordered list of all {surah, ayah, n} (n = global number 1..6236) from surahs.json-like [{number, ayahCount}]. */
export function allAyahs(surahs) {
  const out = [];
  let n = 0;
  for (const s of [...surahs].sort((a, b) => a.number - b.number)) {
    for (let a = 1; a <= s.ayahCount; a++) out.push({ surah: s.number, ayah: a, n: ++n });
  }
  return out;
}

/** Global ayah number (1-based) of surah:ayah. */
export function globalNumber(surahs, surah, ayah) {
  let n = 0;
  for (const s of surahs) {
    if (s.number < surah) n += s.ayahCount;
  }
  const s = surahs.find((x) => x.number === surah);
  if (!s || ayah < 1 || ayah > s.ayahCount) throw new Error(`invalid ayah ${surah}:${ayah}`);
  return n + ayah;
}

/** "SSSAAA", e.g. 55:13 -> "055013". */
export function ayahBase(surah, ayah) {
  return String(surah).padStart(3, '0') + String(ayah).padStart(3, '0');
}

export const fileName = (surah, ayah, ext) => `${ayahBase(surah, ayah)}.${ext}`;

/** Deterministic sample: every ayah of surahs 1 and 114, plus `count` evenly-spread-with-hash picks. */
export function pickSample(ayahs, count = 300) {
  const chosen = new Map();
  for (const r of ayahs) if (r.surah === 1 || r.surah === 114) chosen.set(r.n, r);
  // Deterministic LCG so the sample is stable across runs.
  let x = 123456789;
  const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0);
  let guard = 0;
  let picked = 0;
  while (picked < count && guard++ < count * 50) {
    const r = ayahs[next() % ayahs.length];
    if (!chosen.has(r.n)) {
      chosen.set(r.n, r);
      picked++;
    }
  }
  return [...chosen.values()].sort((a, b) => a.n - b.n);
}

/** Duration check: within ±3% or ±0.15 s of the reference (whichever is looser). */
export function durationOk(ref, got, pct = 0.03, absSec = 0.15) {
  if (!(ref > 0) || !(got > 0)) return false;
  return Math.abs(got - ref) <= Math.max(ref * pct, absSec);
}

export function buildManifest({ bytesByVariant, builtAt }) {
  const variants = {};
  for (const [id, meta] of Object.entries(VARIANTS)) {
    const bytes = bytesByVariant[id];
    if (!Array.isArray(bytes) || bytes.length !== AYAH_TOTAL) throw new Error(`${id}: expected ${AYAH_TOTAL} sizes`);
    if (bytes.some((b) => !Number.isInteger(b) || b <= 0)) throw new Error(`${id}: empty or invalid file size`);
    variants[id] = { ...meta, totalBytes: bytes.reduce((a, b) => a + b, 0), bytes };
  }
  return { format: 'mushaf-audio', version: 1, qari: { ...QARI, builtAt }, variants, ayahCount: AYAH_TOTAL };
}

/** Average bytes per juz given juz start refs ([{start:{surah,ayah}}]) and a bytes array in global order. */
export function perJuzAverage(juz, surahs, bytes) {
  const starts = juz.map((j) => globalNumber(surahs, j.start.surah, j.start.ayah) - 1);
  return starts.map((st, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : bytes.length;
    const slice = bytes.slice(st, end);
    return slice.reduce((a, b) => a + b, 0);
  });
}

/** True when the buffer starts with an ID3 tag or an MPEG audio frame sync. */
export function looksLikeMp3(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // "ID3"
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

/** Accept audio/* always; application/octet-stream only when the bytes are MP3 (the CDN mislabels some files). */
export function acceptableAudio(contentType, buf) {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('audio/')) return looksLikeMp3(buf);
  if (ct.startsWith('application/octet-stream')) return looksLikeMp3(buf);
  return false;
}

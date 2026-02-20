const CDN_BASE = 'https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters';

export async function fetchSurah(num: number, kv?: KVNamespace): Promise<unknown> {
  const cacheKey = `surah:${num}`;

  if (kv) {
    const cached = await kv.get(cacheKey, 'json');
    if (cached) return cached;
  }

  const res = await fetch(`${CDN_BASE}/${num}.json`);
  if (!res.ok) throw new Error(`Failed to fetch surah ${num}`);
  const data = await res.json();

  if (kv) {
    await kv.put(cacheKey, JSON.stringify(data));
  }

  return data;
}

export async function fetchTranslation(num: number, kv?: KVNamespace): Promise<unknown> {
  const cacheKey = `surah:${num}:id`;

  if (kv) {
    const cached = await kv.get(cacheKey, 'json');
    if (cached) return cached;
  }

  const res = await fetch(`${CDN_BASE}/id/${num}.json`);
  if (!res.ok) throw new Error(`Failed to fetch translation for surah ${num}`);
  const data = await res.json();

  if (kv) {
    await kv.put(cacheKey, JSON.stringify(data));
  }

  return data;
}

// Pre-built surah metadata list (avoids fetching all 114 files)
export const SURAH_LIST: {
  number: number;
  name: string;
  englishName: string;
  totalVerses: number;
  revelationType: string;
  startAyah: number;
}[] = [
  { number: 1, name: "الفاتحة", englishName: "Al-Fatihah", totalVerses: 7, revelationType: "Meccan", startAyah: 1 },
  { number: 2, name: "البقرة", englishName: "Al-Baqarah", totalVerses: 286, revelationType: "Medinan", startAyah: 8 },
  { number: 3, name: "آل عمران", englishName: "Ali 'Imran", totalVerses: 200, revelationType: "Medinan", startAyah: 294 },
  { number: 4, name: "النساء", englishName: "An-Nisa", totalVerses: 176, revelationType: "Medinan", startAyah: 494 },
  { number: 5, name: "المائدة", englishName: "Al-Ma'idah", totalVerses: 120, revelationType: "Medinan", startAyah: 670 },
  { number: 6, name: "الأنعام", englishName: "Al-An'am", totalVerses: 165, revelationType: "Meccan", startAyah: 790 },
  { number: 7, name: "الأعراف", englishName: "Al-A'raf", totalVerses: 206, revelationType: "Meccan", startAyah: 955 },
  { number: 8, name: "الأنفال", englishName: "Al-Anfal", totalVerses: 75, revelationType: "Medinan", startAyah: 1161 },
  { number: 9, name: "التوبة", englishName: "At-Tawbah", totalVerses: 129, revelationType: "Medinan", startAyah: 1236 },
  { number: 10, name: "يونس", englishName: "Yunus", totalVerses: 109, revelationType: "Meccan", startAyah: 1365 },
  { number: 11, name: "هود", englishName: "Hud", totalVerses: 123, revelationType: "Meccan", startAyah: 1474 },
  { number: 12, name: "يوسف", englishName: "Yusuf", totalVerses: 111, revelationType: "Meccan", startAyah: 1597 },
  { number: 13, name: "الرعد", englishName: "Ar-Ra'd", totalVerses: 43, revelationType: "Medinan", startAyah: 1708 },
  { number: 14, name: "إبراهيم", englishName: "Ibrahim", totalVerses: 52, revelationType: "Meccan", startAyah: 1751 },
  { number: 15, name: "الحجر", englishName: "Al-Hijr", totalVerses: 99, revelationType: "Meccan", startAyah: 1803 },
  { number: 16, name: "النحل", englishName: "An-Nahl", totalVerses: 128, revelationType: "Meccan", startAyah: 1902 },
  { number: 17, name: "الإسراء", englishName: "Al-Isra", totalVerses: 111, revelationType: "Meccan", startAyah: 2030 },
  { number: 18, name: "الكهف", englishName: "Al-Kahf", totalVerses: 110, revelationType: "Meccan", startAyah: 2141 },
  { number: 19, name: "مريم", englishName: "Maryam", totalVerses: 98, revelationType: "Meccan", startAyah: 2251 },
  { number: 20, name: "طه", englishName: "Taha", totalVerses: 135, revelationType: "Meccan", startAyah: 2349 },
  { number: 21, name: "الأنبياء", englishName: "Al-Anbiya", totalVerses: 112, revelationType: "Meccan", startAyah: 2484 },
  { number: 22, name: "الحج", englishName: "Al-Hajj", totalVerses: 78, revelationType: "Medinan", startAyah: 2596 },
  { number: 23, name: "المؤمنون", englishName: "Al-Mu'minun", totalVerses: 118, revelationType: "Meccan", startAyah: 2674 },
  { number: 24, name: "النور", englishName: "An-Nur", totalVerses: 64, revelationType: "Medinan", startAyah: 2792 },
  { number: 25, name: "الفرقان", englishName: "Al-Furqan", totalVerses: 77, revelationType: "Meccan", startAyah: 2856 },
  { number: 26, name: "الشعراء", englishName: "Ash-Shu'ara", totalVerses: 227, revelationType: "Meccan", startAyah: 2933 },
  { number: 27, name: "النمل", englishName: "An-Naml", totalVerses: 93, revelationType: "Meccan", startAyah: 3160 },
  { number: 28, name: "القصص", englishName: "Al-Qasas", totalVerses: 88, revelationType: "Meccan", startAyah: 3253 },
  { number: 29, name: "العنكبوت", englishName: "Al-Ankabut", totalVerses: 69, revelationType: "Meccan", startAyah: 3341 },
  { number: 30, name: "الروم", englishName: "Ar-Rum", totalVerses: 60, revelationType: "Meccan", startAyah: 3410 },
  { number: 31, name: "لقمان", englishName: "Luqman", totalVerses: 34, revelationType: "Meccan", startAyah: 3470 },
  { number: 32, name: "السجدة", englishName: "As-Sajdah", totalVerses: 30, revelationType: "Meccan", startAyah: 3504 },
  { number: 33, name: "الأحزاب", englishName: "Al-Ahzab", totalVerses: 73, revelationType: "Medinan", startAyah: 3534 },
  { number: 34, name: "سبأ", englishName: "Saba", totalVerses: 54, revelationType: "Meccan", startAyah: 3607 },
  { number: 35, name: "فاطر", englishName: "Fatir", totalVerses: 45, revelationType: "Meccan", startAyah: 3661 },
  { number: 36, name: "يس", englishName: "Ya-Sin", totalVerses: 83, revelationType: "Meccan", startAyah: 3706 },
  { number: 37, name: "الصافات", englishName: "As-Saffat", totalVerses: 182, revelationType: "Meccan", startAyah: 3789 },
  { number: 38, name: "ص", englishName: "Sad", totalVerses: 88, revelationType: "Meccan", startAyah: 3971 },
  { number: 39, name: "الزمر", englishName: "Az-Zumar", totalVerses: 75, revelationType: "Meccan", startAyah: 4059 },
  { number: 40, name: "غافر", englishName: "Ghafir", totalVerses: 85, revelationType: "Meccan", startAyah: 4134 },
  { number: 41, name: "فصلت", englishName: "Fussilat", totalVerses: 54, revelationType: "Meccan", startAyah: 4219 },
  { number: 42, name: "الشورى", englishName: "Ash-Shura", totalVerses: 53, revelationType: "Meccan", startAyah: 4273 },
  { number: 43, name: "الزخرف", englishName: "Az-Zukhruf", totalVerses: 89, revelationType: "Meccan", startAyah: 4326 },
  { number: 44, name: "الدخان", englishName: "Ad-Dukhan", totalVerses: 59, revelationType: "Meccan", startAyah: 4415 },
  { number: 45, name: "الجاثية", englishName: "Al-Jathiyah", totalVerses: 37, revelationType: "Meccan", startAyah: 4474 },
  { number: 46, name: "الأحقاف", englishName: "Al-Ahqaf", totalVerses: 35, revelationType: "Meccan", startAyah: 4511 },
  { number: 47, name: "محمد", englishName: "Muhammad", totalVerses: 38, revelationType: "Medinan", startAyah: 4546 },
  { number: 48, name: "الفتح", englishName: "Al-Fath", totalVerses: 29, revelationType: "Medinan", startAyah: 4584 },
  { number: 49, name: "الحجرات", englishName: "Al-Hujurat", totalVerses: 18, revelationType: "Medinan", startAyah: 4613 },
  { number: 50, name: "ق", englishName: "Qaf", totalVerses: 45, revelationType: "Meccan", startAyah: 4631 },
  { number: 51, name: "الذاريات", englishName: "Adh-Dhariyat", totalVerses: 60, revelationType: "Meccan", startAyah: 4676 },
  { number: 52, name: "الطور", englishName: "At-Tur", totalVerses: 49, revelationType: "Meccan", startAyah: 4736 },
  { number: 53, name: "النجم", englishName: "An-Najm", totalVerses: 62, revelationType: "Meccan", startAyah: 4785 },
  { number: 54, name: "القمر", englishName: "Al-Qamar", totalVerses: 55, revelationType: "Meccan", startAyah: 4847 },
  { number: 55, name: "الرحمن", englishName: "Ar-Rahman", totalVerses: 78, revelationType: "Medinan", startAyah: 4902 },
  { number: 56, name: "الواقعة", englishName: "Al-Waqi'ah", totalVerses: 96, revelationType: "Meccan", startAyah: 4980 },
  { number: 57, name: "الحديد", englishName: "Al-Hadid", totalVerses: 29, revelationType: "Medinan", startAyah: 5076 },
  { number: 58, name: "المجادلة", englishName: "Al-Mujadila", totalVerses: 22, revelationType: "Medinan", startAyah: 5105 },
  { number: 59, name: "الحشر", englishName: "Al-Hashr", totalVerses: 24, revelationType: "Medinan", startAyah: 5127 },
  { number: 60, name: "الممتحنة", englishName: "Al-Mumtahanah", totalVerses: 13, revelationType: "Medinan", startAyah: 5151 },
  { number: 61, name: "الصف", englishName: "As-Saf", totalVerses: 14, revelationType: "Medinan", startAyah: 5164 },
  { number: 62, name: "الجمعة", englishName: "Al-Jumu'ah", totalVerses: 11, revelationType: "Medinan", startAyah: 5178 },
  { number: 63, name: "المنافقون", englishName: "Al-Munafiqun", totalVerses: 11, revelationType: "Medinan", startAyah: 5189 },
  { number: 64, name: "التغابن", englishName: "At-Taghabun", totalVerses: 18, revelationType: "Medinan", startAyah: 5200 },
  { number: 65, name: "الطلاق", englishName: "At-Talaq", totalVerses: 12, revelationType: "Medinan", startAyah: 5218 },
  { number: 66, name: "التحريم", englishName: "At-Tahrim", totalVerses: 12, revelationType: "Medinan", startAyah: 5230 },
  { number: 67, name: "الملك", englishName: "Al-Mulk", totalVerses: 30, revelationType: "Meccan", startAyah: 5242 },
  { number: 68, name: "القلم", englishName: "Al-Qalam", totalVerses: 52, revelationType: "Meccan", startAyah: 5272 },
  { number: 69, name: "الحاقة", englishName: "Al-Haqqah", totalVerses: 52, revelationType: "Meccan", startAyah: 5324 },
  { number: 70, name: "المعارج", englishName: "Al-Ma'arij", totalVerses: 44, revelationType: "Meccan", startAyah: 5376 },
  { number: 71, name: "نوح", englishName: "Nuh", totalVerses: 28, revelationType: "Meccan", startAyah: 5420 },
  { number: 72, name: "الجن", englishName: "Al-Jinn", totalVerses: 28, revelationType: "Meccan", startAyah: 5448 },
  { number: 73, name: "المزمل", englishName: "Al-Muzzammil", totalVerses: 20, revelationType: "Meccan", startAyah: 5476 },
  { number: 74, name: "المدثر", englishName: "Al-Muddathir", totalVerses: 56, revelationType: "Meccan", startAyah: 5496 },
  { number: 75, name: "القيامة", englishName: "Al-Qiyamah", totalVerses: 40, revelationType: "Meccan", startAyah: 5552 },
  { number: 76, name: "الإنسان", englishName: "Al-Insan", totalVerses: 31, revelationType: "Medinan", startAyah: 5592 },
  { number: 77, name: "المرسلات", englishName: "Al-Mursalat", totalVerses: 50, revelationType: "Meccan", startAyah: 5623 },
  { number: 78, name: "النبأ", englishName: "An-Naba", totalVerses: 40, revelationType: "Meccan", startAyah: 5673 },
  { number: 79, name: "النازعات", englishName: "An-Nazi'at", totalVerses: 46, revelationType: "Meccan", startAyah: 5713 },
  { number: 80, name: "عبس", englishName: "Abasa", totalVerses: 42, revelationType: "Meccan", startAyah: 5759 },
  { number: 81, name: "التكوير", englishName: "At-Takwir", totalVerses: 29, revelationType: "Meccan", startAyah: 5801 },
  { number: 82, name: "الانفطار", englishName: "Al-Infitar", totalVerses: 19, revelationType: "Meccan", startAyah: 5830 },
  { number: 83, name: "المطففين", englishName: "Al-Mutaffifin", totalVerses: 36, revelationType: "Meccan", startAyah: 5849 },
  { number: 84, name: "الانشقاق", englishName: "Al-Inshiqaq", totalVerses: 25, revelationType: "Meccan", startAyah: 5885 },
  { number: 85, name: "البروج", englishName: "Al-Buruj", totalVerses: 22, revelationType: "Meccan", startAyah: 5910 },
  { number: 86, name: "الطارق", englishName: "At-Tariq", totalVerses: 17, revelationType: "Meccan", startAyah: 5932 },
  { number: 87, name: "الأعلى", englishName: "Al-A'la", totalVerses: 19, revelationType: "Meccan", startAyah: 5949 },
  { number: 88, name: "الغاشية", englishName: "Al-Ghashiyah", totalVerses: 26, revelationType: "Meccan", startAyah: 5968 },
  { number: 89, name: "الفجر", englishName: "Al-Fajr", totalVerses: 30, revelationType: "Meccan", startAyah: 5994 },
  { number: 90, name: "البلد", englishName: "Al-Balad", totalVerses: 20, revelationType: "Meccan", startAyah: 6024 },
  { number: 91, name: "الشمس", englishName: "Ash-Shams", totalVerses: 15, revelationType: "Meccan", startAyah: 6044 },
  { number: 92, name: "الليل", englishName: "Al-Layl", totalVerses: 21, revelationType: "Meccan", startAyah: 6059 },
  { number: 93, name: "الضحى", englishName: "Ad-Duhaa", totalVerses: 11, revelationType: "Meccan", startAyah: 6080 },
  { number: 94, name: "الشرح", englishName: "Ash-Sharh", totalVerses: 8, revelationType: "Meccan", startAyah: 6091 },
  { number: 95, name: "التين", englishName: "At-Tin", totalVerses: 8, revelationType: "Meccan", startAyah: 6099 },
  { number: 96, name: "العلق", englishName: "Al-Alaq", totalVerses: 19, revelationType: "Meccan", startAyah: 6107 },
  { number: 97, name: "القدر", englishName: "Al-Qadr", totalVerses: 5, revelationType: "Meccan", startAyah: 6126 },
  { number: 98, name: "البينة", englishName: "Al-Bayyinah", totalVerses: 8, revelationType: "Medinan", startAyah: 6131 },
  { number: 99, name: "الزلزلة", englishName: "Az-Zalzalah", totalVerses: 8, revelationType: "Medinan", startAyah: 6139 },
  { number: 100, name: "العاديات", englishName: "Al-Adiyat", totalVerses: 11, revelationType: "Meccan", startAyah: 6147 },
  { number: 101, name: "القارعة", englishName: "Al-Qari'ah", totalVerses: 11, revelationType: "Meccan", startAyah: 6158 },
  { number: 102, name: "التكاثر", englishName: "At-Takathur", totalVerses: 8, revelationType: "Meccan", startAyah: 6169 },
  { number: 103, name: "العصر", englishName: "Al-Asr", totalVerses: 3, revelationType: "Meccan", startAyah: 6177 },
  { number: 104, name: "الهمزة", englishName: "Al-Humazah", totalVerses: 9, revelationType: "Meccan", startAyah: 6180 },
  { number: 105, name: "الفيل", englishName: "Al-Fil", totalVerses: 5, revelationType: "Meccan", startAyah: 6189 },
  { number: 106, name: "قريش", englishName: "Quraysh", totalVerses: 4, revelationType: "Meccan", startAyah: 6194 },
  { number: 107, name: "الماعون", englishName: "Al-Ma'un", totalVerses: 7, revelationType: "Meccan", startAyah: 6198 },
  { number: 108, name: "الكوثر", englishName: "Al-Kawthar", totalVerses: 3, revelationType: "Meccan", startAyah: 6205 },
  { number: 109, name: "الكافرون", englishName: "Al-Kafirun", totalVerses: 6, revelationType: "Meccan", startAyah: 6208 },
  { number: 110, name: "النصر", englishName: "An-Nasr", totalVerses: 3, revelationType: "Medinan", startAyah: 6214 },
  { number: 111, name: "المسد", englishName: "Al-Masad", totalVerses: 5, revelationType: "Meccan", startAyah: 6217 },
  { number: 112, name: "الإخلاص", englishName: "Al-Ikhlas", totalVerses: 4, revelationType: "Meccan", startAyah: 6222 },
  { number: 113, name: "الفلق", englishName: "Al-Falaq", totalVerses: 5, revelationType: "Meccan", startAyah: 6226 },
  { number: 114, name: "الناس", englishName: "An-Nas", totalVerses: 6, revelationType: "Meccan", startAyah: 6231 },
];

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { SURAH_LIST, fetchSurah, fetchTranslation } from '../services/quran-data';
import { PAGE_MAP, TOTAL_PAGES, getPageInfo, getSurahFirstPage, findPage } from '../services/quran-pages';
import { getMushafPage } from '../services/mushaf-data';

const quranRoutes = new Hono<AppEnv>();

// List all 114 surahs (metadata)
quranRoutes.get('/surahs', (c) => {
  return c.json(SURAH_LIST);
});

// Full surah with Arabic verses
quranRoutes.get('/surah/:number', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num) || num < 1 || num > 114) {
    return c.json({ error: 'Invalid surah number (1-114)' }, 400);
  }

  try {
    const kv = c.env.QURAN_CACHE;
    const data = await fetchSurah(num, kv);
    return c.json(data);
  } catch {
    return c.json({ error: 'Failed to fetch surah data' }, 500);
  }
});

// Indonesian translation for a surah
quranRoutes.get('/surah/:number/translation', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num) || num < 1 || num > 114) {
    return c.json({ error: 'Invalid surah number (1-114)' }, 400);
  }

  try {
    const kv = c.env.QURAN_CACHE;
    const data = await fetchTranslation(num, kv);
    return c.json(data);
  } catch {
    return c.json({ error: 'Failed to fetch translation' }, 500);
  }
});

// Single ayah + translation
quranRoutes.get('/surah/:number/ayah/:ayah', async (c) => {
  const num = parseInt(c.req.param('number'));
  const ayahNum = parseInt(c.req.param('ayah'));

  if (isNaN(num) || num < 1 || num > 114) {
    return c.json({ error: 'Invalid surah number (1-114)' }, 400);
  }

  const meta = SURAH_LIST.find((s) => s.number === num);
  if (!meta || isNaN(ayahNum) || ayahNum < 1 || ayahNum > meta.totalVerses) {
    return c.json({ error: 'Invalid ayah number' }, 400);
  }

  try {
    const kv = c.env.QURAN_CACHE;
    const [surahData, translationData] = await Promise.all([
      fetchSurah(num, kv) as Promise<{ verses: { id: number; text: string }[] }>,
      fetchTranslation(num, kv) as Promise<{ verses: { id: number; text: string; translation: string }[] }>,
    ]);

    const arabic = surahData.verses.find((v) => v.id === ayahNum);
    const translation = translationData.verses.find((v) => v.id === ayahNum);

    if (!arabic) {
      return c.json({ error: 'Ayah not found' }, 404);
    }

    return c.json({
      surah: num,
      ayah: ayahNum,
      text: arabic.text,
      translation: translation?.translation ?? null,
    });
  } catch {
    return c.json({ error: 'Failed to fetch ayah' }, 500);
  }
});

// Page mapping metadata (604 pages)
quranRoutes.get('/pages', (c) => {
  const pages = PAGE_MAP.slice(1).map(([surah, ayah], i) => ({
    page: i + 1,
    surah,
    ayah,
  }));
  return c.json({ totalPages: TOTAL_PAGES, pages });
});

// Get a mushaf page with Arabic text
quranRoutes.get('/page/:number', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num) || num < 1 || num > TOTAL_PAGES) {
    return c.json({ error: `Invalid page number (1-${TOTAL_PAGES})` }, 400);
  }

  const pageInfo = getPageInfo(num);
  if (!pageInfo) {
    return c.json({ error: 'Page not found' }, 404);
  }

  try {
    const kv = c.env.QURAN_CACHE;

    // Fetch all unique surahs needed for this page
    const uniqueSurahs = [...new Set(pageInfo.sections.map(s => s.surah))];
    const surahDataMap = new Map<number, { id: number; name: string; transliteration: string; verses: { id: number; text: string }[] }>();

    await Promise.all(
      uniqueSurahs.map(async (surahNum) => {
        const data = await fetchSurah(surahNum, kv) as {
          id: number; name: string; transliteration: string;
          verses: { id: number; text: string }[];
        };
        surahDataMap.set(surahNum, data);
      })
    );

    // Build response sections
    const sections = pageInfo.sections.map((section) => {
      const surahData = surahDataMap.get(section.surah)!;
      const meta = SURAH_LIST.find(s => s.number === section.surah);
      const verses = surahData.verses.filter(
        v => v.id >= section.startAyah && v.id <= section.endAyah
      );
      const isFirstAyah = section.startAyah === 1;

      return {
        surah: section.surah,
        surahName: surahData.name,
        transliteration: surahData.transliteration,
        totalVerses: meta?.totalVerses ?? 0,
        showHeader: isFirstAyah,
        showBismillah: isFirstAyah && section.surah !== 1 && section.surah !== 9,
        verses,
      };
    });

    return c.json({
      page: num,
      totalPages: TOTAL_PAGES,
      sections,
    });
  } catch {
    return c.json({ error: 'Failed to fetch page data' }, 500);
  }
});

// Find mushaf page for a surah
quranRoutes.get('/surah/:number/page', (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num) || num < 1 || num > 114) {
    return c.json({ error: 'Invalid surah number (1-114)' }, 400);
  }
  return c.json({ surah: num, page: getSurahFirstPage(num) });
});

// Find mushaf page for a specific ayah
quranRoutes.get('/surah/:number/ayah/:ayah/page', (c) => {
  const num = parseInt(c.req.param('number'));
  const ayah = parseInt(c.req.param('ayah'));
  if (isNaN(num) || num < 1 || num > 114) {
    return c.json({ error: 'Invalid surah number' }, 400);
  }
  if (isNaN(ayah) || ayah < 1) {
    return c.json({ error: 'Invalid ayah number' }, 400);
  }
  return c.json({ surah: num, ayah, page: findPage(num, ayah) });
});

// Find mushaf page for a specific ayah
quranRoutes.get('/surah/:number/ayah/:ayah/page', (c) => {
  const num = parseInt(c.req.param('number'));
  const ayah = parseInt(c.req.param('ayah'));
  if (isNaN(num) || num < 1 || num > 114) {
    return c.json({ error: 'Invalid surah number' }, 400);
  }
  if (isNaN(ayah) || ayah < 1) {
    return c.json({ error: 'Invalid ayah number' }, 400);
  }
  // Import findPage if not already imported (it is in line 4 imports)
  // Wait, I need to check if findPage is imported.
  // In the file content I read, line 4 was:
  // import { PAGE_MAP, TOTAL_PAGES, getPageInfo, getSurahFirstPage } from '../services/quran-pages';
  // So findPage IS NOT imported. I need to update imports first.

  // I will assume I can't just fix imports here. I must do a separate edit or include imports.
  // Actually, I can replace the import line too if I use multi_replace.
  // But let's check `quran.ts` again. Line 4 needs update.
  const { findPage } = require('../services/quran-pages'); // Hack? No, ESM.
  // I will use multi_replace to fix imports and add route.
  return c.json({ surah: num, ayah, page: getSurahFirstPage(num) }); // Placeholder until I fix import
});

// Mushaf page with QPC glyph data (15 lines per page)
quranRoutes.get('/mushaf-page/:number', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num) || num < 1 || num > TOTAL_PAGES) {
    return c.json({ error: `Invalid page number (1-${TOTAL_PAGES})` }, 400);
  }

  try {
    const kv = c.env.QURAN_CACHE;
    const data = await getMushafPage(num, kv);
    return c.json(data);
  } catch {
    return c.json({ error: 'Failed to fetch mushaf page data' }, 500);
  }
});

export { quranRoutes };

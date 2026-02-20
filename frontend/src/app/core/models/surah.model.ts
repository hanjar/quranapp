export interface SurahMeta {
  number: number;
  name: string;
  englishName: string;
  totalVerses: number;
  revelationType: string;
  startAyah: number;
}

export interface Verse {
  id: number;
  text: string;
  transliteration: string;
}

export interface TranslationVerse {
  id: number;
  text: string;
  translation: string;
  transliteration: string;
}

export interface SurahData {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  total_verses: number;
  verses: Verse[];
}

export interface TranslationSurahData {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  total_verses: number;
  verses: TranslationVerse[];
}

export interface PageSection {
  surah: number;
  surahName: string;
  transliteration: string;
  totalVerses: number;
  showHeader: boolean;
  showBismillah: boolean;
  verses: Verse[];
}

export interface MushafPageData {
  page: number;
  totalPages: number;
  sections: PageSection[];
}

// ── QPC Mushaf (15-line pixel-perfect) ──

export interface MushafWord {
  location: string;   // "surah:ayah:word" e.g. "2:25:1"
  word: string;        // Unicode Arabic text (for accessibility/search)
  qpc: string;         // QPC V1 glyph for font rendering
}

export interface MushafLine {
  line: number;
  type: 'text' | 'surah-header' | 'basmala';
  text?: string;
  qpc?: string;
  verseRange?: string;
  surah?: string;
  words?: MushafWord[];
}

export interface MushafPageDataV2 {
  page: number;
  lines: MushafLine[];
}

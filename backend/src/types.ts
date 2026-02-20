export type Bindings = {
  QURAN_CACHE: KVNamespace;
  DB: D1Database;
};

export type AppEnv = {
  Bindings: Bindings;
};

export interface SurahMeta {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
}

export interface Verse {
  id: number;
  verse: number;
  text: string;
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

export interface TranslationVerse {
  id: number;
  verse: number;
  text: string;
  translation: string;
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

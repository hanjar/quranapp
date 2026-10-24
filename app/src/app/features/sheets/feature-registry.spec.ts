import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  FeatureEnv,
  availableFeatures,
  popularFeatures,
  searchFeatures,
} from './feature-registry';

const ALL: FeatureEnv = {
  installable: true,
  audioOffline: true,
  sync: true,
  wakeLock: true,
  doa: true,
  tafsirIk: true,
};
const NONE: FeatureEnv = {
  installable: false,
  audioOffline: false,
  sync: false,
  wakeLock: false,
  doa: false,
  tafsirIk: false,
};
const ids = (q: string, env: FeatureEnv = ALL) => searchFeatures(q, env).map((f) => f.id);

describe('feature registry', () => {
  it('has unique ids and complete entries', () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    for (const f of FEATURES) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.keywords.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['install', 'install'],
    ['pasang aplikasi', 'install'],
    ['home screen', 'install'],
    ['instal', 'install'],
    ['unduh', 'offline-pages'],
    ['tafsir offline', 'offline-tafsir'],
    ['simpan tafsir', 'offline-tafsir'],
    ['penjelasan', 'offline-tafsir'],
    ['download offline', 'offline-pages'],
    ['kertas', 'paper-theme'],
    ['gelap', 'paper-theme'],
    ['layar menyala', 'wake'],
    ['sleep', 'wake'],
    ['murottal', 'audio-mode'],
    ['qari', 'audio-mode'],
    ['terjemahan', 'translation-mode'],
    ['translation', 'translation-mode'],
    ['latin', 'latin'],
    ['login', 'account'],
    ['sinkron', 'account'],
    ['feedback', 'feedback'],
    ['laporkan bug', 'feedback'],
    ['pembaruan', 'update'],
    ['tutorial', 'tour'],
    ['ekspor', 'export'],
    ['backup', 'export'],
    ['khatam', 'bookmarks-manage'],
    ['khatam', 'progress'],
    ['khatam', 'doa-khatam'],
    ['doa khatam', 'doa-khatam'],
    ['khataman', 'doa-khatam'],
    ['khotmil', 'doa-khatam'],
    ['doa selesai baca quran', 'doa-khatam'],
    ['statistik', 'progress'],
    ['target', 'progress'],
    ['riwayat', 'progress'],
    ['catat progres', 'progress-track'],
    ['hapus riwayat', 'progress-clear'],
    ['dua halaman', 'layout'],
    ['kontras', 'contrast'],
    ['mode malam', 'night'],
    ['gelap', 'night'],
    ['dark', 'night'],
    ['hitam', 'night'],
    ['animasi', 'motion'],
    ['garis bantu', 'line-rules'],
    ['pemisah', 'line-rules'],
    ['ukuran', 'font-larger'],
  ])('"%s" finds %s', (q, id) => {
    expect(ids(q)).toContain(id);
  });

  it('doa khatam opens its own page', () => {
    const e = FEATURES.find((x) => x.id === 'doa-khatam');
    expect(e?.action).toEqual({ type: 'url', url: '/doa-khatam' });
  });

  it('tolerates a typo on longer words', () => {
    expect(ids('terjemahn')).toContain('translation-mode');
    expect(ids('sinkronsasi')).toContain('account');
  });

  it('hides features that do not apply', () => {
    expect(ids('install', NONE)).not.toContain('install');
    expect(ids('audio offline', NONE)).not.toContain('offline-audio');
    expect(ids('login', NONE)).not.toContain('account');
    expect(ids('layar menyala', NONE)).not.toContain('wake');
    expect(availableFeatures(NONE).length).toBe(FEATURES.length - 7);
    expect(ids('ibnu katsir', NONE)).not.toContain('tafsir-ibnu-katsir');
    expect(ids('doa khatam', NONE)).not.toContain('doa-khatam');
    expect(ids('sembunyikan doa', NONE)).toContain('doa-khatam-show');
  });

  it('finds favorites and the khatam archive', () => {
    expect(ids('favorit')).toContain('favorites');
    expect(ids('tafsir')).toEqual(expect.arrayContaining(['tafsir-ibnu-katsir', 'tafsir-kemenag', 'offline-tafsir']));
    expect(ids('ibnu katsir')[0]).toBe('tafsir-ibnu-katsir');
    expect(ids('pengaturan')[0]).toBe('settings');
    expect(ids('zoom')).toContain('zoom');
    expect(ids('arsipkan penanda')).toContain('archive-bookmarks');
    expect(ids('selesai khatam')).toContain('archive-bookmarks');
  });

  it('ranks title matches first and returns nothing for gibberish', () => {
    expect(ids('warna kertas')[0]).toBe('paper-theme');
    expect(ids('qqqzzz')).toEqual([]);
    expect(ids('')).toEqual([]);
  });

  it('popular list respects availability', () => {
    expect(popularFeatures(ALL).length).toBeGreaterThan(0);
    expect(popularFeatures({ ...ALL, installable: false }).map((f) => f.id)).not.toContain(
      'install',
    );
  });
});

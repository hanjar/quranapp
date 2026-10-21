import { AUDIO_MODE_IDS, AudioMode, PAGE_RENDERER_IDS, PageRendererId, Preferences, snapScale } from '../models';

/** localStorage keys that held these settings before they became synced preferences. */
export const LEGACY_KEYS = {
  lineRules: 'mf-line-rules',
  showLatin: 'mf-tr-latin',
  translationScale: 'mf-tr-size',
  audioMode: 'mf-audio-mode',
  audioFollow: 'mf-audio-follow',
  pageRenderer: 'mf-page-renderer',
} as const;

export type MigratedPrefs = Pick<
  Preferences,
  'lineRules' | 'showLatin' | 'translationScale' | 'audioMode' | 'audioFollow' | 'pageRenderer'
>;

/** Reads the legacy device-local values that are present and valid. Never throws. */
export function readLegacyDevicePrefs(
  read: (key: string) => string | null = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
): Partial<MigratedPrefs> {
  const out: Partial<MigratedPrefs> = {};
  const line = read(LEGACY_KEYS.lineRules);
  if (line === 'on' || line === 'off') out.lineRules = line === 'on';
  const latin = read(LEGACY_KEYS.showLatin);
  if (latin === '1' || latin === '0') out.showLatin = latin === '1';
  const size = read(LEGACY_KEYS.translationScale);
  if (size !== null && Number.isFinite(Number(size))) out.translationScale = snapScale(size);
  const mode = read(LEGACY_KEYS.audioMode);
  if (mode !== null && AUDIO_MODE_IDS.includes(mode as AudioMode)) out.audioMode = mode as AudioMode;
  const follow = read(LEGACY_KEYS.audioFollow);
  if (follow === '1' || follow === '0') out.audioFollow = follow === '1';
  const renderer = read(LEGACY_KEYS.pageRenderer);
  if (renderer !== null && PAGE_RENDERER_IDS.includes(renderer as PageRendererId))
    out.pageRenderer = renderer as PageRendererId;
  return out;
}

/**
 * Only fields the stored prefs row has never held are adopted, so a value that already
 * exists (e.g. pulled from another device) is never overwritten by a stale local one.
 */
export function devicePrefsMigrationPatch(
  storedRow: Record<string, unknown> | undefined,
  legacy: Partial<MigratedPrefs>,
): Partial<MigratedPrefs> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (storedRow?.[k] === undefined) patch[k] = v;
  }
  return patch as Partial<MigratedPrefs>;
}

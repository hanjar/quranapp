/*
 * Build identity, injected at build time by scripts/build.mjs through esbuild
 * `--define`. Under `ng serve` / tests nothing is defined and we report "dev".
 */
declare const MF_APP_VERSION: string | undefined;
declare const MF_BUILD_SHA: string | undefined;
declare const MF_BUILD_TIME: string | undefined;

export interface BuildInfo {
  /** Semantic version from app/package.json. */
  version: string;
  /** Short git commit (with "-dirty" when built from uncommitted changes), or "dev". */
  sha: string;
  /** ISO timestamp of the build, or null in dev. */
  builtAt: string | null;
}

export const BUILD_INFO: BuildInfo = {
  version: typeof MF_APP_VERSION === 'string' ? MF_APP_VERSION : '0.0.0-dev',
  sha: typeof MF_BUILD_SHA === 'string' ? MF_BUILD_SHA : 'dev',
  builtAt: typeof MF_BUILD_TIME === 'string' ? MF_BUILD_TIME : null,
};

/** "v0.2.0 · 9118c86" — short label for settings rows and support requests. */
export function buildLabel(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version} · ${info.sha}`;
}

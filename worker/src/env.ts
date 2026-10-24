export interface Env {
  DB: D1Database;
  /** Public origin of the app (and of this API, same-origin), e.g. https://mushaf.example.com */
  APP_ORIGIN: string;
  /** "1" enables POST /auth/dev-login. Must be "0"/unset in production. */
  DEV_AUTH?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "owner/repo" receiving feedback issues. */
  GITHUB_REPO?: string;
  /** Secret: fine-grained PAT with Issues read/write on GITHUB_REPO only. */
  GITHUB_TOKEN?: string;
  /** Private R2 bucket (tafsir files). */
  TAFSIR?: R2Bucket;
  /** Secret: comma-separated emails allowed to read the private tafsir. */
  TAFSIR_EMAILS?: string;
}

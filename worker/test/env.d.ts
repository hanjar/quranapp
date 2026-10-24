import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      APP_ORIGIN: string;
      DEV_AUTH?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      GITHUB_REPO?: string;
      GITHUB_TOKEN?: string;
      TAFSIR?: R2Bucket;
      TAFSIR_EMAILS?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

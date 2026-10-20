export interface Env {
  DB: D1Database;
  /** Public origin of the app (and of this API, same-origin), e.g. https://mushaf.example.com */
  APP_ORIGIN: string;
  /** "1" enables POST /auth/dev-login. Must be "0"/unset in production. */
  DEV_AUTH?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

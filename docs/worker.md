# Mushaf API (Cloudflare Worker)

Optional sync backend in `worker/` (TypeScript, Hono, D1). The reader works fully offline/anonymous;
this Worker only handles login and cloud sync of bookmarks, reading position and preferences.

It is served **same-origin** under `/api/*` of the app's domain (no CORS). Base path: `/api/v1`.
All responses use the envelope `{ success, data?, error?: {code, message}, meta? }`.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | no | `{ok:true}`; no DB access, no rate limit |
| GET | `/me` | optional | `data.user` = `{id,email,name}` or `null` |
| GET | `/auth/google/start?return=/path` | no | 302 to Google (auth-code + PKCE S256 + state + nonce). `return` must be a same-origin relative path (`//`, schemes, backslashes rejected -> `/`) |
| GET | `/auth/google/callback` | no | validates state, exchanges code, verifies the id_token, sets `mf_session`, 302 to `return?sync=connected` (`sync=error` / `sync=denied` on failure) |
| POST | `/auth/dev-login` `{email}` | no | **404 unless `DEV_AUTH="1"`**. Local development only |
| POST | `/auth/logout` | no | deletes the session, clears cookie |
| GET | `/sync?cursor=&limit=` | yes | changes with `rev > cursor`, ordered by rev. `limit` default 200, max 500 |
| POST | `/sync/batch` `{ops}` | yes | <= 100 ops, body <= 256 KB |
| GET | `/export` | yes | all live cloud data of the account |
| DELETE | `/me/data` | yes | hard-deletes the user, all rows and all sessions; clears the cookie |

Every non-GET request needs `X-Mushaf-Client: 1`. If an `Origin` header is present (any method) it must
equal `APP_ORIGIN`, otherwise 403.

### Sync contract

`Change = {entity:'bookmark'|'position'|'prefs', id, rev, deleted, data|null}`. `GET /sync` returns
`{changes, cursor, hasMore, reset}`. When `hasMore` is false, `cursor` is the user's latest revision seen in
the same read; store it and send it next time.

`reset:true`: the cursor is older than purged tombstones (or ahead of the server, e.g. the account was
deleted and recreated). The response is then a **complete snapshot of live data in one response**
(no pagination, `hasMore:false`, tombstones omitted). The client must replace its synced mirror with it
(local deletions that were never synced stay in the outbox). Cursor `0` never resets.

`POST /sync/batch` -> `{results:[{opId,status,rev?,current?,error?}], cursor}`. `cursor` is informational
(the user's revision after the batch); do not use it to advance the pull cursor unless caught up.

| Case | Result |
|---|---|
| New op | `applied` + `rev` (one new revision per applied op) |
| Same `opId` again (per user) | the stored first result, verbatim; no side effects |
| Bookmark with a semantic key already active under another id | `duplicate` + `current` (server bookmark) |
| Bookmark edit with `baseRev` != server rev (or `baseRev` null on an existing id) | `conflict` + `current` |
| Edit of a deleted bookmark | `conflict` + `current` (tombstone, `deleted:true`) |
| Create reusing a deleted id | `rejected` (`id_deleted`): re-adding must use a new id |
| Bookmark delete | tombstone, applied regardless of `baseRev` (delete beats stale edit); deleting an unknown/already-deleted id is a no-op `applied` |
| Position upsert (entityId = editionId) | always `applied`, new rev |
| Prefs upsert (entityId = `prefs`) | LWW by rev: stale `baseRev` -> `conflict` + `current` |
| Invalid payload / bad id / unknown entity | `rejected` + `error` (the batch still succeeds) |
| > 100 ops | HTTP 400 `too_many_ops` |

Bookmark semantic key is derived by the server (`<edition>|verse|<surah>:<ayah>` or `<edition>|page|<page>`);
a client-supplied `key` is ignored. A user may hold at most 5000 live bookmarks.
Preference enums are validated against `paperTheme` photo|ivory|antique, `uiTheme`
klasik|segar|ceria|samudra, `layoutMode` auto|single|spread, `motion` system|reduce; extend
`worker/src/validate.ts` together with `app/src/app/core/models.ts`.

Atomicity: a batch is simulated in memory from one read round trip, then written in a single D1 `batch()`
(one transaction). It starts with a compare-and-swap on the per-user revision counter; every other statement
is guarded on that bump, so a concurrent writer of the same user makes the whole attempt a no-op and the
server re-reads and retries (up to 3 times, then 503 `busy` + `Retry-After`).

## Data and retention

Schema: `worker/migrations/0001_init.sql` (users, sessions, oauth_states, user_revisions, bookmarks,
reading_progress, preferences, op_log, rate_limits). Every table is scoped by `user_id`, which always comes
from the session, never from the request body. SQL is parameterized (`json_each` is used for ID lists).

Retention (daily cron `17 3 * * *` UTC, `runCleanup`):
- **Tombstones: 180 days.** After purge the user's `tombstone_horizon` is raised to the highest purged
  rev; older cursors then receive `reset:true`.
- Idempotency log (`op_log`): 90 days. Expired sessions and OAuth states: removed. Rate-limit rows: 1 hour.
- Sessions: 30 days, sliding (touched at most once per hour).

## Auth and security

- Google OIDC: authorization code + PKCE (S256) + server-side `state` (10 min, single use) + `nonce`, plus
  an `mf_oauth` cookie binding the flow to the browser (anti login-CSRF). The id_token is verified with
  WebCrypto against Google's JWKS (cached 1 h, refetched on unknown `kid`): RS256, `iss`, `aud`=client id,
  `exp`, `nonce`, `email_verified`.
- Session cookie `mf_session` = 32 random bytes, base64url; only its SHA-256 is stored. `HttpOnly`,
  `SameSite=Lax`, `Path=/api`, `Secure` (omitted only for `http://localhost`).
- Rate limits (D1 fixed 60 s window; 429 + `Retry-After`): 120/min per session, 60/min per IP when anonymous,
  10/min per IP on `/auth/*`. `/health` is exempt.
- All responses: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  CSP `default-src 'none'`. Errors never include SQL or stack details.

## Deploy

```bash
cd worker
npx --yes npm@11 install
npx wrangler login
npx wrangler d1 create mushaf          # copy database_id into wrangler.toml
npm run migrate:remote                 # apply migrations
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# set APP_ORIGIN in wrangler.toml [vars] to the public origin, e.g. https://mushaf.example.com
# add the route (Pages custom domain must be on the same zone):
#   routes = [{ pattern = "mushaf.example.com/api/*", zone_name = "example.com" }]
npm run deploy
```

Keep `DEV_AUTH = "0"` in production. Google Cloud console -> OAuth client (Web application):
- Authorized redirect URI: `https://<your-domain>/api/v1/auth/google/callback`
  (for local dev with the Angular proxy: `http://localhost:4200/api/v1/auth/google/callback`).
- Scopes: `openid email profile`.

## Local development

```bash
cp .dev.vars.example .dev.vars   # APP_ORIGIN=http://localhost:4200, DEV_AUTH=1
npm run migrate:local
npm run dev                      # http://127.0.0.1:8788, base /api/v1
```

`app/proxy.conf.json` forwards `/api` to port 8788. Use `POST /api/v1/auth/dev-login {"email":"me@x.co"}`
(with `X-Mushaf-Client: 1`) instead of Google. Never commit `.dev.vars`.

Scripts: `npm test` (Vitest + `@cloudflare/vitest-plugin`, Miniflare D1, migrations applied in setup),
`npm run typecheck`, `npm run migrate:local|migrate:remote`, `npm run deploy`.

## Cost caveat

Cloudflare Workers and D1 have free allowances, but quotas and pricing change and are not guaranteed:
check current limits before launch. Notes: every API request does one D1 write for rate limiting, and the
free plan caps D1 queries per Worker invocation (a sync batch uses about 5) and daily rows written. No promise
of zero cost is made; heavy use may require the paid plan.

## Package note

`@cloudflare/vitest-pool-workers` is deprecated upstream and renamed `@cloudflare/vitest-plugin`; this
package uses the latter (same API: `cloudflareTest`, `readD1Migrations`, `applyD1Migrations`).

## Folders and notes (migration `0002_folders_notes.sql`)

- Entity `folder` (`entityId` = folder id): upsert payload `{name, createdAt, updatedAt}`; delete = tombstone
  (180-day retention like bookmarks). `Change.data` = `{name, createdAt, updatedAt}`.
  Name is trimmed, 1-40 characters, unique per user among active folders case-insensitively
  (`rejected` / `folder_name_taken`); max 100 active folders (`rejected` / `limit_reached`).
  Stale `baseRev` -> `conflict` + `current`. Deleting a folder does not cascade: clients send the bookmark
  moves/deletes themselves.
- Bookmarks gain `folderId` (string <= 64 or null; may point to an unknown folder) and `note` (<= 500 chars or
  null). Missing fields from older clients are stored as null.
- `GET /export` (`folders`) and `reset:true` snapshots include folders. Apply with `npm run migrate:remote`.

## Feedback -> GitHub Issues (`POST /api/v1/feedback`, migration `0003_feedback.sql`)

Anonymous (no login). Same CSRF/Origin rules as other POSTs; JSON body <= 16 KB.
Request: `{category: saran|bug|konten|lainnya, message (10-2000 chars after trim), context: null | {appVersion<=20,
build<=20, page 1-604|null, path<=100, userAgent<=200, paperTheme<=20, uiTheme<=20, layout<=20, online, standalone},
website: ""}`. `website` is a honeypot: if non-empty the Worker answers 200 and does nothing (not counted).

Success `{issueNumber, issueUrl}`. Errors: 400 `invalid_input`, 413, 429 `rate_limited` (+`Retry-After`),
503 `feedback_unavailable` (no `GITHUB_TOKEN`/`GITHUB_REPO`), 502 `github_error` (GitHub failed or unreachable).

- The Worker creates the issue via the GitHub REST API: title `[Saran|Bug|Koreksi konten|Lainnya] <first ~60 chars>`,
  labels `feedback` and `feedback:<category>`, body = quoted message + "Konteks" table + footer.
  The repository is public, so issues are public. User text is neutralised: `@` gets a zero-width space (no pings),
  `#123` likewise (no cross-references), `& < >` are escaped, control characters stripped, 4+ blank lines collapsed.
  The body never contains IP, cookies, session or account data.
- Rate limit per IP: 5 per hour and 20 per day, counted only for accepted (valid, non-honeypot) submissions.
- Audit table `feedback(id, created_at, category, issue_number, ip_hash)`: `ip_hash` = first 32 hex of
  sha256(`ip|UTC-date`), no message text; purged after 90 days by the daily cron.
- The token and message text are never logged.

Create the token (GitHub -> Settings -> Developer settings -> Fine-grained personal access tokens):
resource owner = the repo owner, **Only select repositories** = `hanjar/quranapp`, repository permission
**Issues: Read and write** (nothing else; Metadata read-only is added automatically), set an expiry and note it.
Then:

```bash
cd worker
npx wrangler secret put GITHUB_TOKEN     # paste the token
# GITHUB_REPO is a plain var in wrangler.toml ("hanjar/quranapp")
npm run migrate:remote                   # applies 0003_feedback.sql
npm run deploy
```

Create the labels `feedback`, `feedback:saran`, `feedback:bug`, `feedback:konten`, `feedback:lainnya` in the repo
(GitHub also auto-creates missing labels when the token may do so; otherwise issues are created without them).

## Reading progress (migration `0004_progress.sql`)

Two more sync entities, both behind the same `/sync` + `/sync/batch` contract:

- `readday` (entityId = local calendar day `YYYY-MM-DD`; payload `{day, pages:{"<1-604>":[firstAt,lastAt,removedAt?]}, updatedAt}`).
  **Per-component merge, not last-writer-wins**: per page min(firstAt)/max(lastAt)/max(removedAt) against the stored
  row, so two devices reading the same day both count. A page counts while `lastAt > removedAt` (client-side rule), so
  "remove from day" is just an upload with `removedAt` and a later read re-adds it. Entries are 2 or 3 numbers
  (`removedAt` a non-negative integer timestamp, else `rejected`); the pages column is JSON, so no migration. No `baseRev`, never `conflict`. A merge that changes nothing writes nothing and
  keeps the revision (no echo loops). Pull change data = merged `{day, pages, updatedAt}`.
- `khatam` (entityId = round uuid; payload `{n, startedAt, finishedAt|null, updatedAt}`): LWW with `baseRev`
  (stale = `conflict`), `n` unique among live rounds (`duplicate` + `current` otherwise), delete = tombstone.
- Clear history = op `{entity:'readday', entityId:'all', action:'delete'}`: tombstones every live day (page data wiped)
  and round, one fresh revision each, and sets `user_revisions.progress_cleared_at` (the clear watermark, server ms).
  Uploads of pages with `lastAt <= watermark` are dropped and rounds with `startedAt <= watermark` are rejected
  (`cleared_history`), so a stale device cannot resurrect cleared history. Day tombstone changes carry
  `data:{clearedAt}` so clients drop only older reads. Other deletes of `readday` are rejected.
- Limits: 2000 live days, 100 live rounds (`limit_reached`), `n` 1-1000.
- Prefs payload gained optional `dailyTarget` (int 1-40) and `trackProgress` (bool); omitted = leave unchanged.
- `/export` adds `readingDays` and `khatamRounds`; `DELETE /me/data` and the reset snapshot include both tables;
  daily cleanup purges their tombstones after 180 days and raises `tombstone_horizon`.

### Manual read marks (migration `0005_read_marks.sql`)
Entity `readmark` (entityId `"marks"`, payload `{marks:{"<1-604>":[markedAt, unmarkedAt]}, updatedAt}`) is one row per
user in `read_marks`. Writes merge per-component max (grow-only; a no-op merge writes nothing). Never conflicts,
cannot be deleted. `readday/all` clears it (marks `{}`, `cleared_at` set) and entries last touched at/before the
clear watermark are dropped on upload. Pull data: `{marks, updatedAt, clearedAt}`; also in `/export` (`readMarks`),
the reset snapshot (when non-empty) and `DELETE /me/data`. Dwell rule note: the 30 s page-dwell is client-side only.

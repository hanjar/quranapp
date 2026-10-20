# Sync client (`app/src/app/core/sync/`)

Optional, local-first cloud sync. `SyncService` (binds to `SyncApi`) drains the Dexie `outbox`
written by `UserDataService` and applies server changes back into Dexie; the app never waits on it.
`available = APP_CONFIG.syncEnabled`.

## Files
| File | Role |
|---|---|
| `sync.service.ts` | `SyncService`: signals (`status`, `account`, `lastSuccessAt`, `conflict`), triggers, cycle, account handling |
| `sync-api-client.ts` | `SyncApiClient` fetch wrapper (`credentials: same-origin`, `X-Mushaf-Client: 1`, envelope parsing, `SyncHttpError` kinds `network / unauthorized / rate-limited / server / client / protocol`) |
| `apply.ts` | Dexie application of server data: `applyChanges` (pull), `handleResults` (batch results), `reconcileReset` (full reconciliation) |
| `outbox.ts` | op factory, wire mapping, payload builders, `enqueueLocalSnapshot` (first-link merge) |
| `backoff.ts` | exponential backoff, full jitter, base 2 s, cap 5 min, `Retry-After` floor |
| `sync-db.ts` | `SYNC_DB` injection token (default: shared `db`) |

## Cycle (single-flight; a request during a run schedules one follow-up)
1. cold start only: pull first with position-conflict detection (so our own position never overwrites the cloud one before the user chooses).
2. push: due ops (`nextAttemptAt <= now`) of the current `accountId`, oldest first, batches of 100.
   - `applied` -> set local `rev`, bump `baseRev` of later ops on the same entity.
   - `duplicate` -> delete the local bookmark id, adopt the server row (a queued local delete is re-targeted to the server id).
   - `conflict` -> apply `current` (server wins; a tombstone beats a stale edit).
   - `rejected` -> op dropped, `lastErrorCode = rejected:<error>`.
   - batch failure -> every op gets `retryCount+1` and `nextAttemptAt = now + backoff` (429 honours `Retry-After`; 401 leaves the outbox untouched).
3. pull `GET /sync` until `!hasMore`, persisting `cursor`. `reset:true` -> refetch from cursor 0 and reconcile: synced local rows absent remotely are deleted, unsynced rows are kept and re-enqueued.
4. `userData.reload()` when anything local changed; status `synced` / `pending` / `conflict`.

Apply rules: bookmarks upsert by id honouring `rev`, deduped by semantic `key`; tombstones win over pending upserts and are not resurrected while a local delete is in flight; prefs: server wins, but a *pending* local prefs edit is kept and its `baseRev` bumped (retry on top of current revision); `onboardingDone` is never overwritten.

## Reading position (PRD §13 rule 6)
Conflict only on the cold-start/first-link pull when the remote differs by page, `remote.updatedAt > local.updatedAt` and `remote.deviceId !== local deviceId`. Then `conflict` = `{device, cloud}`, status `conflict`, local position untouched, pending position ops cancelled, position ops held back from pushes, further remote positions ignored until resolved. Persisted in `meta['syncPositionConflict']` so it survives reloads. Later (active session) remote positions are stored silently and never navigate.
`resolveConflict('device')` enqueues the local position (baseRev = cloud rev); `'cloud'` writes the cloud position, reloads and calls `ReaderUiService.goToPage`.

## Triggers
`init()`, `?sync=connected` (stripped via `history.replaceState`), `signInDev`, `online`, `visibilitychange` -> visible (these two also re-verify the session via `GET /me`), `syncNow()`, and an 8 s debounce after outbox changes (`liveQuery`; delayed further to the earliest `nextAttemptAt`). Failed cycles schedule one retry timer; there is no polling and no Background Sync.

## Accounts & isolation
- Outbox ops are tagged with `accountId`; only the current account's ops are ever sent.
- `?sync=connected` / dev-login is the explicit link: state `{enabled, accountId, cursor:0}`, local bookmarks/prefs (if edited)/position are enqueued, then a cycle runs.
- Session user differs from `state.accountId` (init or later verification): `disableSync()` drops the old account's ops, resets cursor, nulls local revisions (data stays on device as anonymous), and nothing is uploaded unless the user signs in explicitly again.
- `signOut({clearLocal})` / `deleteCloudData()` also call `disableSync()`; `clearLocal` wipes bookmarks/positions/prefs. Tombstones are discarded when sync is disabled.
- `meta['syncAccount']` caches the account for display while offline/unauthorized.

## Folders (phase 2)
- `folder` changes: upsert by id honouring `rev`, tombstones. Bookmark changes/payloads carry `folderId`/`note` (missing -> null).
- Pulled folder whose name equals (case-insensitive) a different active *unsynced* local folder: server folder wins, local bookmarks are re-pointed to it (pending bookmark upserts patched; synced ones get a new upsert op), local twin is tombstoned and its ops dropped. Same merge on a `duplicate` result.
- `rejected` with `folder_name_taken`: op dropped, not recorded as an error. Reset reconciliation and first-link merge include folders (folder ops are enqueued before bookmark ops).

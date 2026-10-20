# Reading progress (`app/src/app/core/progress/`)

Automatic, local-first reading progress (Dexie v3: `readDays`, `rounds`) that syncs like bookmarks when signed in.
Wire/server rules: `docs/worker.md` ("Reading progress"), client sync rules: `docs/sync-client.md`.

## Data model
- `ReadDay {day:'YYYY-MM-DD' (device-local), pages: Record<pageString,[firstAt,lastAt]>, updatedAt, rev}`: grow-only,
  merge = union (`mergeReadPages` in `models.ts`, mirrored in `worker/src/sync.ts`).
- `KhatamRound {id, n, startedAt, finishedAt|null, updatedAt, rev}`. Open round = unfinished round with highest `n`.
  Pages read in the open round = pages with any `lastAt >= round.startedAt`. Round 1 starts at the first ever read.
- Preferences: `dailyTarget` (1-40, default 5) and `trackProgress` (default on); both synced prefs.

## Files
`progress-logic.ts` (pure: day helpers, juz ranges, round/juz/recent/ETA maths), `page-dwell-tracker.ts` (pure
tracker), `progress.service.ts` (`ProgressService`). Juz start pages are static (Madinah mushaf).

## Recording rules
A page counts after 20 s of continuous foreground time or when left after >= 8 s (`READ_FULL_MS`/`READ_MIN_MS`);
once per stay. `recordView` ignores views < 8 s, invalid pages and everything when `trackProgress` is off. Writes
go to Dexie immediately and to the outbox in the same transaction (coalesced per day, payload = whole day), so a
sync cycle (8 s debounce) uploads at most one op per day.

## Clear history
`clearHistory()` empties both tables and, when signed in, replaces pending progress ops with one `readday/all`
delete. It returns an undo (8 s window): restores rows, drops the unsent clear op; returns `false` once the op was
sent or the window passed. Cloud data cannot be restored after the op is sent.

## Limits
Clear watermark is server time vs. client timestamps: a device with a badly wrong clock may keep or lose a few reads.
Reads made on a device that never synced before a clear elsewhere stay on that device and upload afterwards.

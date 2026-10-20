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
A page counts only after `READ_DWELL_MS` = 30 s of continuous foreground time on it, once per stay; leaving
earlier, backgrounding or closing the reader counts nothing (pages flipped while searching are not counted).
`recordView` ignores views < 30 s, invalid pages and everything when `trackProgress` is off. Writes
go to Dexie immediately and to the outbox in the same transaction (coalesced per day, payload = whole day), so a
sync cycle (8 s debounce) uploads at most one op per day.

## Manual marks ("sudah dibaca")
`markRead(pages | {from,to}, {when})` returns `{added, pages, undo}`; it works even when tracking is off and
creates the open round if none exists.
- `when:'today'`: pages go into today's `ReadDay` with span `[now, now]`, so they count for todayCount, last7, the
  ETA pace and the round. Pages already in today's day are skipped. `undo` removes exactly those pages (and the
  round it created) while the day's op is unsent and within `CLEAR_UNDO_WINDOW_MS`; otherwise false.
- `when:'before'` (default): stored in the singleton `readMarks` row (`{marks: {page: [markedAt, unmarkedAt]}}`),
  count only for the round (`readInRound`, `markedPages`, percent, juzProgress, firstUnread, roundComplete),
  never for daily stats. A mark counts for the open round if `markedAt >= round.startedAt` and
  `markedAt > unmarkedAt`. Merge (client apply and server) = per-component max, so devices never lose marks and
  an unmark survives merging. `unmarkRead(pages)` sets `unmarkedAt`; `undo` calls it. Pages already read/marked in
  the round are skipped.
- `suggestFromBookmarks(): {upTo, source, unread} | null`: highest page bookmark or verse bookmark on the last
  ayah of its page (the "Akhir hal." rule, via `ContentApi.pageMeta`); round 1 uses all bookmarks, later rounds
  only bookmarks created since the round started; null if nothing below `upTo` is unread. Offer
  `markRead({from:1,to:upTo})`.
- Sync: entity `readmark` (entityId `marks`, payload `{marks, updatedAt}`), server table `read_marks`
  (migration `0005_read_marks.sql`, additive). Clear history wipes it too (server sets `cleared_at`, pull data
  carries `clearedAt`).

## Clear history
`clearHistory()` empties both tables and, when signed in, replaces pending progress ops with one `readday/all`
delete. It returns an undo (8 s window): restores rows, drops the unsent clear op; returns `false` once the op was
sent or the window passed. Cloud data cannot be restored after the op is sent.

## Limits
Clear watermark is server time vs. client timestamps: a device with a badly wrong clock may keep or lose a few reads.
Reads made on a device that never synced before a clear elsewhere stay on that device and upload afterwards.

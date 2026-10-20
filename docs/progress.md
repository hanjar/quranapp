# Reading progress (`app/src/app/core/progress/`)

Automatic, local-first reading progress (Dexie v3: `readDays`, `rounds`) that syncs like bookmarks when signed in.
Wire/server rules: `docs/worker.md` ("Reading progress"), client sync rules: `docs/sync-client.md`.

## Data model
- `ReadDay {day:'YYYY-MM-DD' (device-local), pages: Record<pageString,[firstAt,lastAt,removedAt?]>, updatedAt, rev}`.
  Merge = per page min(firstAt), max(lastAt), max(removedAt) (`mergeReadPages` in `models.ts`, mirrored in
  `worker/src/sync.ts`). A page counts on its day only while `lastAt > removedAt` (`spanActive`), so a removal
  syncs and a later real read re-adds the page. 2-element entries (never removed) stay valid; removed entries stay
  as tombstones (max 604 per day). All stats (todayCount, last7, recent, round, ETA) ignore removed pages.
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
`markRead(pages | {from,to}, {when, day?})` returns `{added, pages, undo, error?}`; it works even when tracking is off and
creates the open round if none exists.
- `when:'today'`: pages go into today's `ReadDay` with span `[now, now]`, so they count for todayCount, last7, the
  ETA pace and the round. Pages already in today's day are skipped. `undo` removes exactly those pages (and the
  round it created) while the day's op is unsent and within `CLEAR_UNDO_WINDOW_MS`; otherwise false.
- `when:'day'` + `day:'YYYY-MM-DD'`: same as today but for a chosen local day, from 30 days ago up to today (never the
  future; else `error`, nothing written). Timestamp of those pages = that day 12:00 local (both firstAt/lastAt; today = now),
  so they count for that day's bar, last7, ETA pace and the round. A day before the open round's start moves round 1's
  `startedAt` back to that noon (khatam op queued); for round 2+ it is refused (`error`). A removed page marked again
  gets `lastAt = max(stamp, removedAt+1)` so it counts again.
- `unmarkDay(day, pages|{from,to})` -> `{removed, pages, undo}`: sets `removedAt = max(now, lastAt)` on pages that count
  that day (any day). `undo` (8 s) restores them. `moveDay(from, to, pages)` -> `{moved, pages, undo, error?}`:
  marks on `to` (same rules as above), then removes from `from`; nothing is removed if the mark is refused.
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

## UI (progress sheet)
"Tandai sudah dibaca": Hari ini / Kemarin / Pilih tanggal (date input, last 30 days) / Sebelumnya (tidak masuk grafik);
default Hari ini for <= 40 pages. The 7-day bars are buttons: tapping one opens a panel for that day (pages as compact
ranges "519–536, 540"), with "Hapus dari hari ini..." (range -> unmarkDay) and "Pindahkan ke tanggal..." (date + range
-> moveDay); both toast with Urungkan. The hidden table alternative remains.

## Clear history
`clearHistory()` empties both tables and, when signed in, replaces pending progress ops with one `readday/all`
delete. It returns an undo (8 s window): restores rows, drops the unsent clear op; returns `false` once the op was
sent or the window passed. Cloud data cannot be restored after the op is sent.

## Limits
Clear watermark is server time vs. client timestamps: a device with a badly wrong clock may keep or lose a few reads.
Reads made on a device that never synced before a clear elsewhere stay on that device and upload afterwards.

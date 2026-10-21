import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runCleanup } from '../src/housekeeping';
import { json, makeClient, prefsPayload, uid } from './helpers';

const { call, login } = makeClient();

async function batch(cookie: string, ops: unknown[]) {
  const res = await call('POST', '/sync/batch', { cookie, body: { ops } });
  return (await json(res)).data.results as any[];
}
async function pull(cookie: string, qs = '') {
  return (await json(await call('GET', `/sync${qs}`, { cookie }))).data;
}

type Pages = Record<string, [number, number] | [number, number, number]>;
const dayOp = (day: string, pages: Pages, over: Record<string, unknown> = {}) => ({
  opId: uid(),
  entity: 'readday',
  entityId: day,
  action: 'upsert',
  baseRev: null,
  payload: { day, pages, updatedAt: 1700000000000, ...over },
});
const clearOp = () => ({ opId: uid(), entity: 'readday', entityId: 'all', action: 'delete', baseRev: null });
const roundOp = (id: string, n: number, baseRev: number | null = null, over: Record<string, unknown> = {}) => ({
  opId: uid(),
  entity: 'khatam',
  entityId: id,
  action: 'upsert',
  baseRev,
  payload: { n, startedAt: 1700000000000, finishedAt: null, updatedAt: 1700000000000, ...over },
});

const T = Date.now() + 10_000; // reads "in the future" survive any clear made during the test

describe('readday: union merge', () => {
  it('creates, merges two devices by per-page min(first)/max(last) and replays idempotently', async () => {
    const cookie = await login('a@x.co');
    const a = dayOp('2026-10-20', { '5': [T + 100, T + 200], '6': [T + 300, T + 400] });
    expect((await batch(cookie, [a]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    expect((await batch(cookie, [a]))[0]).toMatchObject({ status: 'applied', rev: 1 }); // replay
    const b = dayOp('2026-10-20', { '6': [T + 250, T + 500], '7': [T + 600, T + 700] });
    expect((await batch(cookie, [b]))[0]).toMatchObject({ status: 'applied', rev: 2 });
    const s = await pull(cookie);
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0]).toMatchObject({ entity: 'readday', id: '2026-10-20', rev: 2, deleted: false });
    expect(s.changes[0].data.pages).toEqual({
      '5': [T + 100, T + 200],
      '6': [T + 250, T + 500],
      '7': [T + 600, T + 700],
    });
  });

  it('a no-op merge neither writes nor bumps the revision', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [dayOp('2026-10-20', { '5': [T + 100, T + 900] })]);
    const again = (await batch(cookie, [dayOp('2026-10-20', { '5': [T + 200, T + 300] })]))[0];
    expect(again).toMatchObject({ status: 'applied', rev: 1 });
    expect((await pull(cookie, '?cursor=1')).changes).toEqual([]);
  });

  it('validates payloads and entityId', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [
      dayOp('2026-02-30', { '5': [1, 2] }), // not a calendar day
      dayOp('2026-10-20', {}), // empty
      dayOp('2026-10-20', { '605': [1, 2] }),
      dayOp('2026-10-20', { '0': [1, 2] }),
      dayOp('2026-10-20', { '05': [1, 2] }),
      dayOp('2026-10-20', { '5': [9, 2] }), // first > last
      dayOp('2026-10-20', { '5': [1] as any }),
      { ...dayOp('2026-10-21', { '5': [1, 2] }), entityId: '2026-10-22' },
      dayOp('2026-10-20', { '5': [1, 2] }, { updatedAt: -1 }),
      dayOp('2026-10-20', { '5': [1, 2] }),
    ]);
    expect(r.map((x) => x.status)).toEqual([
      'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'applied',
    ]);
  });

  it('only "all" can be deleted', async () => {
    const cookie = await login('a@x.co');
    const del = { ...clearOp(), entityId: '2026-10-20' };
    expect((await batch(cookie, [del]))[0]).toMatchObject({ status: 'rejected' });
  });

  it('caps active days at 2000', async () => {
    const cookie = await login('a@x.co');
    const stmts = Array.from({ length: 2000 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      return env.DB.prepare('INSERT INTO reading_days (user_id, day, pages, updated_at, rev) VALUES ((SELECT id FROM users LIMIT 1), ?1, ?2, 1, 0)').bind(d, '{"1":[1,2]}');
    });
    for (let i = 0; i < stmts.length; i += 500) await env.DB.batch(stmts.slice(i, i + 500));
    const over = (await batch(cookie, [dayOp('2026-10-20', { '5': [T, T + 1] })]))[0];
    expect(over).toMatchObject({ status: 'rejected', error: 'limit_reached' });
  });

  it('is isolated per user', async () => {
    const a = await login('a@x.co');
    const b = await login('b@x.co');
    await batch(a, [dayOp('2026-10-20', { '5': [T, T + 1] })]);
    expect((await pull(b)).changes).toEqual([]);
    expect((await json(await call('GET', '/export', { cookie: b }))).data.readingDays).toEqual([]);
  });
});

describe('readday: page removal (removedAt)', () => {
  it('syncs a removal, keeps old 2-element entries, merges per-component max and lets a later read re-add', async () => {
    const cookie = await login('rm@x.co');
    await batch(cookie, [dayOp('2026-10-21', { '519': [T + 100, T + 100], '520': [T + 100, T + 100] })]);
    // device B removes 519 (removedAt after lastAt)
    const rm = (await batch(cookie, [dayOp('2026-10-21', { '519': [T + 100, T + 100, T + 500] })]))[0];
    expect(rm).toMatchObject({ status: 'applied', rev: 2 });
    let s = await pull(cookie);
    expect(s.changes[0].data.pages).toEqual({ '519': [T + 100, T + 100, T + 500], '520': [T + 100, T + 100] });
    // a stale device re-uploading the old 2-element entry cannot undo the removal (no-op, no rev bump)
    const stale = (await batch(cookie, [dayOp('2026-10-21', { '519': [T + 100, T + 100] })]))[0];
    expect(stale).toMatchObject({ status: 'applied', rev: 2 });
    // a real read after the removal re-adds it (lastAt > removedAt), removedAt is kept
    const again = (await batch(cookie, [dayOp('2026-10-21', { '519': [T + 600, T + 700] })]))[0];
    expect(again).toMatchObject({ status: 'applied', rev: 3 });
    s = await pull(cookie, '?cursor=2');
    expect(s.changes[0].data.pages['519']).toEqual([T + 100, T + 700, T + 500]);
  });

  it('validates removedAt', async () => {
    const cookie = await login('rm2@x.co');
    for (const bad of [[T, T, -1], [T, T, 1.5], [T, T, 'x'], [T, T, T, T]]) {
      const r = (await batch(cookie, [dayOp('2026-10-21', { '5': bad as any })]))[0];
      expect(r.status).toBe('rejected');
    }
    expect((await batch(cookie, [dayOp('2026-10-21', { '5': [T, T, T + 1] })]))[0].status).toBe('applied');
  });
});

describe('readday/all: clear history', () => {
  it('tombstones days and rounds with a watermark and wipes page data', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [
      dayOp('2026-10-19', { '1': [T, T + 1] }),
      dayOp('2026-10-20', { '2': [T, T + 1] }),
      roundOp('r-1', 1),
    ]);
    const res = (await batch(cookie, [clearOp()]))[0];
    expect(res.status).toBe('applied');
    expect(res.rev).toBe(6);
    const s = await pull(cookie, '?cursor=3');
    expect(s.changes.map((c: any) => [c.entity, c.deleted, c.rev])).toEqual([
      ['readday', true, 4],
      ['readday', true, 5],
      ['khatam', true, 6],
    ]);
    expect(typeof s.changes[0].data.clearedAt).toBe('number');
    const rows = await env.DB.prepare('SELECT pages FROM reading_days').all<{ pages: string }>();
    expect(rows.results.every((r) => r.pages === '{}')).toBe(true);
    const exp = (await json(await call('GET', '/export', { cookie }))).data;
    expect(exp.readingDays).toEqual([]);
    expect(exp.khatamRounds).toEqual([]);
  });

  it('a stale device cannot resurrect cleared reads or rounds; newer reads are accepted', async () => {
    const cookie = await login('a@x.co');
    const before = Date.now() - 60_000;
    await batch(cookie, [dayOp('2026-10-20', { '1': [before, before + 10] }), roundOp('r-1', 1, null, { startedAt: before })]);
    await batch(cookie, [clearOp()]);
    // stale upload: ignored (applied, no new data)
    const stale = (await batch(cookie, [dayOp('2026-10-20', { '9': [before, before + 5] })]))[0];
    expect(stale.status).toBe('applied');
    expect((await pull(cookie, '?cursor=4')).changes).toEqual([]);
    const staleRound = (await batch(cookie, [roundOp('r-2', 1, null, { startedAt: before })]))[0];
    expect(staleRound).toMatchObject({ status: 'rejected', error: 'cleared_history' });
    // new reads resurrect the day row with only the new pages
    const fresh = (await batch(cookie, [dayOp('2026-10-20', { '1': [before, before + 10], '12': [T, T + 5] })]))[0];
    expect(fresh.status).toBe('applied');
    const ch = (await pull(cookie, '?cursor=4')).changes[0];
    expect(ch).toMatchObject({ entity: 'readday', id: '2026-10-20', deleted: false });
    expect(ch.data.pages).toEqual({ '12': [T, T + 5] });
    // a fresh round works and may reuse number 1 (the old one is tombstoned)
    expect((await batch(cookie, [roundOp('r-3', 1, null, { startedAt: T })]))[0].status).toBe('applied');
  });

  it('clear is idempotent on replay and with nothing to clear', async () => {
    const cookie = await login('a@x.co');
    const op = clearOp();
    expect((await batch(cookie, [op]))[0].status).toBe('applied');
    expect((await batch(cookie, [op]))[0].status).toBe('applied');
    expect((await pull(cookie)).changes).toEqual([]);
  });

  it('clears more than one chunk of days with unique revisions', async () => {
    const cookie = await login('a@x.co');
    const days = Array.from({ length: 250 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
    for (let i = 0; i < days.length; i += 100) {
      await batch(cookie, days.slice(i, i + 100).map((d) => dayOp(d, { '3': [T, T + 1] })));
    }
    await batch(cookie, [clearOp()]);
    const s = await pull(cookie, '?cursor=250&limit=500');
    expect(s.changes).toHaveLength(250);
    expect(new Set(s.changes.map((c: any) => c.rev)).size).toBe(250);
    expect(s.changes.every((c: any) => c.deleted)).toBe(true);
  });
});

describe('khatam rounds', () => {
  it('creates, finishes (LWW with baseRev), conflicts on stale baseRev', async () => {
    const cookie = await login('a@x.co');
    expect((await batch(cookie, [roundOp('r-1', 1)]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    expect((await batch(cookie, [roundOp('r-1', 1, 1, { finishedAt: 1700000999000 })]))[0]).toMatchObject({ status: 'applied', rev: 2 });
    const stale = (await batch(cookie, [roundOp('r-1', 1, 1, { finishedAt: 1700000555000 })]))[0];
    expect(stale.status).toBe('conflict');
    expect(stale.current.data).toMatchObject({ n: 1, finishedAt: 1700000999000 });
    expect((await batch(cookie, [roundOp('r-1', 1, null)]))[0].status).toBe('conflict');
  });

  it('same number under another id is a duplicate with the server round as current', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [roundOp('r-1', 1)]);
    const dup = (await batch(cookie, [roundOp('r-2', 1)]))[0];
    expect(dup.status).toBe('duplicate');
    expect(dup.current).toMatchObject({ entity: 'khatam', id: 'r-1' });
    expect((await batch(cookie, [roundOp('r-2', 2)]))[0].status).toBe('applied');
  });

  it('validates; deleted ids cannot be reused; unknown baseRev is not_found', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [
      roundOp('r-1', 0),
      roundOp('r-2', 1, null, { finishedAt: 5 }), // finished before start
      roundOp('r-3', 1, 4),
      roundOp('r-4', 1),
    ]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected', 'rejected', 'applied']);
    expect(r[2].error).toBe('not_found');
    const del = { opId: uid(), entity: 'khatam', entityId: 'r-4', action: 'delete', baseRev: 1 };
    expect((await batch(cookie, [del]))[0].status).toBe('applied');
    expect((await batch(cookie, [roundOp('r-4', 1)]))[0].status).toBe('rejected');
  });

  it('limits to 100 live rounds', async () => {
    const cookie = await login('a@x.co');
    const ops = Array.from({ length: 100 }, (_, i) => roundOp(`r-${i}`, i + 1));
    expect((await batch(cookie, ops)).every((x) => x.status === 'applied')).toBe(true);
    // numbers are capped at 1000, so only the count limit can trip here
    expect((await batch(cookie, [roundOp('r-x', 500)]))[0]).toMatchObject({ status: 'rejected', error: 'limit_reached' });
  });
});

describe('progress with the rest of the account', () => {
  it('reset snapshot, export, tombstone cleanup and account deletion include progress', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [dayOp('2026-10-20', { '1': [T, T + 1] }), roundOp('r-1', 1)]);
    const snap = await pull(cookie, '?cursor=99');
    expect(snap.reset).toBe(true);
    expect(snap.changes.map((c: any) => c.entity).sort()).toEqual(['khatam', 'readday']);
    const exp = (await json(await call('GET', '/export', { cookie }))).data;
    expect(exp.readingDays).toEqual([{ rev: 1, day: '2026-10-20', pages: { '1': [T, T + 1] }, updatedAt: 1700000000000 }]);
    expect(exp.khatamRounds).toEqual([{ id: 'r-1', rev: 2, n: 1, startedAt: 1700000000000, finishedAt: null, updatedAt: 1700000000000 }]);

    await batch(cookie, [clearOp()]);
    await env.DB.prepare('UPDATE reading_days SET deleted_at = ?1').bind(Date.now() - 181 * 24 * 3600_000).run();
    await env.DB.prepare('UPDATE khatam_rounds SET deleted_at = ?1').bind(Date.now() - 181 * 24 * 3600_000).run();
    await runCleanup(env.DB, Date.now());
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM reading_days').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM khatam_rounds').first<{ n: number }>())!.n).toBe(0);
    const h = await env.DB.prepare('SELECT tombstone_horizon AS h FROM user_revisions').first<{ h: number }>();
    expect(h!.h).toBeGreaterThanOrEqual(4);
    // the clear watermark survives the purge
    const w = await env.DB.prepare('SELECT progress_cleared_at AS w FROM user_revisions').first<{ w: number }>();
    expect(w!.w).toBeGreaterThan(0);

    await batch(cookie, [dayOp('2026-10-21', { '1': [T, T + 1] })]);
    await call('DELETE', '/me/data', { cookie });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM reading_days').first<{ n: number }>())!.n).toBe(0);
  });

  it('prefs accept dailyTarget/trackProgress and stay valid without them', async () => {
    const cookie = await login('a@x.co');
    const pref = (baseRev: number | null, over: Record<string, unknown>) => ({
      opId: uid(), entity: 'prefs', entityId: 'prefs', action: 'upsert', baseRev, payload: prefsPayload(over),
    });
    expect((await batch(cookie, [pref(null, { dailyTarget: 12, trackProgress: false })]))[0].status).toBe('applied');
    expect((await pull(cookie)).changes[0].data).toMatchObject({ dailyTarget: 12, trackProgress: false });
    expect((await batch(cookie, [pref(1, {})]))[0].status).toBe('applied');
    const r = await batch(cookie, [pref(2, { dailyTarget: 0 }), pref(2, { dailyTarget: 41 }), pref(2, { dailyTarget: 2.5 }), pref(2, { trackProgress: 'yes' })]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
  });

  it('prefs accept nightMode and reject unknown values', async () => {
    const cookie = await login('a@x.co');
    const pref = (baseRev: number | null, over: Record<string, unknown>) => ({
      opId: uid(), entity: 'prefs', entityId: 'prefs', action: 'upsert', baseRev, payload: prefsPayload(over),
    });
    expect((await batch(cookie, [pref(null, { nightMode: 'auto', nightAuto: 'schedule', nightStart: '19:30', nightEnd: '04:45' })]))[0].status).toBe('applied');
    expect((await pull(cookie)).changes[0].data).toMatchObject({ nightMode: 'auto', nightAuto: 'schedule', nightStart: '19:30', nightEnd: '04:45' });
    const r = await batch(cookie, [pref(1, { nightMode: 'dark' }), pref(1, { nightMode: 5 }), pref(1, { nightAuto: 'sun' }), pref(1, { nightStart: '25:00' }), pref(1, { nightEnd: '5:00' })]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
  });

  it('prefs accept the former device-local settings and reject bad values', async () => {
    const cookie = await login('a@x.co');
    const pref = (baseRev: number | null, over: Record<string, unknown>) => ({
      opId: uid(), entity: 'prefs', entityId: 'prefs', action: 'upsert', baseRev, payload: prefsPayload(over),
    });
    const all = { lineRules: true, showLatin: true, translationScale: 1.3, audioMode: 'page', audioFollow: false, pageRenderer: 'qcf-tajweed' };
    expect((await batch(cookie, [pref(null, all)]))[0].status).toBe('applied');
    expect((await pull(cookie)).changes[0].data).toMatchObject(all);
    // older clients omit the fields: still valid, and the stored payload simply lacks them
    expect((await batch(cookie, [pref(1, {})]))[0].status).toBe('applied');
    const r = await batch(cookie, [
      pref(2, { lineRules: 'on' }), pref(2, { showLatin: 1 }), pref(2, { audioFollow: null }),
      pref(2, { translationScale: 1.2 }), pref(2, { translationScale: '1' }),
      pref(2, { audioMode: 'juz' }), pref(2, { pageRenderer: 'bogus' }),
    ]);
    expect(r.map((x) => x.status)).toEqual(Array(7).fill('rejected'));
  });

  it('prefs accept custom themes (and custom: paper ids) and reject malformed ones', async () => {
    const cookie = await login('a@x.co');
    const pref = (baseRev: number | null, over: Record<string, unknown>) => ({
      opId: uid(), entity: 'prefs', entityId: 'prefs', action: 'upsert', baseRev, payload: prefsPayload(over),
    });
    const theme = (id: string, over: Record<string, unknown> = {}) => ({
      id, name: 'Tema saya 1', paper: '#fffdf6', surround: '#f1e9d2', frameInk: '#AE3033',
      frameInkInner: '#d7c388', ayahOrnament: '#a07a2c', textInk: '#231f20', ...over,
    });
    expect((await batch(cookie, [pref(null, { paperTheme: 'custom:t1', customThemes: [theme('t1')] })]))[0].status).toBe('applied');
    const stored = (await pull(cookie)).changes[0].data;
    expect(stored.paperTheme).toBe('custom:t1');
    expect(stored.customThemes).toHaveLength(1);
    expect(stored.customThemes[0].frameInk).toBe('#ae3033');
    // an older client omits the field: still valid
    expect((await batch(cookie, [pref(1, { paperTheme: 'cream' })]))[0].status).toBe('applied');
    const six = Array.from({ length: 6 }, (_, i) => theme(`t${i}`));
    expect((await batch(cookie, [pref(2, { customThemes: six })]))[0].status).toBe('applied');
    const bad = [
      pref(3, { customThemes: [...six, theme('t9')] }),
      pref(3, { customThemes: 'x' }),
      pref(3, { customThemes: [theme('t1', { name: 'x'.repeat(31) })] }),
      pref(3, { customThemes: [theme('t1', { name: '  ' })] }),
      pref(3, { customThemes: [theme('t1', { paper: '#fff' })] }),
      pref(3, { customThemes: [theme('t1', { textInk: 'red' })] }),
      pref(3, { customThemes: [theme('bad id!')] }),
      pref(3, { customThemes: [theme('t1'), theme('t1')] }),
      pref(3, { customThemes: [{ id: 't1', name: 'a' }] }),
      pref(3, { paperTheme: 'custom:' }),
      pref(3, { paperTheme: 'custom:a b' }),
      pref(3, { paperTheme: 'neon' }),
    ];
    expect((await batch(cookie, bad)).map((x) => x.status)).toEqual(Array(bad.length).fill('rejected'));
  });

  it('mixes progress with bookmark ops in one batch and keeps revisions dense', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [dayOp('2026-10-20', { '1': [T, T + 1] }), roundOp('r-1', 1), dayOp('2026-10-20', { '2': [T, T + 1] })]);
    expect(r.map((x) => x.rev)).toEqual([1, 2, 3]);
    expect((await pull(cookie)).cursor).toBe(3);
  });
});

describe('readmark: manual "already read" marks', () => {
  type Marks = Record<string, [number, number]>;
  const marksOp = (marks: Marks, over: Record<string, unknown> = {}) => ({
    opId: uid(),
    entity: 'readmark',
    entityId: 'marks',
    action: 'upsert',
    baseRev: null,
    payload: { marks, updatedAt: 1700000000000, ...over },
  });

  it('merges per component max so devices never lose marks and an unmark survives', async () => {
    const cookie = await login('a@x.co');
    expect((await batch(cookie, [marksOp({ '5': [T + 10, 0], '6': [T + 10, 0] })]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    // device B: marks 7, unmarks 6, has an older mark of 5
    expect((await batch(cookie, [marksOp({ '5': [T + 5, 0], '6': [T + 10, T + 20], '7': [T + 30, 0] })]))[0]).toMatchObject({ status: 'applied', rev: 2 });
    const c = (await pull(cookie)).changes[0];
    expect(c).toMatchObject({ entity: 'readmark', id: 'marks', rev: 2, deleted: false });
    expect(c.data.marks).toEqual({ '5': [T + 10, 0], '6': [T + 10, T + 20], '7': [T + 30, 0] });
    // stale re-mark of 6 (older markedAt) cannot undo the unmark
    await batch(cookie, [marksOp({ '6': [T + 10, 0] })]);
    expect((await pull(cookie)).changes[0].data.marks['6']).toEqual([T + 10, T + 20]);
  });

  it('no-op merges neither write nor bump the revision; replay is idempotent', async () => {
    const cookie = await login('a@x.co');
    const op = marksOp({ '5': [T + 10, 0] });
    await batch(cookie, [op]);
    expect((await batch(cookie, [op]))[0].rev).toBe(1);
    expect((await batch(cookie, [marksOp({ '5': [T + 1, 0] })]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    expect((await pull(cookie, '?cursor=1')).changes).toEqual([]);
  });

  it('validates payload, entityId and refuses delete', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [
      marksOp({}),
      marksOp({ '0': [1, 0] }),
      marksOp({ '605': [1, 0] }),
      marksOp({ '5': [1] as any }),
      marksOp({ '5': [-1, 0] }),
      { ...marksOp({ '5': [1, 0] }), entityId: 'other' },
      { ...marksOp({ '5': [1, 0] }), action: 'delete' },
      marksOp({ '5': [1, 0] }, { updatedAt: -1 }),
    ]);
    expect(r.every((x) => x.status === 'rejected')).toBe(true);
  });

  it('clear history wipes marks, sets the watermark and drops stale marks afterwards', async () => {
    const cookie = await login('a@x.co');
    const before = Date.now() - 60_000;
    await batch(cookie, [marksOp({ '5': [before, 0] })]);
    expect((await batch(cookie, [clearOp()]))[0]).toMatchObject({ status: 'applied', rev: 2 });
    const ch = (await pull(cookie, '?cursor=1')).changes[0];
    expect(ch).toMatchObject({ entity: 'readmark', rev: 2 });
    expect(ch.data.marks).toEqual({});
    expect(typeof ch.data.clearedAt).toBe('number');
    // stale device re-uploads the old mark: ignored; a fresh one is accepted
    expect((await batch(cookie, [marksOp({ '5': [before, 0] })]))[0].status).toBe('applied');
    expect((await pull(cookie, '?cursor=2')).changes).toEqual([]);
    await batch(cookie, [marksOp({ '9': [T, 0] })]);
    expect((await pull(cookie, '?cursor=2')).changes[0].data.marks).toEqual({ '9': [T, 0] });
  });

  it('is in the reset snapshot (when non-empty), export and account deletion', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [marksOp({ '5': [T, 0] })]);
    const snap = await pull(cookie, '?cursor=99');
    expect(snap.reset).toBe(true);
    expect(snap.changes.map((c: any) => c.entity)).toEqual(['readmark']);
    const exp = (await json(await call('GET', '/export', { cookie }))).data;
    expect(exp.readMarks).toMatchObject({ rev: 1, marks: { '5': [T, 0] } });
    await batch(cookie, [clearOp()]);
    expect((await pull(cookie, '?cursor=99')).changes).toEqual([]);
    expect((await json(await call('GET', '/export', { cookie }))).data.readMarks).toBeNull();
    await call('DELETE', '/me/data', { cookie });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM read_marks').first<{ n: number }>())!.n).toBe(0);
  });
});

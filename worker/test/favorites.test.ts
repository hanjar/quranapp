import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { json, makeClient, prefsPayload, uid, verseOp } from './helpers';

const { call, login } = makeClient();

async function batch(cookie: string, ops: unknown[]) {
  const res = await call('POST', '/sync/batch', { cookie, body: { ops } });
  return (await json(res)).data.results as any[];
}
async function pull(cookie: string, qs = '') {
  return (await json(await call('GET', `/sync${qs}`, { cookie }))).data;
}
const favOp = (id: string, surah: number, ayah: number, over: Record<string, unknown> = {}) =>
  verseOp(id, surah, ayah, { kind: 'favorite', ...over });
const edit = (op: any, baseRev: number, over: Record<string, unknown> = {}) => ({
  ...op,
  opId: uid(),
  baseRev,
  payload: { ...op.payload, ...over },
});
const folderOp = (id: string, name: string, baseRev: number | null, over: Record<string, unknown> = {}) => ({
  opId: uid(),
  entity: 'folder',
  entityId: id,
  action: 'upsert',
  baseRev,
  payload: { name, createdAt: 1700000000000, updatedAt: 1700000000000, ...over },
});

describe('favorites', () => {
  it('round-trips through /sync and /export with a favorite key', async () => {
    const cookie = await login('a@x.co');
    expect((await batch(cookie, [favOp('fv-1', 2, 255)]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    const c = (await pull(cookie)).changes[0];
    expect(c.data).toMatchObject({ kind: 'favorite', surah: 2, ayah: 255, page: 3, key: 'hafs-kfqc|favorite|2:255', archivedAt: null });
    const exp = (await json(await call('GET', '/export', { cookie }))).data;
    expect(exp.bookmarks[0]).toMatchObject({ id: 'fv-1', kind: 'favorite', archivedAt: null });
  });

  it('a verse bookmark and a favorite of the same ayah coexist; duplicate favorites do not', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [verseOp('bm-1', 1, 1), favOp('fv-1', 1, 1), favOp('fv-2', 1, 1)]);
    expect(r.map((x) => x.status)).toEqual(['applied', 'applied', 'duplicate']);
  });

  it('requires surah and ayah, and cannot be archived', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [
      favOp('fv-1', 1, 1, { surah: null, ayah: null }),
      favOp('fv-2', 1, 2, { archivedAt: 1700000001000 }),
    ]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected']);
    const ok = favOp('fv-3', 1, 3, { archivedAt: null });
    expect((await batch(cookie, [ok]))[0].status).toBe('applied');
    // archiving an existing favorite is refused too
    const r2 = await batch(cookie, [edit(ok, 1, { archivedAt: 1700000001000 })]);
    expect(r2[0].status).toBe('rejected');
  });
});

describe('archived bookmarks', () => {
  it('archive, then a new active bookmark with the same key is allowed', async () => {
    const cookie = await login('a@x.co');
    const first = verseOp('bm-1', 2, 255);
    await batch(cookie, [first]);
    expect((await batch(cookie, [edit(first, 1, { archivedAt: 1700000005000 })]))[0]).toMatchObject({ status: 'applied', rev: 2 });
    expect((await batch(cookie, [verseOp('bm-2', 2, 255)]))[0].status).toBe('applied');
    const rows = (await pull(cookie)).changes;
    expect(rows.find((c: any) => c.id === 'bm-1').data.archivedAt).toBe(1700000005000);
    expect(rows.find((c: any) => c.id === 'bm-2').data.archivedAt).toBeNull();
  });

  it('rejects unarchiving into a key that already has an active bookmark (duplicate)', async () => {
    const cookie = await login('a@x.co');
    const first = verseOp('bm-1', 2, 255);
    await batch(cookie, [first]);
    await batch(cookie, [edit(first, 1, { archivedAt: 1700000005000 })]);
    await batch(cookie, [verseOp('bm-2', 2, 255)]);
    const r = (await batch(cookie, [edit(first, 2, { archivedAt: null })]))[0];
    expect(r.status).toBe('duplicate');
    expect(r.current).toMatchObject({ id: 'bm-2' });
    // after the blocker is deleted, unarchiving works
    await batch(cookie, [{ opId: uid(), entity: 'bookmark', entityId: 'bm-2', action: 'delete', baseRev: null }]);
    expect((await batch(cookie, [edit(first, 2, { archivedAt: null })]))[0].status).toBe('applied');
  });

  it('absent archivedAt keeps the stored value (bookmark and folder)', async () => {
    const cookie = await login('a@x.co');
    const first = verseOp('bm-1', 2, 255, { archivedAt: 1700000005000 });
    await batch(cookie, [first, folderOp('f-1', 'Khatam ke-1', null, { archivedAt: 1700000005000 })]);
    const p: any = { ...first.payload, note: 'catatan' };
    delete p.archivedAt;
    expect((await batch(cookie, [{ ...first, opId: uid(), baseRev: 1, payload: p }]))[0].status).toBe('applied');
    const f = folderOp('f-1', 'Khatam ke-1 (a)', 2);
    expect((f.payload as any).archivedAt).toBeUndefined();
    expect((await batch(cookie, [f]))[0].status).toBe('applied');
    const rows = (await pull(cookie)).changes;
    expect(rows.find((c: any) => c.id === 'bm-1').data).toMatchObject({ note: 'catatan', archivedAt: 1700000005000 });
    expect(rows.find((c: any) => c.id === 'f-1').data).toMatchObject({ name: 'Khatam ke-1 (a)', archivedAt: 1700000005000 });
    // explicit null unarchives the folder
    expect((await batch(cookie, [folderOp('f-1', 'Khatam ke-1 (a)', 4, { archivedAt: null })]))[0].status).toBe('applied');
    expect((await pull(cookie, '?cursor=4')).changes[0].data.archivedAt).toBeNull();
  });

  it('rejects a malformed archivedAt', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [verseOp('bm-1', 1, 1, { archivedAt: 'x' }), folderOp('f-1', 'A', null, { archivedAt: -5 })]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected']);
  });
});

describe('migration 0007', () => {
  it('has the new columns and keeps the earlier ones and the indexes', async () => {
    const cols = (await env.DB.prepare('PRAGMA table_info(bookmarks)').all()).results.map((r: any) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['folder_id', 'note', 'archived_at', 'semantic_key', 'rev']));
    const fcols = (await env.DB.prepare('PRAGMA table_info(folders)').all()).results.map((r: any) => r.name);
    expect(fcols).toContain('archived_at');
    const idx = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'bookmarks'").all()).results.map((r: any) => r.name);
    expect(idx).toEqual(expect.arrayContaining(['uq_bookmarks_active_key', 'idx_bookmarks_rev', 'idx_bookmarks_tombstones']));
  });

  it('the rebuild copy preserves existing rows (old-schema data copied with the migration statement)', async () => {
    await env.DB.exec(
      "CREATE TABLE b_old (id TEXT NOT NULL, user_id TEXT NOT NULL, semantic_key TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('verse','page')), edition_id TEXT NOT NULL, page INTEGER NOT NULL, surah INTEGER, ayah INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL, folder_id TEXT, note TEXT, PRIMARY KEY (user_id, id))",
    );
    await env.DB.exec("INSERT INTO b_old VALUES ('x1','u1','e|verse|1:1','verse','e',1,1,1,1,1,NULL,5,'f','n')");
    await env.DB.exec(
      "CREATE TABLE b_new (id TEXT NOT NULL, user_id TEXT NOT NULL, semantic_key TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('verse','page','favorite')), edition_id TEXT NOT NULL, page INTEGER NOT NULL, surah INTEGER, ayah INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL, folder_id TEXT, note TEXT, archived_at INTEGER, PRIMARY KEY (user_id, id))",
    );
    await env.DB.exec(
      'INSERT INTO b_new (id, user_id, semantic_key, kind, edition_id, page, surah, ayah, created_at, updated_at, deleted_at, rev, folder_id, note, archived_at) SELECT id, user_id, semantic_key, kind, edition_id, page, surah, ayah, created_at, updated_at, deleted_at, rev, folder_id, note, NULL FROM b_old',
    );
    const row = await env.DB.prepare('SELECT * FROM b_new').first<any>();
    expect(row).toMatchObject({ id: 'x1', rev: 5, folder_id: 'f', note: 'n', archived_at: null });
    await env.DB.exec('DROP TABLE b_old');
    await env.DB.exec('DROP TABLE b_new');
  });
});

describe('showDoaKhatam preference', () => {
  const pref = (baseRev: number | null, over: Record<string, unknown>) => ({
    opId: uid(), entity: 'prefs', entityId: 'prefs', action: 'upsert', baseRev, payload: prefsPayload(over),
  });
  it('is an optional boolean', async () => {
    const cookie = await login('a@x.co');
    expect((await batch(cookie, [pref(null, { showDoaKhatam: false })]))[0].status).toBe('applied');
    expect((await pull(cookie)).changes[0].data).toMatchObject({ showDoaKhatam: false });
    expect((await batch(cookie, [pref(1, {})]))[0].status).toBe('applied');
    const r = await batch(cookie, [pref(2, { showDoaKhatam: 'yes' }), pref(2, { showDoaKhatam: null })]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected']);
  });
});

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runCleanup } from '../src/housekeeping';
import { json, makeClient, uid, verseOp } from './helpers';

const { call, login } = makeClient();

async function batch(cookie: string, ops: unknown[]) {
  const res = await call('POST', '/sync/batch', { cookie, body: { ops } });
  return (await json(res)).data.results as any[];
}
async function pull(cookie: string, qs = '') {
  return (await json(await call('GET', `/sync${qs}`, { cookie }))).data;
}
const folderOp = (id: string, name: string, baseRev: number | null = null, action = 'upsert') => ({
  opId: uid(),
  entity: 'folder',
  entityId: id,
  action,
  baseRev,
  payload: action === 'upsert' ? { name, createdAt: 1700000000000, updatedAt: 1700000000000 } : undefined,
});

describe('folders', () => {
  it('creates, renames, deletes and replays idempotently', async () => {
    const cookie = await login('a@x.co');
    const create = folderOp('f-1', '  Hafalan  ');
    expect((await batch(cookie, [create]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    expect((await batch(cookie, [create]))[0]).toMatchObject({ status: 'applied', rev: 1 });
    let s = await pull(cookie);
    expect(s.changes).toEqual([
      { entity: 'folder', id: 'f-1', rev: 1, deleted: false, data: { name: 'Hafalan', createdAt: 1700000000000, updatedAt: 1700000000000 } },
    ]);
    expect((await batch(cookie, [folderOp('f-1', 'Wirid', 1)]))[0]).toMatchObject({ status: 'applied', rev: 2 });
    const del = folderOp('f-1', '', 2, 'delete');
    expect((await batch(cookie, [del]))[0]).toMatchObject({ status: 'applied', rev: 3 });
    s = await pull(cookie, '?cursor=2');
    expect(s.changes).toEqual([{ entity: 'folder', id: 'f-1', rev: 3, deleted: true, data: null }]);
    // re-using a deleted id is refused; stale edit conflicts with the tombstone
    expect((await batch(cookie, [folderOp('f-1', 'Baru')]))[0].status).toBe('rejected');
    const st = (await batch(cookie, [folderOp('f-1', 'Baru', 2)]))[0];
    expect(st.status).toBe('conflict');
    expect(st.current.deleted).toBe(true);
  });

  it('enforces case-insensitive unique names, free again after delete', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [folderOp('f-1', 'Hafalan')]);
    const r = await batch(cookie, [folderOp('f-2', 'hAFALAN'), folderOp('f-3', 'Lain'), folderOp('f-4', ' lain ')]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'applied', 'rejected']);
    expect(r[0].error).toBe('folder_name_taken');
    // renaming onto an existing name is refused too
    expect((await batch(cookie, [folderOp('f-3', 'HAFALAN', 2)]))[0].error).toBe('folder_name_taken');
    await batch(cookie, [folderOp('f-1', '', 1, 'delete')]);
    expect((await batch(cookie, [folderOp('f-5', 'hafalan')]))[0].status).toBe('applied');
    // renaming a folder to its own name in a different case is allowed
    expect((await batch(cookie, [folderOp('f-3', 'LAIN', 2)]))[0].status).toBe('applied');
  });

  it('validates names', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [folderOp('f-1', '   '), folderOp('f-2', 'x'.repeat(41)), folderOp('f-3', 'Juz 30 القرآن'), folderOp('f-4', 'x'.repeat(40))]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected', 'applied', 'applied']);
  });

  it('limits to 100 active folders; deleting frees a slot', async () => {
    const cookie = await login('a@x.co');
    const ops = Array.from({ length: 100 }, (_, i) => folderOp(`f-${i}`, `Folder ${i}`));
    expect((await batch(cookie, ops)).every((x) => x.status === 'applied')).toBe(true);
    const over = (await batch(cookie, [folderOp('f-x', 'Terlalu banyak')]))[0];
    expect(over).toMatchObject({ status: 'rejected', error: 'limit_reached' });
    await batch(cookie, [folderOp('f-0', '', 1, 'delete')]);
    expect((await batch(cookie, [folderOp('f-x', 'Terlalu banyak')]))[0].status).toBe('applied');
  });

  it('stale baseRev conflicts with current', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [folderOp('f-1', 'A')]);
    await batch(cookie, [folderOp('f-1', 'B', 1)]);
    const r = (await batch(cookie, [folderOp('f-1', 'C', 1)]))[0];
    expect(r.status).toBe('conflict');
    expect(r.current).toMatchObject({ entity: 'folder', id: 'f-1', rev: 2 });
    expect(r.current.data.name).toBe('B');
    expect((await batch(cookie, [folderOp('f-1', 'C', null)]))[0].status).toBe('conflict');
  });

  it('is isolated per user (same names and ids allowed, nothing visible)', async () => {
    const a = await login('a@x.co');
    const b = await login('b@x.co');
    await batch(a, [folderOp('f-1', 'Rahasia')]);
    expect((await pull(b)).changes).toEqual([]);
    expect((await json(await call('GET', '/export', { cookie: b }))).data.folders).toEqual([]);
    expect((await batch(b, [folderOp('f-1', 'Rahasia')]))[0].status).toBe('applied');
    expect((await batch(b, [folderOp('f-1', '', null, 'delete')]))[0].status).toBe('applied');
    const sa = await pull(a);
    expect(sa.changes[0]).toMatchObject({ id: 'f-1', deleted: false });
    // B editing A's folder id sees nothing of A's
    expect((await batch(b, [folderOp('f-zz', 'x', 1)]))[0].status).toBe('rejected');
  });

  it('includes folders in the reset snapshot, export, tombstone cleanup and account deletion', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [folderOp('f-1', 'Tetap'), folderOp('f-2', 'Hapus')]);
    await batch(cookie, [folderOp('f-2', '', 2, 'delete')]);
    await env.DB.prepare("UPDATE folders SET deleted_at = ?1 WHERE id = 'f-2'").bind(Date.now() - 181 * 24 * 3600_000).run();
    await runCleanup(env.DB, Date.now());
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM folders').first<{ n: number }>())!.n).toBe(1);
    const snap = await pull(cookie, '?cursor=1');
    expect(snap.reset).toBe(true);
    expect(snap.changes.map((c: { id: string }) => c.id)).toEqual(['f-1']);
    const exp = (await json(await call('GET', '/export', { cookie }))).data;
    expect(exp.folders).toEqual([{ id: 'f-1', rev: 1, name: 'Tetap', createdAt: 1700000000000, updatedAt: 1700000000000 }]);
    await call('DELETE', '/me/data', { cookie });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM folders').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('bookmark folderId and note', () => {
  it('round-trips through /sync and /export', async () => {
    const cookie = await login('a@x.co');
    const op = verseOp('bm-1', 2, 255, { folderId: 'f-1', note: 'Ayat kursi' });
    expect((await batch(cookie, [op]))[0].status).toBe('applied');
    const c = (await pull(cookie)).changes[0];
    expect(c.data).toMatchObject({ folderId: 'f-1', note: 'Ayat kursi' });
    const exp = (await json(await call('GET', '/export', { cookie }))).data;
    expect(exp.bookmarks[0]).toMatchObject({ id: 'bm-1', folderId: 'f-1', note: 'Ayat kursi' });
    // move to no folder / clear note via edit
    const edit = { ...verseOp('bm-1', 2, 255, { folderId: null, note: null }), baseRev: 1 };
    expect((await batch(cookie, [edit]))[0].status).toBe('applied');
    expect((await pull(cookie, '?cursor=1')).changes[0].data).toMatchObject({ folderId: null, note: null });
  });

  it('old clients without the fields store null', async () => {
    const cookie = await login('a@x.co');
    await batch(cookie, [verseOp('bm-1', 1, 1)]);
    expect((await pull(cookie)).changes[0].data).toMatchObject({ folderId: null, note: null });
  });

  it('rejects notes over 500 chars and bad folder ids; accepts exactly 500', async () => {
    const cookie = await login('a@x.co');
    const r = await batch(cookie, [
      verseOp('bm-1', 1, 1, { note: 'x'.repeat(501) }),
      verseOp('bm-2', 1, 2, { note: 'x'.repeat(500) }),
      verseOp('bm-3', 1, 3, { folderId: 'a'.repeat(65) }),
      verseOp('bm-4', 1, 4, { folderId: 5 }),
      verseOp('bm-5', 1, 5, { note: 12 }),
    ]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'applied', 'rejected', 'rejected', 'rejected']);
  });

  it('accepts a folderId that points to no folder', async () => {
    const cookie = await login('a@x.co');
    expect((await batch(cookie, [verseOp('bm-1', 1, 1, { folderId: 'ghost' })]))[0].status).toBe('applied');
  });
});

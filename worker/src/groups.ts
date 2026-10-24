import type { Hono } from 'hono';
import { type AppBindings, type AuthContext, type Ctx, ApiError, readJsonBody } from './http';
import { isRecord, randomToken } from './util';

/**
 * Khatam bersama: groups that share the 30 juz of a round (One Day One Juz style).
 * Members see each other's nickname and juz only (an opaque member id, never the account).
 */

export const GROUP_NAME_MAX = 60;
export const NICKNAME_MAX = 40;
export const MAX_MEMBERS = 60;
export const MAX_GROUPS_PER_USER = 20;
const JUZ = Array.from({ length: 30 }, (_, i) => i + 1);
/** No 0/O/1/I/L: read aloud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function parseInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

export const parseGroupName = (raw: unknown) => cleanText(raw, GROUP_NAME_MAX);
export const parseNickname = (raw: unknown) => cleanText(raw, NICKNAME_MAX);

/** The nickname sent, else the account name cut to fit, else `fallback`. */
function nicknameOf(raw: unknown, accountName: string | null, fallback: string): string | null {
  if (raw !== undefined) return parseNickname(raw);
  return parseNickname((accountName ?? '').slice(0, NICKNAME_MAX)) ?? fallback;
}

/**
 * Splits `juz` (sorted) into contiguous runs, one per member in order, as even as possible:
 * 30 juz over 4 members → 8, 8, 7, 7.
 */
export function distribute(members: readonly string[], juz: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!members.length) return out;
  const base = Math.floor(juz.length / members.length);
  const extra = juz.length % members.length;
  let i = 0;
  members.forEach((m, k) => {
    const n = base + (k < extra ? 1 : 0);
    for (let j = 0; j < n; j++) out.set(juz[i++]!, m);
  });
  return out;
}

/** Next round: whoever read juz j reads juz j+1 (30 wraps to 1). */
export function rotate(prev: ReadonlyMap<number, string | null>): Map<number, string | null> {
  const out = new Map<number, string | null>();
  for (const j of JUZ) out.set(j === 30 ? 1 : j + 1, prev.get(j) ?? null);
  return out;
}

interface GroupRow {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  round: number;
  khatam_count: number;
}
interface MemberRow {
  user_id: string;
  member_id: string;
  nickname: string;
  joined_at: number;
}
interface JuzRow {
  juz: number;
  member_id: string | null;
  done_at: number | null;
}

type Ok = <T>(c: Ctx, data: T) => Response;

export function registerGroups(
  app: Hono<AppBindings>,
  h: { requireAuth: (c: Ctx) => AuthContext; ok: Ok; now: () => number },
): void {
  const { requireAuth, ok, now } = h;

  async function load(c: Ctx, id: string) {
    const db = c.env.DB;
    const [g, m] = await db.batch([
      db.prepare('SELECT id, name, owner_id, invite_code, round, khatam_count FROM khatam_groups WHERE id = ?1').bind(id),
      db
        .prepare('SELECT user_id, member_id, nickname, joined_at FROM group_members WHERE group_id = ?1 ORDER BY joined_at')
        .bind(id),
    ]);
    const group = (g?.results?.[0] as GroupRow | undefined) ?? null;
    if (!group) throw new ApiError(404, 'not_found', 'Group not found.');
    const members = (m?.results ?? []) as MemberRow[];
    const juz = (
      await db
        .prepare('SELECT juz, member_id, done_at FROM group_juz WHERE group_id = ?1 AND round = ?2 ORDER BY juz')
        .bind(id, group.round)
        .all<JuzRow>()
    ).results;
    return { group, members, juz };
  }

  async function memberOf(c: Ctx, id: string) {
    const a = requireAuth(c);
    const data = await load(c, id);
    const me = data.members.find((m) => m.user_id === a.userId);
    if (!me) throw new ApiError(404, 'not_found', 'Group not found.');
    return { ...data, me, isOwner: data.group.owner_id === a.userId };
  }

  function detail(d: Awaited<ReturnType<typeof memberOf>>) {
    return {
      id: d.group.id,
      name: d.group.name,
      round: d.group.round,
      khatamCount: d.group.khatam_count,
      inviteCode: d.group.invite_code,
      isOwner: d.isOwner,
      me: d.me.member_id,
      members: d.members.map((m) => ({
        id: m.member_id,
        nickname: m.nickname,
        isOwner: m.user_id === d.group.owner_id,
      })),
      juz: d.juz.map((j) => ({ juz: j.juz, memberId: j.member_id, done: j.done_at !== null })),
    };
  }

  const groupId = (c: Ctx) => {
    const id = c.req.param('id') ?? '';
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw new ApiError(404, 'not_found', 'Group not found.');
    return id;
  };

  // ---- list / create / join ----
  app.get('/groups', async (c) => {
    const a = requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT g.id, g.name, g.round, g.khatam_count,
              (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS members,
              (SELECT COUNT(*) FROM group_juz j WHERE j.group_id = g.id AND j.round = g.round AND j.done_at IS NOT NULL) AS done,
              (SELECT group_concat(j.juz || ':' || (j.done_at IS NOT NULL), ',') FROM group_juz j
                 WHERE j.group_id = g.id AND j.round = g.round AND j.member_id = m.member_id) AS mine
       FROM group_members m JOIN khatam_groups g ON g.id = m.group_id
       WHERE m.user_id = ?1 ORDER BY g.updated_at DESC`,
    )
      .bind(a.userId)
      .all<{ id: string; name: string; round: number; khatam_count: number; members: number; done: number; mine: string | null }>();
    return ok(c, {
      groups: rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        round: r.round,
        khatamCount: r.khatam_count,
        memberCount: r.members,
        doneCount: r.done,
        myJuz: (r.mine ?? '')
          .split(',')
          .filter(Boolean)
          .map((s) => {
            const [j, d] = s.split(':');
            return { juz: Number(j), done: d === '1' };
          })
          .sort((x, y) => x.juz - y.juz),
      })),
    });
  });

  app.post('/groups', async (c) => {
    const a = requireAuth(c);
    const body = await readJsonBody(c, 4096);
    if (!isRecord(body)) throw new ApiError(400, 'validation_error', 'Invalid body.');
    const name = parseGroupName(body['name']);
    const nickname = nicknameOf(body['nickname'], a.name, 'Saya');
    if (!name || !nickname) throw new ApiError(400, 'validation_error', 'Invalid name or nickname.');
    const db = c.env.DB;
    const count = await db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?1').bind(a.userId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_GROUPS_PER_USER) throw new ApiError(409, 'too_many_groups', 'Too many groups.');
    const id = randomToken(12);
    const memberId = randomToken(9);
    const t = now();
    await db.batch([
      db
        .prepare('INSERT INTO khatam_groups (id, name, owner_id, invite_code, round, khatam_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5)')
        .bind(id, name, a.userId, newInviteCode(), t),
      db
        .prepare('INSERT INTO group_members (group_id, user_id, member_id, nickname, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(id, a.userId, memberId, nickname, t),
      // Round 1 starts with every juz on the creator; "Bagi rata" spreads them once others join.
      ...JUZ.map((j) =>
        db.prepare('INSERT INTO group_juz (group_id, round, juz, member_id, done_at) VALUES (?1, 1, ?2, ?3, NULL)').bind(id, j, memberId),
      ),
    ]);
    return ok(c, detail(await memberOf(c, id)));
  });

  /** Public preview of an invite (name and size only), for the join page. */
  app.get('/groups/invite/:code', async (c) => {
    requireAuth(c);
    const code = parseInviteCode(c.req.param('code'));
    if (!code) throw new ApiError(404, 'not_found', 'Invite not found.');
    const g = await c.env.DB.prepare(
      'SELECT g.id, g.name, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM khatam_groups g WHERE invite_code = ?1',
    )
      .bind(code)
      .first<{ id: string; name: string; members: number }>();
    if (!g) throw new ApiError(404, 'not_found', 'Invite not found.');
    return ok(c, { name: g.name, memberCount: g.members });
  });

  app.post('/groups/join', async (c) => {
    const a = requireAuth(c);
    const body = await readJsonBody(c, 4096);
    if (!isRecord(body)) throw new ApiError(400, 'validation_error', 'Invalid body.');
    const code = parseInviteCode(body['code']);
    const nickname = nicknameOf(body['nickname'], a.name, 'Anggota');
    if (!code || !nickname) throw new ApiError(400, 'validation_error', 'Invalid code or nickname.');
    const db = c.env.DB;
    const g = await db.prepare('SELECT id FROM khatam_groups WHERE invite_code = ?1').bind(code).first<{ id: string }>();
    if (!g) throw new ApiError(404, 'not_found', 'Invite not found.');
    const [members, mine] = await db.batch([
      db.prepare('SELECT user_id FROM group_members WHERE group_id = ?1').bind(g.id),
      db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?1').bind(a.userId),
    ]);
    const list = (members?.results ?? []) as { user_id: string }[];
    if (!list.some((m) => m.user_id === a.userId)) {
      if (list.length >= MAX_MEMBERS) throw new ApiError(409, 'group_full', 'Group is full.');
      if (((mine?.results?.[0] as { n: number } | undefined)?.n ?? 0) >= MAX_GROUPS_PER_USER)
        throw new ApiError(409, 'too_many_groups', 'Too many groups.');
      const t = now();
      await db.batch([
        db
          .prepare('INSERT INTO group_members (group_id, user_id, member_id, nickname, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(g.id, a.userId, randomToken(9), nickname, t),
        db.prepare('UPDATE khatam_groups SET updated_at = ?2 WHERE id = ?1').bind(g.id, t),
      ]);
    }
    return ok(c, detail(await memberOf(c, g.id)));
  });

  // ---- one group ----
  app.get('/groups/:id', async (c) => ok(c, detail(await memberOf(c, groupId(c)))));

  app.patch('/groups/:id', async (c) => {
    const d = await memberOf(c, groupId(c));
    const body = await readJsonBody(c, 4096);
    if (!isRecord(body)) throw new ApiError(400, 'validation_error', 'Invalid body.');
    const db = c.env.DB;
    const stmts: D1PreparedStatement[] = [];
    if ('name' in body) {
      if (!d.isOwner) throw new ApiError(403, 'forbidden', 'Only the owner can rename.');
      const name = parseGroupName(body['name']);
      if (!name) throw new ApiError(400, 'validation_error', 'Invalid name.');
      stmts.push(db.prepare('UPDATE khatam_groups SET name = ?2, updated_at = ?3 WHERE id = ?1').bind(d.group.id, name, now()));
    }
    if ('nickname' in body) {
      const nick = parseNickname(body['nickname']);
      if (!nick) throw new ApiError(400, 'validation_error', 'Invalid nickname.');
      stmts.push(
        db.prepare('UPDATE group_members SET nickname = ?3 WHERE group_id = ?1 AND user_id = ?2').bind(d.group.id, d.me.user_id, nick),
      );
    }
    if (stmts.length) await db.batch(stmts);
    return ok(c, detail(await memberOf(c, d.group.id)));
  });

  /** Mark a juz done / not done. Your own juz, an unassigned one (you take it), or any as owner. */
  app.post('/groups/:id/juz/:juz', async (c) => {
    const d = await memberOf(c, groupId(c));
    const juz = Number(c.req.param('juz'));
    if (!Number.isInteger(juz) || juz < 1 || juz > 30) throw new ApiError(404, 'not_found', 'Juz not found.');
    const body = await readJsonBody(c, 1024);
    if (!isRecord(body) || typeof body['done'] !== 'boolean') throw new ApiError(400, 'validation_error', 'done must be a boolean.');
    const row = d.juz.find((j) => j.juz === juz);
    const holder = row?.member_id ?? null;
    if (holder && holder !== d.me.member_id && !d.isOwner) throw new ApiError(403, 'not_yours', 'This juz belongs to another member.');
    const t = now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE group_juz SET done_at = ?4, member_id = COALESCE(member_id, ?5) WHERE group_id = ?1 AND round = ?2 AND juz = ?3',
      ).bind(d.group.id, d.group.round, juz, body['done'] ? t : null, d.me.member_id),
      c.env.DB.prepare('UPDATE khatam_groups SET updated_at = ?2 WHERE id = ?1').bind(d.group.id, t),
    ]);
    return ok(c, detail(await memberOf(c, d.group.id)));
  });

  /** Owner: give a juz to a member (or nobody). Members may take an unassigned juz for themselves. */
  app.post('/groups/:id/juz/:juz/assign', async (c) => {
    const d = await memberOf(c, groupId(c));
    const juz = Number(c.req.param('juz'));
    if (!Number.isInteger(juz) || juz < 1 || juz > 30) throw new ApiError(404, 'not_found', 'Juz not found.');
    const body = await readJsonBody(c, 1024);
    if (!isRecord(body)) throw new ApiError(400, 'validation_error', 'Invalid body.');
    const target = body['memberId'] === null ? null : String(body['memberId'] ?? '');
    if (target !== null && !d.members.some((m) => m.member_id === target)) throw new ApiError(400, 'validation_error', 'Unknown member.');
    const holder = d.juz.find((j) => j.juz === juz)?.member_id ?? null;
    const selfTake = target === d.me.member_id && holder === null;
    if (!d.isOwner && !selfTake) throw new ApiError(403, 'forbidden', 'Only the owner can assign juz.');
    await c.env.DB.prepare('UPDATE group_juz SET member_id = ?4 WHERE group_id = ?1 AND round = ?2 AND juz = ?3')
      .bind(d.group.id, d.group.round, juz, target)
      .run();
    return ok(c, detail(await memberOf(c, d.group.id)));
  });

  /** Owner: spread the juz not done yet evenly over all members, in joining order. */
  app.post('/groups/:id/distribute', async (c) => {
    const d = await memberOf(c, groupId(c));
    if (!d.isOwner) throw new ApiError(403, 'forbidden', 'Only the owner can distribute.');
    const open = d.juz.filter((j) => j.done_at === null).map((j) => j.juz);
    const plan = distribute(d.members.map((m) => m.member_id), open);
    const db = c.env.DB;
    if (plan.size)
      await db.batch(
        [...plan].map(([juz, m]) =>
          db.prepare('UPDATE group_juz SET member_id = ?4 WHERE group_id = ?1 AND round = ?2 AND juz = ?3').bind(d.group.id, d.group.round, juz, m),
        ),
      );
    return ok(c, detail(await memberOf(c, d.group.id)));
  });

  /** Start the next round: anyone once all 30 are done (a khatam), the owner at any time. */
  app.post('/groups/:id/next-round', async (c) => {
    const d = await memberOf(c, groupId(c));
    const complete = d.juz.length === 30 && d.juz.every((j) => j.done_at !== null);
    if (!complete && !d.isOwner) throw new ApiError(409, 'round_open', 'Not all juz are done yet.');
    const prev = new Map(d.juz.map((j) => [j.juz, j.member_id] as const));
    const next = rotate(prev);
    const round = d.group.round + 1;
    const db = c.env.DB;
    await db.batch([
      db
        .prepare('UPDATE khatam_groups SET round = ?2, khatam_count = khatam_count + ?3, updated_at = ?4 WHERE id = ?1 AND round = ?5')
        .bind(d.group.id, round, complete ? 1 : 0, now(), d.group.round),
      ...[...next].map(([juz, m]) =>
        db
          .prepare('INSERT OR IGNORE INTO group_juz (group_id, round, juz, member_id, done_at) VALUES (?1, ?2, ?3, ?4, NULL)')
          .bind(d.group.id, round, juz, m),
      ),
      db.prepare('DELETE FROM group_juz WHERE group_id = ?1 AND round < ?2').bind(d.group.id, round - 1),
    ]);
    return ok(c, detail(await memberOf(c, d.group.id)));
  });

  app.post('/groups/:id/leave', async (c) => {
    const a = requireAuth(c);
    await leaveGroup(c.env.DB, groupId(c), a.userId, now());
    return ok(c, { left: true });
  });

  app.delete('/groups/:id', async (c) => {
    const d = await memberOf(c, groupId(c));
    if (!d.isOwner) throw new ApiError(403, 'forbidden', 'Only the owner can delete the group.');
    await c.env.DB.prepare('DELETE FROM khatam_groups WHERE id = ?1').bind(d.group.id).run();
    return ok(c, { deleted: true });
  });
}

/**
 * Removes a member: their unfinished juz become unassigned; an owner hands the group to the
 * longest-standing member, and an empty group is deleted.
 */
export async function leaveGroup(db: D1Database, groupId: string, userId: string, t: number): Promise<void> {
  const [g, m] = await db.batch([
    db.prepare('SELECT owner_id, round FROM khatam_groups WHERE id = ?1').bind(groupId),
    db.prepare('SELECT user_id, member_id FROM group_members WHERE group_id = ?1 ORDER BY joined_at').bind(groupId),
  ]);
  const group = g?.results?.[0] as { owner_id: string; round: number } | undefined;
  const members = (m?.results ?? []) as { user_id: string; member_id: string }[];
  const me = members.find((x) => x.user_id === userId);
  if (!group || !me) return;
  const rest = members.filter((x) => x.user_id !== userId);
  if (!rest.length) {
    await db.prepare('DELETE FROM khatam_groups WHERE id = ?1').bind(groupId).run();
    return;
  }
  await db.batch([
    db
      .prepare('UPDATE group_juz SET member_id = NULL WHERE group_id = ?1 AND round = ?2 AND member_id = ?3 AND done_at IS NULL')
      .bind(groupId, group.round, me.member_id),
    db.prepare('DELETE FROM group_members WHERE group_id = ?1 AND user_id = ?2').bind(groupId, userId),
    db
      .prepare('UPDATE khatam_groups SET owner_id = CASE WHEN owner_id = ?2 THEN ?3 ELSE owner_id END, updated_at = ?4 WHERE id = ?1')
      .bind(groupId, userId, rest[0]!.user_id, t),
  ]);
}

/** Account deletion: leave every group first. */
export async function leaveAllGroups(db: D1Database, userId: string, t: number): Promise<void> {
  const rows = await db.prepare('SELECT group_id FROM group_members WHERE user_id = ?1').bind(userId).all<{ group_id: string }>();
  for (const r of rows.results) await leaveGroup(db, r.group_id, userId, t);
}

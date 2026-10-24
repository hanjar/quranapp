import { describe, expect, it } from 'vitest';
import { distribute, parseInviteCode, rotate } from '../src/groups';
import { json, makeClient } from './helpers';

describe('group helpers', () => {
  it('distributes juz in contiguous, even runs', () => {
    const plan = distribute(['a', 'b', 'c', 'd'], Array.from({ length: 30 }, (_, i) => i + 1));
    const count = (m: string) => [...plan.values()].filter((x) => x === m).length;
    expect([count('a'), count('b'), count('c'), count('d')]).toEqual([8, 8, 7, 7]);
    expect(plan.get(1)).toBe('a');
    expect(plan.get(9)).toBe('b');
    expect(plan.get(30)).toBe('d');
    expect(distribute([], [1, 2]).size).toBe(0);
  });

  it('rotates every assignment one juz forward, 30 wrapping to 1', () => {
    const prev = new Map<number, string | null>(Array.from({ length: 30 }, (_, i) => [i + 1, `m${i + 1}`]));
    const next = rotate(prev);
    expect(next.get(2)).toBe('m1');
    expect(next.get(1)).toBe('m30');
  });

  it('normalises invite codes', () => {
    expect(parseInviteCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(parseInviteCode('short')).toBeNull();
    expect(parseInviteCode(42)).toBeNull();
  });
});

describe('groups API', () => {
  async function setup() {
    const c = makeClient();
    const owner = await c.login(`owner-${crypto.randomUUID()}@example.com`);
    const other = await c.login(`member-${crypto.randomUUID()}@example.com`);
    const stranger = await c.login(`stranger-${crypto.randomUUID()}@example.com`);
    return { c, owner, other, stranger };
  }

  it('requires a session', async () => {
    const { c } = await setup();
    expect((await c.call('GET', '/groups')).status).toBe(401);
  });

  it('create, join by code, distribute, mark, permissions, khatam and next round', async () => {
    const { c, owner, other, stranger } = await setup();
    const created = (await json(await c.call('POST', '/groups', { cookie: owner, body: { name: 'ODOJ Kantor', nickname: 'Hanjar' } }))).data;
    expect(created.name).toBe('ODOJ Kantor');
    expect(created.juz).toHaveLength(30);
    expect(created.juz.every((j: { memberId: string }) => j.memberId === created.me)).toBe(true);
    expect(created.inviteCode).toMatch(/^[A-Z2-9]{8}$/);

    // Strangers cannot see the group.
    expect((await c.call('GET', `/groups/${created.id}`, { cookie: stranger })).status).toBe(404);

    // Invite preview and join (twice is harmless).
    const prev = (await json(await c.call('GET', `/groups/invite/${created.inviteCode.toLowerCase()}`, { cookie: other }))).data;
    expect(prev).toEqual({ name: 'ODOJ Kantor', memberCount: 1 });
    await c.call('POST', '/groups/join', { cookie: other, body: { code: created.inviteCode, nickname: 'Budi' } });
    const joined = (await json(await c.call('POST', '/groups/join', { cookie: other, body: { code: created.inviteCode } }))).data;
    expect(joined.members.map((m: { nickname: string }) => m.nickname)).toEqual(['Hanjar', 'Budi']);
    expect(joined.isOwner).toBe(false);

    // Only the owner distributes; 15 juz each, contiguous.
    expect((await c.call('POST', `/groups/${created.id}/distribute`, { cookie: other })).status).toBe(403);
    const dist = (await json(await c.call('POST', `/groups/${created.id}/distribute`, { cookie: owner }))).data;
    const budi = dist.members[1].id;
    expect(dist.juz.filter((j: { memberId: string }) => j.memberId === budi).map((j: { juz: number }) => j.juz)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 16),
    );

    // Members mark their own juz only; the owner may mark any.
    expect((await c.call('POST', `/groups/${created.id}/juz/1`, { cookie: other, body: { done: true } })).status).toBe(403);
    expect((await c.call('POST', `/groups/${created.id}/juz/16`, { cookie: other, body: { done: true } })).status).toBe(200);
    expect((await c.call('POST', `/groups/${created.id}/next-round`, { cookie: other })).status).toBe(409);

    // List shows my juz and progress.
    const list = (await json(await c.call('GET', '/groups', { cookie: other }))).data.groups;
    expect(list[0]).toMatchObject({ name: 'ODOJ Kantor', memberCount: 2, doneCount: 1 });
    expect(list[0].myJuz[0]).toEqual({ juz: 16, done: true });

    // Finish everything → any member starts the next round → khatam counted, juz shifted by one.
    for (let j = 1; j <= 30; j++)
      await c.call('POST', `/groups/${created.id}/juz/${j}`, { cookie: owner, body: { done: true } });
    const next = (await json(await c.call('POST', `/groups/${created.id}/next-round`, { cookie: other }))).data;
    expect(next.round).toBe(2);
    expect(next.khatamCount).toBe(1);
    expect(next.juz.every((j: { done: boolean }) => !j.done)).toBe(true);
    expect(next.juz.find((j: { juz: number }) => j.juz === 17).memberId).toBe(budi);
    expect(next.juz.find((j: { juz: number }) => j.juz === 1).memberId).toBe(budi);
  });

  it('leaving frees unfinished juz and hands ownership on; the last one out deletes the group', async () => {
    const { c, owner, other } = await setup();
    const g = (await json(await c.call('POST', '/groups', { cookie: owner, body: { name: 'Keluarga' } }))).data;
    await c.call('POST', '/groups/join', { cookie: other, body: { code: g.inviteCode, nickname: 'Adik' } });
    await c.call('POST', `/groups/${g.id}/juz/1`, { cookie: owner, body: { done: true } });
    await c.call('POST', `/groups/${g.id}/leave`, { cookie: owner });
    const after = (await json(await c.call('GET', `/groups/${g.id}`, { cookie: other }))).data;
    expect(after.isOwner).toBe(true);
    expect(after.juz.find((j: { juz: number }) => j.juz === 1)).toMatchObject({ done: true });
    expect(after.juz.filter((j: { memberId: string | null }) => j.memberId === null)).toHaveLength(29);
    // An unassigned juz can be taken by any member.
    const took = (await json(await c.call('POST', `/groups/${g.id}/juz/2/assign`, { cookie: other, body: { memberId: after.me } }))).data;
    expect(took.juz.find((j: { juz: number }) => j.juz === 2).memberId).toBe(after.me);
    await c.call('POST', `/groups/${g.id}/leave`, { cookie: other });
    expect((await c.call('GET', `/groups/${g.id}`, { cookie: other })).status).toBe(404);
  });

  it('validates names and codes', async () => {
    const { c, owner } = await setup();
    expect((await c.call('POST', '/groups', { cookie: owner, body: { name: '   ' } })).status).toBe(400);
    expect((await c.call('POST', '/groups/join', { cookie: owner, body: { code: 'ZZZZZZZZ' } })).status).toBe(404);
  });
});

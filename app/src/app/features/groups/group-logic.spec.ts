import type { GroupDetail } from '../../core/groups/groups-api';
import { inviteUrl } from '../../core/groups/groups-api';
import { doneCount, juzPages, juzRanges, memberProgress } from './group-logic';

const g: GroupDetail = {
  id: 'g1',
  name: 'Keluarga',
  round: 1,
  khatamCount: 0,
  inviteCode: 'ABCD2345',
  isOwner: false,
  me: 'b',
  members: [
    { id: 'a', nickname: 'Ayah', isOwner: true },
    { id: 'b', nickname: 'Adik', isOwner: false },
  ],
  juz: Array.from({ length: 30 }, (_, i) => ({ juz: i + 1, memberId: i < 15 ? 'a' : 'b', done: i < 3 || i === 20 })),
};

describe('group logic', () => {
  it('juz page ranges from the index', () => {
    const juz = [
      { number: 1, start: { surah: 1, ayah: 1 }, page: 1 },
      { number: 2, start: { surah: 2, ayah: 142 }, page: 22 },
    ];
    expect(juzPages(juz, 1)).toEqual({ from: 1, to: 21 });
    expect(juzPages(juz, 2)).toEqual({ from: 22, to: 604 });
    expect(juzPages(juz, 3)).toBeNull();
  });

  it('members with me first, their juz and progress', () => {
    const m = memberProgress(g);
    expect(m.map((x) => x.nickname)).toEqual(['Adik', 'Ayah']);
    expect(m[0]).toMatchObject({ isMe: true, done: 1 });
    expect(m[0]!.juz).toHaveLength(15);
    expect(doneCount(g)).toBe(4);
  });

  it('formats ranges and invite links', () => {
    expect(juzRanges([3, 1, 2, 7, 9, 10])).toBe('1–3, 7, 9–10');
    expect(juzRanges([])).toBe('');
    expect(inviteUrl('https://quran.hanjar.net', 'ABCD2345')).toBe('https://quran.hanjar.net/grup/gabung/ABCD2345');
  });
});

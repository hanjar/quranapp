import type { GroupDetail } from '../../core/groups/groups-api';
import type { JuzMeta } from '../../core/models';

/** Pure helpers for the khatam bersama pages. */

/** First and last mushaf page of juz `n` (1..30). */
export function juzPages(juz: readonly JuzMeta[], n: number): { from: number; to: number } | null {
  const j = juz[n - 1];
  if (!j) return null;
  const next = juz[n];
  return { from: j.page, to: next ? Math.max(j.page, next.page - 1) : 604 };
}

export interface MemberProgress {
  id: string;
  nickname: string;
  isOwner: boolean;
  isMe: boolean;
  juz: number[];
  done: number;
}

/** Members (me first) with their juz this round and how many are done. */
export function memberProgress(g: GroupDetail): MemberProgress[] {
  const rows = g.members.map((m) => {
    const mine = g.juz.filter((j) => j.memberId === m.id);
    return {
      id: m.id,
      nickname: m.nickname,
      isOwner: m.isOwner,
      isMe: m.id === g.me,
      juz: mine.map((j) => j.juz),
      done: mine.filter((j) => j.done).length,
    };
  });
  return [...rows.filter((r) => r.isMe), ...rows.filter((r) => !r.isMe)];
}

export function doneCount(g: GroupDetail): number {
  return g.juz.filter((j) => j.done).length;
}

/** "1–3, 7" from [1, 2, 3, 7]. */
export function juzRanges(list: readonly number[]): string {
  const s = [...list].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let k = i;
    while (k + 1 < s.length && s[k + 1] === s[k]! + 1) k++;
    out.push(k > i ? `${s[i]}–${s[k]}` : `${s[i]}`);
    i = k + 1;
  }
  return out.join(', ');
}

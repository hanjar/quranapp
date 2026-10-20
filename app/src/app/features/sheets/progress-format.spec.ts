import { describe, expect, it } from 'vitest';
import { barHeight, etaText, formatDecimal, relativeDay, weekSummary, weekdayShort } from './progress-format';

describe('progress-format', () => {
  const now = new Date(2026, 9, 20, 15).getTime();
  it('relativeDay', () => {
    expect(relativeDay(new Date(2026, 9, 20, 8).getTime(), now)).toBe('Hari ini');
    expect(relativeDay(new Date(2026, 9, 19, 23).getTime(), now)).toBe('Kemarin');
    expect(relativeDay(new Date(2026, 9, 17, 9).getTime(), now)).toBe('3 hari lalu');
    expect(relativeDay(new Date(2026, 8, 1, 9).getTime(), now)).toMatch(/2026/);
  });
  it('weekdayShort is Indonesian', () => {
    expect(weekdayShort('2026-10-20')).toMatch(/^Sel/);
  });
  it('formatDecimal uses a comma', () => {
    expect(formatDecimal(1.5)).toBe('1,5');
  });
  it('barHeight', () => {
    expect(barHeight(0, 10)).toBe(2);
    expect(barHeight(1, 100)).toBe(4);
    expect(barHeight(10, 10)).toBe(76);
    expect(barHeight(3, 0)).toBe(2);
  });
  it('weekSummary lists counts and target', () => {
    const w = [{ day: '2026-10-19', count: 2 }, { day: '2026-10-20', count: 5 }];
    const t = weekSummary(w, 4);
    expect(t).toContain('hari ini 5');
    expect(t).toContain('Target 4 halaman');
  });
  it('etaText covers done, no pace and pace', () => {
    expect(etaText(0, null, 3)).toContain('Alhamdulillah');
    expect(etaText(10, null, 0)).toContain('Sisa 10 halaman');
    const t = etaText(10, new Date(2026, 10, 3, 12), 2.5);
    expect(t).toContain('khatam sekitar 3 November 2026');
    expect(t).toContain('2,5 halaman per hari');
  });
});

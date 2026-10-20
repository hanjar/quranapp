import { describe, expect, it } from 'vitest';
import { looksMetered } from './install-prompt';

const nav = (connection?: object) => ({ connection }) as unknown as Navigator;

describe('looksMetered', () => {
  it('is false when the Network Information API is unavailable', () => {
    expect(looksMetered(nav())).toBe(false);
  });

  it('flags data saver, cellular and slow connections', () => {
    expect(looksMetered(nav({ saveData: true }))).toBe(true);
    expect(looksMetered(nav({ type: 'cellular' }))).toBe(true);
    expect(looksMetered(nav({ effectiveType: '3g' }))).toBe(true);
  });

  it('does not flag wifi / 4g without data saver', () => {
    expect(looksMetered(nav({ type: 'wifi', effectiveType: '4g', saveData: false }))).toBe(false);
  });
});

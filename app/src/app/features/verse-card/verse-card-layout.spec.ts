import { cardFileName, splitWords, wordsOnPage, wrap } from './verse-card-layout';
import type { QcfLayout } from '../reader/qcf-logic';

describe('verse card layout', () => {
  it('wraps items greedily within the width', () => {
    expect(wrap([40, 40, 40], 100, 10)).toEqual([[0, 2], [2, 3]]);
    expect(wrap([150, 20], 100, 10)).toEqual([[0, 1], [1, 2]]);
    expect(wrap([], 100, 10)).toEqual([]);
  });

  it('collects the words of one ayah and notices its end ornament', () => {
    const layout: QcfLayout = {
      format: 'mushaf-qcf',
      version: 1,
      page: 42,
      lines: [
        { n: 1, type: 'text', words: [{ code: 'a', verse: '2:254' }, { code: 'b', verse: '2:255' }] },
        { n: 2, type: 'text', words: [{ code: 'c', verse: '2:255' }, { code: 'd', verse: '2:255', type: 'end' }] },
      ],
    };
    const r = wordsOnPage(layout, 'mf-qcf-p42', '2:255');
    expect(r.words.map((w) => w.code)).toEqual(['b', 'c', 'd']);
    expect(r.words[2]!.end).toBe(true);
    expect(r.ended).toBe(true);
    expect(wordsOnPage(layout, 'f', '2:254').ended).toBe(false);
  });

  it('names and words', () => {
    expect(cardFileName(2, 255)).toBe('QS-2-255.png');
    expect(splitWords('  Allah,  tidak ada ')).toEqual(['Allah,', 'tidak', 'ada']);
  });
});

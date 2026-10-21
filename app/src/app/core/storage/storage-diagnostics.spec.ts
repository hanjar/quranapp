import {
  STORAGE_ERROR_LIMIT,
  clearStorageErrors,
  formatStorageErrors,
  recentStorageErrors,
  recordStorageError,
} from './storage-diagnostics';

describe('storage diagnostics', () => {
  beforeEach(() => clearStorageErrors());

  it('keeps only the last 20 errors, oldest first', () => {
    for (let i = 0; i < 25; i++) recordStorageError('op', new Error('e' + i), i);
    const list = recentStorageErrors();
    expect(list).toHaveLength(STORAGE_ERROR_LIMIT);
    expect(list[0]?.message).toBe('e5');
    expect(list.at(-1)?.message).toBe('e24');
  });

  it('records name, message, op and time; handles non-Error values', () => {
    const e = new Error('bad');
    e.name = 'DatabaseClosedError';
    recordStorageError('toggle', e, 0);
    recordStorageError('x', 'plain', 0);
    const [a, b] = recentStorageErrors();
    expect(a).toMatchObject({ name: 'DatabaseClosedError', message: 'bad', op: 'toggle', at: 0 });
    expect(b?.message).toBe('plain');
    expect(formatStorageErrors()).toContain('[toggle] DatabaseClosedError: bad');
  });
});

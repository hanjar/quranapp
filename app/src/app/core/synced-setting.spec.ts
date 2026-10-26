import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UserDataApi } from './contracts';
import { PrefExtraValue } from './models';
import { syncedSetting } from './synced-setting';

const LOCAL = 'mf-test-setting';

function setup(extra: Record<string, PrefExtraValue> = {}) {
  const prefs = signal({ extra, fieldTimes: {} as Record<string, number> });
  const ready = signal(false);
  const setExtra = vi.fn(async (key: string, value: PrefExtraValue | null, at?: number) => {
    const next = { ...prefs().extra };
    if (value === null) delete next[key];
    else next[key] = value;
    prefs.set({ extra: next, fieldTimes: at === undefined ? {} : { [`extra.${key}`]: at } });
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: UserDataApi, useValue: { prefs, ready, setExtra } }] });
  const s = runInInjectionContext(TestBed.inject(Injector), () =>
    syncedSetting<'a' | 'b'>('t', LOCAL, (r) => (r === 'b' ? 'b' : 'a'), (v) => (v === 'a' ? null : v)),
  );
  return { s, prefs, ready, setExtra };
}

describe('syncedSetting', () => {
  beforeEach(() => localStorage.removeItem(LOCAL));

  it('follows the account value and mirrors it to the local key', () => {
    const { s, prefs } = setup();
    expect(s.value()).toBe('a');
    prefs.set({ extra: { t: 'b' }, fieldTimes: {} });
    TestBed.tick();
    expect(s.value()).toBe('b');
    expect(localStorage.getItem(LOCAL)).toBe('b');
    prefs.set({ extra: { t: '' }, fieldTimes: {} }); // '' = default
    TestBed.tick();
    expect(s.value()).toBe('a');
    expect(localStorage.getItem(LOCAL)).toBeNull();
  });

  it('set writes the account and the local key', () => {
    const { s, setExtra } = setup();
    s.set('b');
    expect(setExtra).toHaveBeenCalledWith('t', 'b');
    expect(s.value()).toBe('b');
    s.set('a');
    expect(setExtra).toHaveBeenLastCalledWith('t', '');
  });

  it('moves an old device-only value to the account once, with the oldest time', () => {
    localStorage.setItem(LOCAL, 'b');
    const { s, ready, setExtra } = setup();
    expect(s.value()).toBe('b');
    ready.set(true);
    TestBed.tick();
    expect(setExtra).toHaveBeenCalledTimes(1);
    expect(setExtra).toHaveBeenCalledWith('t', 'b', 1);
  });

  it('a value already in the account wins over the device', () => {
    localStorage.setItem(LOCAL, 'b');
    const { s, ready, setExtra } = setup({ t: '' });
    ready.set(true);
    TestBed.tick();
    expect(setExtra).not.toHaveBeenCalled();
    expect(s.value()).toBe('a');
  });
});

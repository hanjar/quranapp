import { installFakeIndexedDb } from './testing';
import { TestBed } from '@angular/core/testing';
import { UserDataService } from './user-data.service';
import { MUSHAF_DB } from './db-token';
import { MushafDb } from './db';
import { DEFAULT_PREFERENCES } from '../models';
import { devicePrefsMigrationPatch, readLegacyDevicePrefs } from './device-prefs-migration';

installFakeIndexedDb();

describe('readLegacyDevicePrefs', () => {
  const from = (m: Record<string, string>) => readLegacyDevicePrefs((k) => m[k] ?? null);

  it('reads present, valid values only', () => {
    expect(
      from({
        'mf-line-rules': 'on',
        'mf-tr-latin': '1',
        'mf-tr-size': '1.5',
        'mf-audio-mode': 'page',
        'mf-audio-follow': '0',
        'mf-page-renderer': 'qcf-tajweed',
      }),
    ).toEqual({
      lineRules: true,
      showLatin: true,
      translationScale: 1.45,
      audioMode: 'page',
      audioFollow: false,
      pageRenderer: 'qcf-tajweed',
    });
    expect(from({ 'mf-audio-mode': 'bogus', 'mf-tr-size': 'abc', 'mf-page-renderer': 'x' })).toEqual({});
    expect(from({})).toEqual({});
  });

  it('only fills fields the stored row never had', () => {
    expect(devicePrefsMigrationPatch(undefined, { lineRules: true })).toEqual({ lineRules: true });
    expect(devicePrefsMigrationPatch({ lineRules: false }, { lineRules: true, showLatin: true })).toEqual({
      showLatin: true,
    });
  });
});

describe('UserDataService device-prefs migration', () => {
  let db: MushafDb;
  beforeEach(() => {
    localStorage.clear();
    db = new MushafDb('test-' + Math.random());
  });
  const create = async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: MUSHAF_DB, useValue: db }] });
    const svc = TestBed.inject(UserDataService);
    await svc.init();
    return svc;
  };

  it('adopts localStorage values once, then ignores later localStorage changes', async () => {
    localStorage.setItem('mf-line-rules', 'on');
    localStorage.setItem('mf-audio-mode', 'ayah');
    let svc = await create();
    expect(svc.prefs()).toMatchObject({ lineRules: true, audioMode: 'ayah', showLatin: false });
    localStorage.setItem('mf-line-rules', 'off');
    svc = await create();
    expect(svc.prefs().lineRules).toBe(true);
  });

  it('keeps defaults when nothing is stored, and does not overwrite existing synced values', async () => {
    let svc = await create();
    expect(svc.prefs()).toMatchObject({ lineRules: false, audioMode: 'surah', audioFollow: true, pageRenderer: 'classic' });
    await db.meta.delete('migr:device-prefs-synced');
    await db.prefs.put({ ...DEFAULT_PREFERENCES, key: 'prefs', lineRules: false, updatedAt: 5 });
    localStorage.setItem('mf-line-rules', 'on');
    svc = await create();
    expect(svc.prefs().lineRules).toBe(false);
  });

  it('enqueues the adopted values for sync when signed in', async () => {
    await db.sync.put({ key: 'state', enabled: true, accountId: 'acc1', cursor: 0, lastSuccessAt: null, status: 'idle', lastErrorCode: null });
    localStorage.setItem('mf-tr-latin', '1');
    await create();
    const ops = await db.outbox.toArray();
    expect(ops.find((o) => o.entity === 'prefs')?.payload).toMatchObject({ showLatin: true });
  });
});

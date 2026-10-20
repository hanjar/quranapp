import { installFakeIndexedDb } from './testing';
import { TestBed } from '@angular/core/testing';
import { MushafDb } from './db';
import { MUSHAF_DB } from './db-token';
import {
  DB_BLOCKED_MESSAGE,
  DB_OPEN_TIMEOUT_MS,
  DB_OUTDATED_MESSAGE,
  StorageUnavailableError,
  UserDataService,
} from './user-data.service';
import { ReaderUiService } from '../reader-ui.service';

installFakeIndexedDb();

const setup = (db: MushafDb) => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: MUSHAF_DB, useValue: db }] });
  return TestBed.inject(UserDataService);
};

describe('UserDataService with a contended IndexedDB', () => {
  afterEach(() => vi.useRealTimers());

  it('closes its connection when another tab upgrades the schema and rejects writes with a reload hint', async () => {
    const name = 'vc-' + Math.random();
    const db = new MushafDb(name);
    const svc = setup(db);
    await svc.init();
    await svc.setPrefs({ paperTheme: 'cream' });

    // "Newer tab": same database, higher schema version.
    const newer = new MushafDb(name);
    newer.version(99).stores({ extra: 'id' });
    await newer.open();

    expect(db.outdated).toBe(true);
    expect(db.isOpen()).toBe(false);
    const ui = TestBed.inject(ReaderUiService);
    expect(ui.toast()?.message).toBe(DB_OUTDATED_MESSAGE);
    expect(ui.toast()?.actionLabel).toBe('Muat ulang');
    await expect(svc.setPrefs({ paperTheme: 'photo' })).rejects.toBeInstanceOf(StorageUnavailableError);
    // The queue is not poisoned: the rejection is per call.
    await expect(svc.setPrefs({ paperTheme: 'antique' })).rejects.toBeInstanceOf(StorageUnavailableError);
    newer.close();
  });

  it('does not hang when an old connection blocks the upgrade', async () => {
    const name = 'bl-' + Math.random();
    // Old tab: raw connection without any versionchange handler (never closes).
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('prefs', { keyPath: 'key' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const db = new MushafDb(name);
    const svc = setup(db);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const write = svc.setPrefs({ paperTheme: 'cream' });
    const assertion = expect(write).rejects.toThrow(DB_BLOCKED_MESSAGE);
    await vi.advanceTimersByTimeAsync(DB_OPEN_TIMEOUT_MS + 100);
    await assertion;
    expect(TestBed.inject(ReaderUiService).toast()?.message).toBe(DB_BLOCKED_MESSAGE);

    // Once the old tab goes away the very same service works again, nothing lost.
    old.close();
    vi.useRealTimers();
    await svc.setPrefs({ paperTheme: 'cream' });
    expect(svc.prefs().paperTheme).toBe('cream');
  });
});

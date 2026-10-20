/**
 * Test-only: binds Dexie to a fake IndexedDB explicitly. `import 'fake-indexeddb/auto'`
 * only installs globals once per module graph, which breaks when several specs share a
 * bundle chunk (each spec runs in a fresh global). Call this at the top of every spec.
 */
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb';

export function installFakeIndexedDb(): void {
  const factory = new IDBFactory();
  const g = globalThis as Record<string, unknown>;
  g['indexedDB'] = factory;
  g['IDBKeyRange'] = FakeKeyRange;
  Dexie.dependencies.indexedDB = factory;
  Dexie.dependencies.IDBKeyRange = FakeKeyRange;
}

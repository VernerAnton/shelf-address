/**
 * A tiny key-value store on IndexedDB, for what the Scan screen must keep on
 * the phone across restarts and without signal: the upload queue, recent
 * scans, the saved copy of the location tree, the active place.
 *
 * IndexedDB rather than localStorage: it survives better under storage
 * pressure on iOS, and it's available to a service worker should one ever
 * need to drain the queue.
 */

const DB_NAME = "shelf-address";
const STORE = "kv";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>("readonly", (store) => store.get(key));
}

export function kvSet(key: string, value: unknown): Promise<void> {
  return run<void>("readwrite", (store) => store.put(value, key));
}

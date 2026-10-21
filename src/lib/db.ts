// Minimal IndexedDB wrapper: persists photos and their CLIP vectors locally so
// the library and embeddings survive page reloads without any server.

export interface PhotoRecord {
  key: string
  name: string
  blob: Blob
  vector: Float32Array
}

const DB_NAME = 'photo-search'
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE)
        const req = run(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export function getAllPhotos(): Promise<PhotoRecord[]> {
  return tx('readonly', (s) => s.getAll() as IDBRequest<PhotoRecord[]>)
}

export function putPhoto(record: PhotoRecord): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(record))
}

export function deletePhoto(key: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>)
}

export function clearPhotos(): Promise<undefined> {
  return tx('readwrite', (s) => s.clear() as IDBRequest<undefined>)
}

/** Stable content signature so the same file isn't re-embedded. */
export function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`
}

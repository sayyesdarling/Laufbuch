// Small promise wrapper around IndexedDB.
// Stores: sessions (planned runs + what you logged), activities (imported runs), kv (settings, plan block, flags).

const DB_NAME = "laufbuch";
const DB_VERSION = 1;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" }).createIndex("date", "date");
      if (!db.objectStoreNames.contains("activities")) db.createObjectStore("activities", { keyPath: "id" }).createIndex("date", "date");
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("The database is open in another tab. Close it and try again."));
  });
  return dbp;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  }));
}

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export function getAll(store) { return tx(store, "readonly", s => reqP(s.getAll())); }
export function get(store, key) { return tx(store, "readonly", s => reqP(s.get(key))); }
export function put(store, val) { return tx(store, "readwrite", s => { s.put(val); }); }
export function putMany(store, vals) { return tx(store, "readwrite", s => { vals.forEach(v => s.put(v)); }); }
export function del(store, key) { return tx(store, "readwrite", s => { s.delete(key); }); }
export function delMany(store, keys) { return tx(store, "readwrite", s => { keys.forEach(k => s.delete(k)); }); }
export function clearStore(store) { return tx(store, "readwrite", s => { s.clear(); }); }

export async function getKV(key) { const r = await get("kv", key); return r ? r.value : undefined; }
export function setKV(key, value) { return put("kv", { key, value }); }

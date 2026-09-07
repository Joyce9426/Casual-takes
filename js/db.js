// ---------- IndexedDB wrapper ----------
const DB_NAME = 'sunday-roster-m-db';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('seasons')) {
        db.createObjectStore('seasons', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('members')) {
        db.createObjectStore('members', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('seasonPasses')) {
        const s = db.createObjectStore('seasonPasses', { keyPath: 'id' });
        s.createIndex('seasonId', 'seasonId', { unique: false });
        s.createIndex('memberId', 'memberId', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('seasonId', 'seasonId', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessionRosters')) {
        const s = db.createObjectStore('sessionRosters', { keyPath: 'id' });
        s.createIndex('sessionId', 'sessionId', { unique: false });
        s.createIndex('memberId', 'memberId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // 一個場次最多一筆（id 直接用 sessionId），重新分組就是覆寫同一筆。
      if (!db.objectStoreNames.contains('sessionGroupings')) {
        db.createObjectStore('sessionGroupings', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = 'readonly') {
  return openDb().then((db) => db.transaction(storeNames, mode));
}

// ---------- Raw (unfiltered, unstamped) access ----------
// These bypass the soft-delete filter and the updatedAt auto-stamping. They
// exist for two internal purposes only:
//  1. The sync engine (js/sync.js) needs to see tombstoned (deleted) records
//     when scanning for local changes to push, and needs to write incoming
//     records from the server WITHOUT re-stamping updatedAt (otherwise every
//     device would think its just-pulled data is newer than it really is,
//     causing endless re-sync loops).
//  2. remove()/removeMany() need to read the current record (even if already
//     a tombstone) to build the next tombstone from it.
// Everything else in the app should keep using the normal get*/put functions.
async function getAllRawInternal(store) {
  const t = await tx([store]);
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getByIdRawInternal(store, id) {
  const t = await tx([store]);
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getByIndexRawInternal(store, indexName, value) {
  const t = await tx([store]);
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putRawInternal(store, obj) {
  const t = await tx([store], 'readwrite');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).put(obj);
    req.onsuccess = () => resolve(obj);
    req.onerror = () => reject(req.error);
  });
}

async function putManyRawInternal(store, objs) {
  const t = await tx([store], 'readwrite');
  return new Promise((resolve, reject) => {
    const os = t.objectStore(store);
    objs.forEach((o) => os.put(o));
    t.oncomplete = () => resolve(objs);
    t.onerror = () => reject(t.error);
  });
}

export const getAllRaw = getAllRawInternal;
export const getByIdRaw = getByIdRawInternal;
export const putRaw = putRawInternal;
export const putManyRaw = putManyRawInternal;

// ---------- Public read access (soft-deleted records hidden) ----------
export async function getAll(store) {
  const all = await getAllRawInternal(store);
  return all.filter((r) => !r.deleted);
}

export async function getById(store, id) {
  const r = await getByIdRawInternal(store, id);
  return r && !r.deleted ? r : null;
}

export async function getByIndex(store, indexName, value) {
  const all = await getByIndexRawInternal(store, indexName, value);
  return all.filter((r) => !r.deleted);
}

// ---------- Write notification hook ----------
// A tiny pub-sub so sync.js can debounce-push to the server after any local
// write, WITHOUT db.js importing sync.js (that would create a circular
// import: sync.js already needs to import db.js). Only the public write
// functions below notify — the *Raw variants are used internally by the
// sync engine itself when applying incoming pulled data, and must NOT
// re-trigger a push (that would ping-pong forever).
const writeListeners = [];
export function onDataWrite(fn) {
  writeListeners.push(fn);
}
function notifyDataWrite() {
  for (const fn of writeListeners) {
    try { fn(); } catch (e) { console.error('onDataWrite listener threw:', e); }
  }
}

// ---------- Public write access (auto-stamps updatedAt for the sync engine) ----------
export async function put(store, obj) {
  const stamped = { ...obj, updatedAt: Date.now() };
  const result = await putRawInternal(store, stamped);
  notifyDataWrite();
  return result;
}

export async function putMany(store, objs) {
  const stamped = objs.map((o) => ({ ...o, updatedAt: Date.now() }));
  const result = await putManyRawInternal(store, stamped);
  notifyDataWrite();
  return result;
}

// remove()/removeMany() are SOFT deletes: the record is kept as a "tombstone"
// (deleted: true) instead of actually being removed from IndexedDB. This is
// what lets the cloud sync engine tell other devices "this was deleted"
// instead of them just seeing the record vanish and not knowing why. Every
// normal read (getAll/getById/getByIndex) hides tombstoned records
// automatically, so the rest of the app behaves exactly as before.
export async function remove(store, id) {
  const existing = await getByIdRawInternal(store, id);
  const tombstone = { ...(existing || { id }), deleted: true };
  return put(store, tombstone);
}

export async function removeMany(store, ids) {
  const tombstones = [];
  for (const id of ids) {
    const existing = await getByIdRawInternal(store, id);
    tombstones.push({ ...(existing || { id }), deleted: true });
  }
  return putMany(store, tombstones);
}

export async function clearStore(store) {
  const t = await tx([store], 'readwrite');
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export const STORES = ['seasons', 'members', 'seasonPasses', 'sessions', 'sessionRosters', 'sessionGroupings', 'settings'];

// 登入、登出、admin 切換「檢視成某個使用者」時呼叫：把本機快取整個清空，
// 之後由 sync.js 從伺服器重新拉一份該身分的資料下來。故意不呼叫
// notifyDataWrite()——這不是使用者的資料異動，是身分切換，不該觸發一次
// 「推送」（這時候本機根本沒有資料可推，而且伺服器才是要被拉取的一方）。
export async function resetLocalData() {
  for (const store of STORES) {
    await clearStore(store);
  }
}

// ---------- Settings helpers ----------
const DEFAULT_PAYMENT_METHODS = ['現金', '轉帳', 'LinePay', '其他'];

export async function getSettings() {
  const s = await getById('settings', 'app');
  if (s) {
    // Backfill fields added in later versions so older settings docs (created
    // before this feature existed) still have sensible defaults.
    let changed = false;
    if (!Array.isArray(s.lineTargets)) { s.lineTargets = []; changed = true; }
    if (typeof s.lineRelayApiKey !== 'string') { s.lineRelayApiKey = ''; changed = true; }
    if (typeof s.lastPushedAt !== 'number') { s.lastPushedAt = 0; changed = true; }
    if (typeof s.lastPulledAt !== 'number') { s.lastPulledAt = 0; changed = true; }
    if (s.lastSyncedAt === undefined) { s.lastSyncedAt = null; changed = true; }
    // 已經被拿掉的舊欄位（Worker 網址改成寫死在 config.js、同步不再是選配
    // 功能）——如果是從舊版資料匯入/殘留的，這裡順手清掉，避免留著沒用的
    // 欄位造成混淆。
    if ('lineRelayUrl' in s) { delete s.lineRelayUrl; changed = true; }
    if ('syncEnabled' in s) { delete s.syncEnabled; changed = true; }
    if ('syncKey' in s) { delete s.syncKey; changed = true; }
    // Each shared field gets its OWN updatedAt (not one combined timestamp for
    // all three) — otherwise editing just one of them (say, adding a LINE
    // target) bumps a single shared clock that, on the next push, re-sends a
    // full snapshot of ALL three fields using this device's current values.
    // If another device's edit to a DIFFERENT field lands with an earlier
    // timestamp, this snapshot would silently overwrite it. Per-field
    // timestamps make each field sync (and last-write-win) independently.
    for (const field of SHARED_SETTINGS_FIELDS) {
      const key = sharedFieldTimestampKey(field);
      if (typeof s[key] !== 'number') {
        // First time seeing this on an existing record: stamp "now" (not 0)
        // so whatever this device already has saved becomes eligible to push
        // on the very next sync, instead of silently never syncing because 0
        // never beats an already-advanced lastPushedAt cursor.
        s[key] = Date.now();
        changed = true;
      }
    }
    if (changed) await put('settings', s);
    return s;
  }
  const fresh = {
    key: 'app',
    paymentMethods: DEFAULT_PAYMENT_METHODS,
    activeSeasonId: null,
    lineRelayApiKey: '',
    lineTargets: [],
    lastPushedAt: 0,
    lastPulledAt: 0,
    lastSyncedAt: null,
  };
  for (const field of SHARED_SETTINGS_FIELDS) fresh[sharedFieldTimestampKey(field)] = 0;
  await put('settings', fresh);
  return fresh;
}

// Fields in the settings object that are safe (non-secret) and useful to
// follow the ACCOUNT across its own devices via cloud sync: a payment-method
// label or a saved LINE chat target isn't sensitive the way the LINE
// 通關密語 (lineRelayApiKey) is. Everything else in settings
// (lineRelayApiKey, activeSeasonId, the sync bookkeeping timestamps) stays
// strictly per-device and is never synced — lineRelayApiKey especially is
// kept out on purpose, same reasoning as before: if this account's login
// ever leaked, that shouldn't automatically also hand over the ability to
// send LINE messages on every device.
export const SHARED_SETTINGS_FIELDS = ['lineTargets', 'paymentMethods'];

export function sharedFieldTimestampKey(field) {
  return `${field}UpdatedAt`;
}

// saveSettings does a read-modify-write (fetch current settings, merge in the
// patch, write it back). If two calls happen close together — e.g. clicking
// "儲存 LINE 設定" and "儲存同步設定" right after each other, or the quick-
// setup paste flow which naturally leads to exactly that — they could
// interleave and one save would silently clobber the other's change. Chaining
// every call through this queue forces them to run one at a time, so each
// one's "read" always sees the previous one's "write" already landed.
let saveSettingsQueue = Promise.resolve();

export function saveSettings(patch) {
  const result = saveSettingsQueue.then(async () => {
    const current = await getSettings();
    const merged = { ...current, ...patch };
    for (const field of SHARED_SETTINGS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        merged[sharedFieldTimestampKey(field)] = Date.now();
      }
    }
    await put('settings', merged);
    return merged;
  });
  // Keep the shared queue chain alive for the NEXT call no matter what — if
  // THIS call fails, its rejection still propagates to whoever called
  // saveSettings this time (via `result`), but it must not permanently wedge
  // every future call behind a rejected promise.
  saveSettingsQueue = result.catch(() => {});
  return result;
}

// Used only by the sync engine when applying an incoming shared-settings
// FIELD from another device — updates just that one field (and its own
// per-field timestamp), preserving the SERVER's updatedAt (not "now"), for
// the same reason putRaw exists for the other stores: re-stamping would make
// every device think its just-pulled data is newer than it really is.
export async function applyIncomingSharedSettingsField(field, value, updatedAt) {
  const current = (await getByIdRaw('settings', 'app')) || { key: 'app' };
  const merged = { ...current, [field]: value, [sharedFieldTimestampKey(field)]: updatedAt };
  return putRawInternal('settings', merged);
}

// ---------- Export / Import ----------
export async function exportAllData() {
  const data = {};
  for (const store of STORES) {
    data[store] = await getAll(store);
  }
  data.__meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
  return data;
}

export async function importAllData(data) {
  for (const store of STORES) {
    if (!Array.isArray(data[store])) continue;
    await clearStore(store);
    await putMany(store, data[store]);
  }
}

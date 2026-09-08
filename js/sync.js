// ---------------------------------------------------------------------------
// 雲端同步引擎（會員版）。
//
// 跟舊版最大的不同：這不是選配功能，登入之後就一定會用到。資料本身還是以
// 本機 IndexedDB 為主（讀取一律讀本機、畫面反應快），但現在：
// - 每一筆本機寫入（新增/修改/刪除）都會在短暫防抖（debounce）之後自動推
//   上伺服器，不需要使用者按任何「同步」按鈕。
// - 每次登入、或 admin 切換「檢視成某個使用者」時，會先把本機資料整個清
//   空，再從伺服器整份拉下來，確保看到的一定是「這個身分在伺服器上」的
//   資料，不會有上一個使用者留下的殘留資料。
// - 認證方式從舊版「全部裝置共用一組 X-Sync-Key」改成「登入 token」，
//   資料依帳號自動隔離（實際隔離邏輯在 Worker 那邊，見 relay/src/index.js
//   的 resolveSyncOwner）。
// - 401（token 失效）會直接觸發強制登出，回到登入畫面。
// ---------------------------------------------------------------------------
import {
  getSettings, saveSettings, getAllRaw, getByIdRaw, putManyRaw,
  applyIncomingSharedSettingsField, sharedFieldTimestampKey, SHARED_SETTINGS_FIELDS,
  resetLocalData, onDataWrite,
} from './db.js';
import { api, ApiError } from './api.js';
import { isLoggedIn, getViewingAs, setViewingAs, forceLogout } from './session.js';

// These stores sync wholesale — every record, every field.
const SYNCED_STORES = ['seasons', 'members', 'seasonPasses', 'sessions', 'sessionRosters', 'sessionGroupings'];

// 'settings' 另外處理（見 collectDirtyChanges/pullChanges）：只有白名單裡
// 這幾個非機密欄位（常用聊天室、繳費方式）會同步，而且每個欄位各自用自己
// 的時間戳記獨立同步（id 是 "shared:<field>"），不是整包 settings 記錄綁在
// 一起——因為 settings 記錄本身還存著這台裝置自己的同步書籤
// （lastPushedAt/lastPulledAt），如果整包同步，會變成自己把自己正在用的
// 同步游標蓋掉，造成同步邏輯打結。
const SETTINGS_ID_PREFIX = 'shared:';

const PUSH_BATCH_SIZE = 200;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 把 401 轉成「強制登出」，其他錯誤原樣往外丟給呼叫端處理/顯示。
function handleSyncError(err) {
  if (err instanceof ApiError && err.status === 401) {
    forceLogout('登入狀態已失效，請重新登入');
  }
  throw err;
}

async function collectDirtyChanges(sinceTimestamp) {
  const changes = [];
  for (const store of SYNCED_STORES) {
    const all = await getAllRaw(store);
    for (const rec of all) {
      const updatedAt = Number(rec.updatedAt) || 0;
      if (updatedAt > sinceTimestamp) {
        changes.push({ store, id: rec.id, data: rec, updatedAt, deleted: Boolean(rec.deleted) });
      }
    }
  }

  const settings = await getSettings();
  for (const field of SHARED_SETTINGS_FIELDS) {
    const fieldUpdatedAt = Number(settings[sharedFieldTimestampKey(field)]) || 0;
    if (fieldUpdatedAt > sinceTimestamp) {
      changes.push({ store: 'settings', id: SETTINGS_ID_PREFIX + field, data: { [field]: settings[field] }, updatedAt: fieldUpdatedAt, deleted: false });
    }
  }

  return changes;
}

export async function pushChanges() {
  const settings = await getSettings();
  const since = settings.lastPushedAt || 0;
  const changes = await collectDirtyChanges(since);
  if (changes.length === 0) return { pushed: 0 };

  const asUserId = getViewingAs()?.id || null;
  let maxUpdatedAt = since;
  try {
    for (const batch of chunk(changes, PUSH_BATCH_SIZE)) {
      await api.syncPush(batch, asUserId);
      for (const c of batch) if (c.updatedAt > maxUpdatedAt) maxUpdatedAt = c.updatedAt;
    }
  } catch (err) {
    handleSyncError(err);
  }

  await saveSettings({ lastPushedAt: maxUpdatedAt });
  return { pushed: changes.length };
}

export async function pullChanges() {
  const settings = await getSettings();
  const since = settings.lastPulledAt || 0;
  const asUserId = getViewingAs()?.id || null;

  let json;
  try {
    json = await api.syncPull(since, asUserId);
  } catch (err) {
    handleSyncError(err);
  }
  const records = Array.isArray(json.records) ? json.records : [];

  let maxUpdatedAt = since;
  const byStore = {};
  const incomingSharedFields = {};
  for (const rec of records) {
    if (rec.store === 'settings' && typeof rec.id === 'string' && rec.id.startsWith(SETTINGS_ID_PREFIX)) {
      const field = rec.id.slice(SETTINGS_ID_PREFIX.length);
      if (SHARED_SETTINGS_FIELDS.includes(field)) {
        const existing = incomingSharedFields[field];
        if (!existing || rec.updatedAt > existing.updatedAt) incomingSharedFields[field] = rec;
      }
    } else if (SYNCED_STORES.includes(rec.store)) {
      (byStore[rec.store] ||= []).push(rec);
    }
    if (rec.updatedAt > maxUpdatedAt) maxUpdatedAt = rec.updatedAt;
  }

  for (const [store, recs] of Object.entries(byStore)) {
    const toWrite = [];
    for (const rec of recs) {
      const local = await getByIdRaw(store, rec.id);
      // Last-write-wins: only apply the incoming record if it's newer than
      // (or the same age as — first time seeing this id — ) what's local.
      if (!local || rec.updatedAt > (Number(local.updatedAt) || 0)) {
        toWrite.push({ ...(rec.data || {}), id: rec.id, deleted: rec.deleted, updatedAt: rec.updatedAt });
      }
    }
    if (toWrite.length) await putManyRaw(store, toWrite);
  }

  for (const [field, rec] of Object.entries(incomingSharedFields)) {
    const currentFieldUpdatedAt = Number((await getSettings())[sharedFieldTimestampKey(field)]) || 0;
    if (rec.updatedAt > currentFieldUpdatedAt) {
      await applyIncomingSharedSettingsField(field, rec.data ? rec.data[field] : undefined, rec.updatedAt);
    }
  }

  // 拉回來的資料本來就已經在伺服器上，不需要再推回去——把 lastPushedAt
  // 墊高到至少等於這次拉到的最新時間，避免下一次 push 把剛拉到的資料誤判
  // 成「本機還沒推送過的異動」又整批推回去（登入、admin 切換檢視、清快取
  // 後最容易誤判，因為那幾種情況 lastPushedAt 會是 0 或明顯落後）。如果
  // 本機的 lastPushedAt 本來就比這次拉到的更新（例如這次 pull 前才剛
  // push 過某筆更新的資料），則維持原本比較新的值，不會往回倒退。
  const latestSettings = await getSettings();
  const nextLastPushedAt = Math.max(Number(latestSettings.lastPushedAt) || 0, maxUpdatedAt);
  await saveSettings({ lastPulledAt: maxUpdatedAt, lastPushedAt: nextLastPushedAt });
  return { pulled: records.length };
}

// 推送優先（讓伺服器先看到自己的最新狀態），再拉取。任何一半失敗，
// lastPushedAt/lastPulledAt 都不會被更新，下次重試會自然從沒完成的地方
// 繼續，兩者之間不需要交易保證。
export async function syncNow() {
  if (!isLoggedIn()) throw new Error('尚未登入');
  const pushResult = await pushChanges();
  const pullResult = await pullChanges();
  await saveSettings({ lastSyncedAt: Date.now() });
  return { ...pushResult, ...pullResult };
}

// 清空本機資料、把同步游標歸零，再整份從伺服器拉下來——用在「剛登入」跟
// 「admin 切換檢視使用者」這兩個時機，確保畫面顯示的一定是目標身分在
// 伺服器上的資料，不會殘留任何上一個身分的本機快取。
export async function hydrateFromServer() {
  await resetLocalData();
  await saveSettings({ lastPushedAt: 0, lastPulledAt: 0 });
  await pullChanges();
  await saveSettings({ lastSyncedAt: Date.now() });
}

// admin 專用：切換「檢視成某個使用者」（或傳 null 切回自己）。
//
// 重要的順序問題：一定要「先把目前身分（可能是 admin 自己）還沒推上去的
// 異動推送出去，再切換身分」——如果順序反過來，先呼叫 setViewingAs 改變
// 了「目前是誰」，這之後才執行的推送會被伺服器誤記成是新身分做的異動，
// 等於把 admin 自己的變更算到別人頭上。所以這裡固定用「先推送、才切換、
// 再整份重新拉取」的順序，呼叫端不需要自己操心這個順序。
export async function switchViewingAs(userOrNull) {
  try {
    await pushChanges();
  } catch (err) {
    // 推送失敗也繼續切換——留在原本的身分反而更麻煩（admin 可能就是要
    // 去處理別人的問題），只是這批還沒推送成功的本機異動，等切回來之後
    // 才會補推。這裡不拋錯，讓切換本身可以順利完成。
    console.warn('切換檢視前的推送失敗，將在切回這個身分後重試：', err.message);
  }
  setViewingAs(userOrNull);
  await hydrateFromServer();
}

// ---------------------------------------------------------------------------
// 自動推送：任何一次本機寫入（db.js 的 put/putMany/remove/removeMany）都會
// 呼叫這裡，短暫防抖後背景推上伺服器。失敗不打擾使用者（不跳錯誤 toast）
// ——下一次寫入，或使用者手動按 header 的同步按鈕，會自然重試。
// ---------------------------------------------------------------------------
let autoPushTimer = null;
const AUTO_PUSH_DEBOUNCE_MS = 800;

function scheduleAutoPush() {
  if (!isLoggedIn()) return;
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    autoPushTimer = null;
    try {
      await pushChanges();
    } catch (err) {
      console.warn('自動推送失敗，會在下次寫入或手動同步時重試：', err.message);
    }
  }, AUTO_PUSH_DEBOUNCE_MS);
}

let autoSyncInitialized = false;
export function initAutoSync() {
  if (autoSyncInitialized) return;
  autoSyncInitialized = true;
  onDataWrite(scheduleAutoPush);
}

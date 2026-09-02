// ---------------------------------------------------------------------------
// 登入狀態管理：token、目前登入的使用者、admin 的「切換檢視使用者」狀態。
//
// - token 存在 localStorage，故意不設過期時間——只有登出、或帳號被 admin
//   停用/重設密碼才會失效（那時伺服器會回 401，見 forceLogout）。
// - 「切換檢視使用者」（viewingAs）只有 admin 能用，存在 sessionStorage
//   （關掉分頁/瀏覽器就重置回檢視自己），避免不小心留在別人的視角下太久。
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'sunday-roster-m:token';
const USER_KEY = 'sunday-roster-m:user';
const VIEWING_AS_KEY = 'sunday-roster-m:viewing-as';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function isLoggedIn() {
  return Boolean(getToken() && getCurrentUser());
}

export function isAdmin() {
  const u = getCurrentUser();
  return Boolean(u && u.role === 'admin');
}

// 呼叫 /auth/login 成功後由 authGate.js 存進來。
export function setSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) { /* ignore（無痕模式等 localStorage 不可用的情況） */ }
}

// 只更新使用者資訊（例如 /auth/me 回來的最新角色），不動 token。
export function updateCurrentUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) { /* ignore */ }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(VIEWING_AS_KEY);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// admin 專用：「檢視成某個使用者」。存的是 { id, username }，方便畫面顯示
// 名字不用額外查一次。null 代表目前檢視自己。
// ---------------------------------------------------------------------------
export function getViewingAs() {
  if (!isAdmin()) return null;
  try {
    const raw = sessionStorage.getItem(VIEWING_AS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setViewingAs(userOrNull) {
  try {
    if (userOrNull) sessionStorage.setItem(VIEWING_AS_KEY, JSON.stringify(userOrNull));
    else sessionStorage.removeItem(VIEWING_AS_KEY);
  } catch (e) { /* ignore */ }
}

// 目前實際要對伺服器操作的「擁有者 id」——admin 切換檢視時是對方的 id，
// 其他情況一律是自己的 id。
export function getEffectiveOwnerId() {
  const viewingAs = getViewingAs();
  if (viewingAs) return viewingAs.id;
  const user = getCurrentUser();
  return user ? user.id : null;
}

// token 失效（401）時統一的處理方式：清掉所有本機狀態，重新整理頁面回到
// 登入畫面。故意用整頁重新整理而不是局部重繪——這樣不用擔心任何模組還留著
// 舊的登入狀態在記憶體裡。
export function forceLogout(reason) {
  clearSession();
  if (typeof window !== 'undefined') {
    if (reason) {
      try { sessionStorage.setItem('sunday-roster-m:logout-reason', reason); } catch (e) { /* ignore */ }
    }
    window.location.reload();
  }
}

export function consumeLogoutReason() {
  try {
    const reason = sessionStorage.getItem('sunday-roster-m:logout-reason');
    if (reason) sessionStorage.removeItem('sunday-roster-m:logout-reason');
    return reason || null;
  } catch (e) {
    return null;
  }
}

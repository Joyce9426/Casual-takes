// ---------- Minimal hash router ----------
import { forceCloseModal } from './utils.js';
import { api, ApiError } from './api.js';
import { isLoggedIn, forceLogout } from './session.js';

const routes = [];
let lastPath = null;

// Point 1: 每次切換 nav（路徑真的變了）時，順手用一支輕量的 API 檢查目前的
// token 是否還有效——不 await、不阻塞畫面渲染，避免每次切 tab 都要多等一次
// 網路來回。如果 token 已經失效（401，例如帳號被 admin 停用、重設密碼，或
// 單純過期），就強制登出、整頁重新整理回到登入畫面。離線或其他網路錯誤時
// 這裡會被吞掉，不影響原本靠本機快取瀏覽的體驗。
function verifyTokenOnNavigate() {
  if (!isLoggedIn()) return;
  api.me().catch((err) => {
    if (err instanceof ApiError && err.status === 401) {
      forceLogout('登入狀態已失效，請重新登入');
    }
    // 其他錯誤（離線、逾時等）忽略，不影響目前頁面。
  });
}

export function route(pattern, handler) {
  // pattern like '/seasons/:id'
  const paramNames = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    paramNames.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ regex, paramNames, handler });
}

export function navigate(path) {
  window.location.hash = '#' + path;
}

async function resolve() {
  const hash = window.location.hash.replace(/^#/, '') || '/dashboard';
  const path = hash.split('?')[0];
  // Point 2: switching pages (via the tabbar or navigate()) should always
  // land at the top of the new page, instead of inheriting whatever scroll
  // position was left on the previous page. refreshCurrentRoute() re-renders
  // the SAME path in place (e.g. after a background sync) and must NOT jump
  // the user's scroll position, so we only reset scroll when the path
  // actually changed.
  const pathChanged = path !== lastPath;
  lastPath = path;
  if (pathChanged) {
    forceCloseModal();
    verifyTokenOnNavigate();
  }
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      updateActiveTab(path);
      await r.handler(params);
      if (pathChanged) window.scrollTo(0, 0);
      return;
    }
  }
  // fallback
  navigate('/dashboard');
}

function updateActiveTab(path) {
  const root = path.split('/')[1] || 'dashboard';
  document.querySelectorAll('#main-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === root);
  });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

export function refreshCurrentRoute() {
  resolve();
}

import { route, startRouter, refreshCurrentRoute, navigate } from './router.js';
import { getById } from './db.js';
import { renderTopbarSeasonPicker, renderViewingAsBanner } from './topbar.js';
import { renderLoginScreen } from './authGate.js';
import { syncNow, hydrateFromServer, initAutoSync } from './sync.js';
import { toast } from './utils.js';
import { isLoggedIn, isAdmin, getCurrentUser, consumeLogoutReason } from './session.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSeasonsList } from './views/seasons.js';
import { renderSeasonDetail } from './views/seasonDetail.js';
import { renderSessionsList } from './views/sessions.js';
import { renderSessionDetail } from './views/sessionDetail.js';
import { renderMembers } from './views/members.js';
import { renderSettings } from './views/settings.js';
import { renderAdminUsers } from './views/adminUsers.js';

const viewRoot = document.getElementById('view-root');

route('/dashboard', async () => {
  viewRoot.innerHTML = '';
  await renderDashboard(viewRoot);
});
route('/seasons', async () => {
  viewRoot.innerHTML = '';
  await renderSeasonsList(viewRoot);
});
route('/seasons/:seasonId', async ({ seasonId }) => {
  viewRoot.innerHTML = '';
  await renderSeasonDetail(viewRoot, seasonId);
});
route('/sessions', async () => {
  viewRoot.innerHTML = '';
  await renderSessionsList(viewRoot);
});
route('/sessions/:sessionId', async ({ sessionId }) => {
  viewRoot.innerHTML = '';
  const session = await getById('sessions', sessionId);
  if (!session) { window.location.hash = '#/sessions'; return; }
  await renderSessionDetail(viewRoot, session.seasonId, sessionId);
});
route('/seasons/:seasonId/sessions/:sessionId', async ({ seasonId, sessionId }) => {
  viewRoot.innerHTML = '';
  await renderSessionDetail(viewRoot, seasonId, sessionId);
});
route('/members', async () => {
  viewRoot.innerHTML = '';
  await renderMembers(viewRoot);
});
route('/settings', async () => {
  viewRoot.innerHTML = '';
  await renderSettings(viewRoot);
});
route('/admin/users', async () => {
  viewRoot.innerHTML = '';
  if (!isAdmin()) {
    toast('這個頁面只有 admin 帳號能進入');
    navigate('/dashboard');
    return;
  }
  await renderAdminUsers(viewRoot);
});

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('Service worker registration failed', e);
    }
  }
}

async function startApp() {
  initAutoSync();
  await renderTopbarSeasonPicker();
  renderViewingAsBanner();
  startRouter();
  registerSW();
  setupSyncButton();

  // 開機時先跟伺服器拉一次最新資料（不只是使用者自己剛剛做的變更，也包含
  // admin 用 as_user 幫忙調整過的、或這個帳號在其他裝置上做的變更），失敗
  // 不打擾使用者——本機快取還在，畫面照樣看得到上次的資料。
  try {
    await syncNow();
    await renderTopbarSeasonPicker();
    await refreshCurrentRoute();
  } catch (err) {
    console.warn('開機同步失敗（將沿用本機快取，可稍後手動按同步重試）：', err.message);
  }
}

function setupSyncButton() {
  const btn = document.getElementById('topbar-sync-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('syncing')) return;
    btn.classList.add('syncing');
    try {
      const result = await syncNow();
      toast(`同步完成（推送 ${result.pushed} 筆、拉取 ${result.pulled} 筆）`);
      await renderTopbarSeasonPicker();
      await refreshCurrentRoute();
    } catch (err) {
      toast(err.message || '同步失敗');
    } finally {
      btn.classList.remove('syncing');
    }
  });
}

function showLoginScreen() {
  const topbar = document.querySelector('.topbar');
  const tabbar = document.querySelector('.tabbar');
  if (topbar) topbar.style.display = 'none';
  if (tabbar) tabbar.style.display = 'none';
  renderLoginScreen(viewRoot, async () => {
    if (topbar) topbar.style.display = '';
    if (tabbar) tabbar.style.display = '';
    toast(`歡迎回來，${getCurrentUser()?.username || ''}`);
    // 剛登入：先把本機資料清空、整份從伺服器拉下來，確保看到的一定是這個
    // 帳號在伺服器上的資料，不會殘留裝置上其他帳號用過的舊快取。
    try {
      await hydrateFromServer();
    } catch (err) {
      toast(err.message || '從伺服器載入資料失敗，請檢查網路連線後重新整理');
    }
    startApp();
  });
}

(function boot() {
  const reason = consumeLogoutReason();
  if (reason) toast(reason);

  if (!isLoggedIn()) {
    showLoginScreen();
    return;
  }
  startApp();
})();

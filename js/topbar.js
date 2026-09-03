import { getAll, getSettings, saveSettings } from './db.js';
import { refreshCurrentRoute, navigate } from './router.js';
import { getCurrentUser, isAdmin, getViewingAs, forceLogout } from './session.js';
import { switchViewingAs } from './sync.js';
import { api, ApiError } from './api.js';
import { toast, escapeHtml } from './utils.js';

export async function renderTopbarSeasonPicker() {
  const el = document.getElementById('topbar-season-picker');
  if (!el) return;
  const seasons = (await getAll('seasons')).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const settings = await getSettings();
  if (seasons.length === 0) {
    el.innerHTML = '';
    return;
  }
  const activeId = settings.activeSeasonId && seasons.some((s) => s.id === settings.activeSeasonId)
    ? settings.activeSeasonId
    : seasons[0].id;
  if (activeId !== settings.activeSeasonId) await saveSettings({ activeSeasonId: activeId });

  el.innerHTML = `<select id="season-picker-select">
    ${seasons.map((s) => `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>${s.name}</option>`).join('')}
  </select>`;
  el.querySelector('select').addEventListener('change', async (e) => {
    await saveSettings({ activeSeasonId: e.target.value });
    await refreshCurrentRoute();
  });
}

// Call after any create/edit/delete of a season, or after switching the
// "viewing as" identity, so the header reflects it immediately.
export async function refreshTopbar() {
  await renderTopbarSeasonPicker();
  await renderAccountSwitcher();
}

// ---------------------------------------------------------------------------
// admin 專用：header 上、app 名稱旁邊的「切換檢視使用者」標籤下拉選單。
//
// 平常顯示的就是一個小標籤，內容是目前實際看到的帳號名稱（自己，或 admin
// 切換檢視中的對象）；點下去展開所有使用者的清單，點其中一個就切過去（點
// 自己就是切回自己）。如果目前正在檢視別人的資料，標籤會換一套顏色樣式，
// 提醒 admin 現在不是在自己的視角下操作。非 admin 帳號完全不會看到這個
// 標籤。
// ---------------------------------------------------------------------------
let outsideClickBound = false;

export async function renderAccountSwitcher() {
  const el = document.getElementById('account-switch');
  if (!el) return;
  if (!isAdmin()) {
    el.innerHTML = '';
    return;
  }

  const me = getCurrentUser();
  const viewingAs = getViewingAs();
  const displayName = viewingAs ? viewingAs.username : (me?.username || '');
  const isViewingOther = Boolean(viewingAs);

  el.innerHTML = `
    <button type="button" class="account-switch-tag${isViewingOther ? ' account-switch-tag--viewing' : ''}" id="account-switch-btn" aria-haspopup="true" aria-expanded="false">
      <span>${escapeHtml(displayName)}</span>
      <svg class="account-switch-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="account-switch-menu hidden" id="account-switch-menu"></div>
  `;

  const btn = el.querySelector('#account-switch-btn');
  const menu = el.querySelector('#account-switch-menu');

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    closeAllAccountSwitchMenus();
    if (!willOpen) return;
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    await loadAccountSwitchMenu(menu);
  });
  menu.addEventListener('click', (e) => e.stopPropagation());

  if (!outsideClickBound) {
    outsideClickBound = true;
    document.addEventListener('click', closeAllAccountSwitchMenus);
  }
}

function closeAllAccountSwitchMenus() {
  document.querySelectorAll('.account-switch-menu').forEach((m) => m.classList.add('hidden'));
  document.querySelectorAll('#account-switch-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

async function loadAccountSwitchMenu(menu) {
  menu.innerHTML = '<div class="account-switch-menu-note small text-faint">載入中…</div>';
  let users = [];
  try {
    const res = await api.listUsers();
    users = res ? res.users : [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      forceLogout('登入狀態已失效，請重新登入');
      return;
    }
    menu.innerHTML = '<div class="account-switch-menu-note small text-faint">載入失敗</div>';
    return;
  }

  const me = getCurrentUser();
  const viewingAs = getViewingAs();
  const currentId = viewingAs ? viewingAs.id : me?.id;

  menu.innerHTML = users.map((u) => {
    const isCurrent = u.id === currentId;
    const isSelf = u.id === me?.id;
    return `
      <button type="button" class="account-switch-menu-item${isCurrent ? ' is-current' : ''}"
        data-user-id="${u.id}" data-username="${escapeHtml(u.username)}" data-is-self="${isSelf ? '1' : '0'}"
        ${u.disabled ? 'disabled' : ''}>
        <span>${escapeHtml(u.username)}${isSelf ? '（我自己）' : ''}</span>
        ${u.disabled ? '<span class="badge badge-crimson">已停用</span>' : ''}
      </button>
    `;
  }).join('') || '<div class="account-switch-menu-note small text-faint">沒有其他帳號</div>';

  menu.querySelectorAll('.account-switch-menu-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const id = item.dataset.userId;
      const username = item.dataset.username;
      const isSelf = item.dataset.isSelf === '1';
      closeAllAccountSwitchMenus();
      if (item.classList.contains('is-current')) return;
      try {
        await switchViewingAs(isSelf ? null : { id, username });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) { forceLogout('登入狀態已失效，請重新登入'); return; }
        toast(err.message || '切換失敗');
        return;
      }
      toast(isSelf ? '已切回自己的檢視' : `已切換檢視成「${username}」`);
      await refreshTopbar();
      navigate('/dashboard');
      await refreshCurrentRoute();
    });
  });
}

import { getAll, getSettings, saveSettings } from './db.js';
import { refreshCurrentRoute } from './router.js';
import { getViewingAs } from './session.js';
import { switchViewingAs } from './sync.js';
import { toast } from './utils.js';

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

// Call after any create/edit/delete of a season so the header dropdown reflects it immediately.
export async function refreshTopbar() {
  await renderTopbarSeasonPicker();
}

// admin 用「切換檢視使用者」的時候，畫面上方會出現一條提示列，說明目前看
// 到的是誰的資料，並提供一鍵切回自己視角的按鈕——避免 admin 忘記自己正在
// 別人的帳號視角下操作。一般使用者、或 admin 沒有切換檢視時，這條列不會
// 出現。
export async function renderViewingAsBanner() {
  const el = document.getElementById('viewing-as-banner');
  if (!el) return;
  const viewingAs = getViewingAs();
  if (!viewingAs) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <span>admin 檢視模式・目前看到的是「${escapeForBanner(viewingAs.username)}」的資料</span>
    <button id="viewing-as-exit-btn">切回我自己</button>
  `;
  el.querySelector('#viewing-as-exit-btn').addEventListener('click', async () => {
    el.querySelector('#viewing-as-exit-btn').disabled = true;
    try {
      await switchViewingAs(null);
      toast('已切回自己的檢視');
    } catch (err) {
      toast(err.message || '切換失敗');
    }
    await renderViewingAsBanner();
    await renderTopbarSeasonPicker();
    await refreshCurrentRoute();
  });
}

function escapeForBanner(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

import { getSettings, saveSettings, exportAllData, importAllData } from '../db.js';
import { toast, confirmDialog, escapeHtml, todayStr, uid } from '../utils.js';
import { navigate } from '../router.js';
import { getCurrentUser, isAdmin, getViewingAs, clearSession } from '../session.js';
import { syncNow } from '../sync.js';
import { api } from '../api.js';
import { refreshTopbar } from '../topbar.js';

function syncStatusText(settings) {
  if (!settings.lastSyncedAt) return '尚未同步過';
  const mins = Math.round((Date.now() - settings.lastSyncedAt) / 60000);
  if (mins < 1) return '上次同步：剛剛';
  if (mins < 60) return `上次同步：${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `上次同步：${hours} 小時前`;
  return `上次同步：${Math.round(hours / 24)} 天前`;
}

export async function renderSettings(root) {
  let settings = await getSettings();
  const me = getCurrentUser();
  const viewingAs = getViewingAs();

  function draw() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>設定</h1>
          <div class="sub">帳號、繳費方式、資料備份</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">帳號</div>
        <p class="small text-soft">登入身分：<strong>${escapeHtml(me?.username || '')}</strong>${isAdmin() ? '　<span class="badge badge-blue">admin</span>' : ''}</p>
        ${viewingAs ? `<p class="small text-faint">目前檢視模式：「${escapeHtml(viewingAs.username)}」的資料（可在下方切回自己或到「使用者管理」切換）</p>` : ''}
        <p class="small text-faint" id="sync-status">${syncStatusText(settings)}</p>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-sm" id="sync-now-btn">立即同步</button>
          <button class="btn btn-sm" id="logout-btn">登出</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">人員管理</div>
        <p class="small text-soft">新增、編輯、刪除人員名單。</p>
        <button class="btn btn-primary btn-sm" id="go-members-btn">前往人員名單</button>
      </div>

      ${isAdmin() ? `
      <div class="card">
        <div class="card-title">使用者管理</div>
        <p class="small text-soft">建立帳號、重設密碼、停用/啟用、切換檢視成某個使用者。</p>
        <button class="btn btn-primary btn-sm" id="go-admin-users-btn">前往使用者管理</button>
      </div>
      ` : ''}

      <div class="card">
        <div class="card-title">繳費方式清單</div>
        <div class="stack" id="method-list">
          ${settings.paymentMethods.map((m, i) => `
            <div class="flex-between" data-method-row="${i}">
              <span>${escapeHtml(m)}</span>
              <button class="icon-btn" data-remove-method="${i}" aria-label="移除">✕</button>
            </div>
          `).join('')}
        </div>
        <div class="flex gap-8 mt-16">
          <input type="text" id="new-method-input" placeholder="新增繳費方式…" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px 10px;box-sizing:border-box;">
          <button class="btn" id="add-method-btn">新增</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">LINE 發送設定</div>
        <div class="field">
          <label>通關密語（X-Api-Key）</label>
          <input type="text" id="line-relay-key" value="${escapeHtml(settings.lineRelayApiKey || '')}">
        </div>
        <button class="btn btn-primary btn-sm" id="save-line-config-btn">儲存設定</button>

        <div class="divider"></div>

        <div class="card-title" style="margin-bottom:6px;">常用聊天室</div>
        <p class="small text-soft" style="margin-top:0;">發送場次名單時，會從這份清單裡選擇要送到哪個聊天室。</p>
        ${settings.lineTargets.length ? `
          <div class="stack">
            ${settings.lineTargets.map((t) => `
              <div class="flex-between">
                <div style="min-width:0;overflow-wrap:anywhere;">
                  <div style="font-weight:600;">${escapeHtml(t.name)}</div>
                  <div class="small text-faint">${escapeHtml(t.groupId)}</div>
                </div>
                <button class="icon-btn" data-remove-target="${t.id}" aria-label="移除">✕</button>
              </div>
            `).join('')}
          </div>
        ` : '<div class="small text-faint">尚未建立任何常用聊天室</div>'}
        <div class="field mt-16">
          <label>名稱</label>
          <input type="text" id="new-target-name" placeholder="例：羽球群">
        </div>
        <div class="field">
          <label>Group ID</label>
          <input type="text" id="new-target-id" placeholder="請輸入UserId">
        </div>
        <button class="btn" id="add-target-btn">＋ 新增聊天室</button>
      </div>

      <div class="card">
        <div class="card-title">資料備份</div>
        <p class="small text-soft">這裡匯出/匯入的是「目前這台裝置本機快取」的資料（跟登入帳號在伺服器上的資料一致）。建議定期匯出備份，以防萬一。</p>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-primary" id="export-btn">匯出 JSON 備份</button>
          <button class="btn" id="import-btn">匯入 JSON 備份</button>
        </div>
        <input type="file" id="import-file" accept="application/json" class="hidden">
      </div>

      <div class="card">
        <div class="card-title">關於</div>
        <p class="small text-soft">隨手場記m・場次人員管理（會員版）　v1.0</p>
      </div>
    `;

    root.querySelector('#go-members-btn').addEventListener('click', () => navigate('/members'));
    const adminUsersBtn = root.querySelector('#go-admin-users-btn');
    if (adminUsersBtn) adminUsersBtn.addEventListener('click', () => navigate('/admin/users'));

    root.querySelector('#sync-now-btn').addEventListener('click', async () => {
      const btn = root.querySelector('#sync-now-btn');
      btn.disabled = true;
      btn.textContent = '同步中…';
      try {
        const result = await syncNow();
        toast(`同步完成（推送 ${result.pushed} 筆、拉取 ${result.pulled} 筆）`);
        settings = await getSettings();
        await refreshTopbar();
        draw();
      } catch (err) {
        toast(err.message || '同步失敗');
        btn.disabled = false;
        btn.textContent = '立即同步';
      }
    });

    root.querySelector('#logout-btn').addEventListener('click', () => {
      confirmDialog('確定要登出嗎？登出後這台裝置的本機快取也會清空，下次要重新登入才能看到資料。', async () => {
        try { await api.logout(); } catch (e) { /* best-effort，token 失效不影響清本機狀態 */ }
        clearSession();
        window.location.reload();
      }, { confirmLabel: '登出', danger: false });
    });

    root.querySelectorAll('[data-remove-method]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.removeMethod);
        const removed = settings.paymentMethods[idx];
        confirmDialog(`移除繳費方式「${escapeHtml(removed)}」？已使用此方式的紀錄不會被更動。`, async () => {
          settings.paymentMethods = settings.paymentMethods.filter((_, i) => i !== idx);
          await saveSettings({ paymentMethods: settings.paymentMethods });
          draw();
          toast('已移除');
        });
      });
    });

    root.querySelector('#add-method-btn').addEventListener('click', async () => {
      const input = root.querySelector('#new-method-input');
      const val = input.value.trim();
      if (!val) return;
      if (settings.paymentMethods.includes(val)) { toast('此方式已存在'); return; }
      settings.paymentMethods = [...settings.paymentMethods, val];
      await saveSettings({ paymentMethods: settings.paymentMethods });
      draw();
      toast('已新增繳費方式');
    });

    root.querySelector('#save-line-config-btn').addEventListener('click', async () => {
      const lineRelayApiKey = root.querySelector('#line-relay-key').value.trim();
      settings.lineRelayApiKey = lineRelayApiKey;
      await saveSettings({ lineRelayApiKey });
      toast('已儲存 LINE 發送設定');
    });

    root.querySelector('#add-target-btn').addEventListener('click', async () => {
      const nameInput = root.querySelector('#new-target-name');
      const idInput = root.querySelector('#new-target-id');
      const name = nameInput.value.trim();
      const groupId = idInput.value.trim();
      if (!name || !groupId) { toast('請輸入名稱與 Group ID'); return; }
      const target = { id: uid(), name, groupId };
      settings.lineTargets = [...settings.lineTargets, target];
      await saveSettings({ lineTargets: settings.lineTargets });
      draw();
      toast('已新增常用聊天室');
    });

    root.querySelectorAll('[data-remove-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = settings.lineTargets.find((x) => x.id === btn.dataset.removeTarget);
        confirmDialog(`確定要移除「${escapeHtml(t?.name || '')}」這個常用聊天室嗎？`, async () => {
          settings.lineTargets = settings.lineTargets.filter((x) => x.id !== btn.dataset.removeTarget);
          await saveSettings({ lineTargets: settings.lineTargets });
          draw();
          toast('已移除');
        });
      });
    });

    root.querySelector('#export-btn').addEventListener('click', async () => {
      const data = await exportAllData();
      const stamp = todayStr();
      const filename = `隨手場記m_備份_${stamp}.json`;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });

      // iOS home-screen (standalone) PWAs don't have Safari's real download manager behind
      // an <a download> click — the browser reports "download complete" but no file ever
      // lands in Files. The share sheet DOES work correctly there, so try it first and only
      // fall back to the classic download link for browsers that can't share files.
      let sharedSuccessfully = false;
      if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
        try {
          const file = new File([blob], filename, { type: 'application/json' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            sharedSuccessfully = true;
            toast('請在分享面板選擇「儲存至檔案」完成備份');
          }
        } catch (err) {
          if (err && err.name === 'AbortError') { sharedSuccessfully = true; } // user just cancelled the sheet
        }
      }

      if (!sharedSuccessfully) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('已匯出備份');
      }
    });

    root.querySelector('#import-btn').addEventListener('click', () => {
      root.querySelector('#import-file').click();
    });
    root.querySelector('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      confirmDialog('匯入將完全覆蓋目前本機的所有資料，並會在下次同步時推送到伺服器（覆蓋雲端上的資料），確定要繼續嗎？', async () => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          await importAllData(data);
          toast('匯入完成，重新載入中…');
          setTimeout(() => window.location.reload(), 600);
        } catch (err) {
          toast('匯入失敗：檔案格式錯誤');
        }
      });
    });
  }

  draw();
}

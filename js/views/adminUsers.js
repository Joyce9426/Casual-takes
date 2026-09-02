import { api, ApiError } from '../api.js';
import { toast, confirmDialog, escapeHtml, openModal, backButtonHtml, attachBackButton } from '../utils.js';
import { getCurrentUser, forceLogout } from '../session.js';
import { switchViewingAs } from '../sync.js';
import { navigate, refreshCurrentRoute } from '../router.js';
import { refreshTopbar, renderViewingAsBanner } from '../topbar.js';

function fmtWhen(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return ''; }
}

async function withErrorToast(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      forceLogout('登入狀態已失效，請重新登入');
      return null;
    }
    toast(err.message || '操作失敗');
    return null;
  }
}

export async function renderAdminUsers(root) {
  const me = getCurrentUser();
  let users = [];

  async function load() {
    const res = await withErrorToast(() => api.listUsers());
    users = res ? res.users : [];
  }

  function draw() {
    root.innerHTML = `
      ${backButtonHtml()}
      <div class="page-head">
        <div>
          <h1>使用者管理</h1>
          <div class="sub">只有 admin 帳號看得到這頁——建立帳號、重設密碼、停用/啟用、切換檢視</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">新增使用者</div>
        <div class="field">
          <label>帳號</label>
          <input type="text" id="new-user-username" autocomplete="off" placeholder="登入用的帳號名稱">
        </div>
        <div class="field">
          <label>密碼</label>
          <input type="text" id="new-user-password" autocomplete="off" placeholder="至少 6 個字元">
        </div>
        <label style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
          <input type="checkbox" id="new-user-admin">
          <span class="small">給這個帳號 admin 權限</span>
        </label>
        <button class="btn btn-primary btn-sm" id="create-user-btn">建立帳號</button>
      </div>

      <div class="card">
        <div class="card-title">所有使用者（共 ${users.length} 位）</div>
        <div class="stack">
          ${users.map((u) => userRowHtml(u, me)).join('') || '<div class="small text-faint">目前沒有其他使用者</div>'}
        </div>
      </div>
    `;

    attachBackButton(root);

    root.querySelector('#create-user-btn').addEventListener('click', async () => {
      const usernameInput = root.querySelector('#new-user-username');
      const passwordInput = root.querySelector('#new-user-password');
      const adminCheckbox = root.querySelector('#new-user-admin');
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username || !password) { toast('請輸入帳號與密碼'); return; }
      if (password.length < 6) { toast('密碼至少需要 6 個字元'); return; }
      const role = adminCheckbox.checked ? 'admin' : 'user';
      const result = await withErrorToast(() => api.createUser({ username, password, role }));
      if (!result) return;
      toast(`已建立帳號「${username}」`);
      await load();
      draw();
    });

    root.querySelectorAll('[data-reset-password]').forEach((btn) => {
      btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.resetPassword, btn.dataset.username));
    });

    root.querySelectorAll('[data-toggle-disabled]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleDisabled;
        const nextDisabled = btn.dataset.nextDisabled === '1';
        const label = nextDisabled ? '停用' : '啟用';
        confirmDialog(`確定要${label}「${escapeHtml(btn.dataset.username)}」這個帳號嗎？${nextDisabled ? '停用後這個帳號所有裝置會立刻被登出，且無法再登入。' : ''}`, async () => {
          const result = await withErrorToast(() => api.updateUser(id, { disabled: nextDisabled }));
          if (!result) return;
          toast(`已${label}`);
          await load();
          draw();
        });
      });
    });

    root.querySelectorAll('[data-view-as]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.viewAs;
        const username = btn.dataset.username;
        btn.disabled = true;
        try {
          await switchViewingAs({ id, username });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) { forceLogout('登入狀態已失效，請重新登入'); return; }
          toast(err.message || '切換失敗');
          btn.disabled = false;
          return;
        }
        toast(`已切換檢視成「${username}」`);
        await renderViewingAsBanner();
        await refreshTopbar();
        navigate('/dashboard');
        await refreshCurrentRoute();
      });
    });
  }

  function userRowHtml(u, me) {
    const isSelf = u.id === me?.id;
    const roleBadge = u.role === 'admin'
      ? '<span class="badge badge-blue">admin</span>'
      : '<span class="badge badge-gray">user</span>';
    const statusBadge = u.disabled ? '<span class="badge badge-crimson">已停用</span>' : '';
    return `
      <div class="card" style="padding:12px 14px;">
        <div class="flex-between" style="align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-weight:600;">${escapeHtml(u.username)} ${isSelf ? '<span class="small text-faint">（我自己）</span>' : ''}</div>
            <div class="small text-faint" style="margin-top:2px;">${roleBadge} ${statusBadge}</div>
            <div class="small text-faint" style="margin-top:4px;">建立於 ${fmtWhen(u.createdAt)}</div>
          </div>
        </div>
        <div class="flex gap-8 mt-8" style="flex-wrap:wrap;">
          ${!isSelf ? `<button class="btn btn-sm" data-view-as="${u.id}" data-username="${escapeHtml(u.username)}">切換檢視</button>` : ''}
          <button class="btn btn-sm" data-reset-password="${u.id}" data-username="${escapeHtml(u.username)}">重設密碼</button>
          ${!isSelf ? `<button class="btn btn-sm" data-toggle-disabled="${u.id}" data-username="${escapeHtml(u.username)}" data-next-disabled="${u.disabled ? '0' : '1'}">${u.disabled ? '啟用' : '停用'}</button>` : ''}
        </div>
      </div>
    `;
  }

  function openResetPasswordModal(userId, username) {
    openModal({
      title: `重設「${username}」的密碼`,
      bodyHtml: `
        <p class="small text-soft">重設後，這個帳號目前所有裝置的登入狀態都會立刻失效，需要用新密碼重新登入。</p>
        <div class="field">
          <label>新密碼</label>
          <input type="text" id="reset-password-input" autocomplete="off" placeholder="至少 6 個字元">
        </div>
      `,
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '確定重設',
          primary: true,
          onClick: async (close, panel) => {
            const password = panel.querySelector('#reset-password-input').value;
            if (!password || password.length < 6) { toast('密碼至少需要 6 個字元'); return; }
            const result = await withErrorToast(() => api.updateUser(userId, { password }));
            if (!result) return;
            close();
            toast('已重設密碼');
          },
        },
      ],
    });
  }

  await load();
  draw();
}

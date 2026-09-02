// ---------------------------------------------------------------------------
// 登入畫面。取代舊版「輸入固定密碼 admin/setting」的防呆層——現在是真正的
// 帳號密碼登入，跟後端 Worker 的 /auth/login 對接，不同帳號登入後只會看到
// 自己的資料（管理面在 session.js／sync.js）。
// ---------------------------------------------------------------------------
import { api, ApiError } from './api.js';
import { setSession } from './session.js';

// 顯示全螢幕登入畫面，成功後呼叫 onLogin(user)。
export function renderLoginScreen(root, onLogin) {
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);">
      <div style="width:100%;max-width:320px;text-align:center;">
        <div style="font-size:2rem;margin-bottom:8px;">◈</div>
        <h1 style="font-family:var(--font-display);font-size:1.3rem;margin-bottom:4px;">隨手場記m</h1>
        <p class="small text-soft" style="margin-bottom:20px;">請登入你的帳號</p>
        <input type="text" id="login-username" placeholder="帳號" autocomplete="username"
          style="width:100%;border:1px solid var(--line);border-radius:8px;padding:11px 12px;text-align:center;margin-bottom:10px;box-sizing:border-box;">
        <input type="password" id="login-password" placeholder="密碼" autocomplete="current-password"
          style="width:100%;border:1px solid var(--line);border-radius:8px;padding:11px 12px;text-align:center;margin-bottom:12px;box-sizing:border-box;">
        <button class="btn btn-primary btn-block" id="login-submit">登入</button>
        <p class="small text-faint" id="login-error" style="margin-top:10px;min-height:1.2em;"></p>
      </div>
    </div>
  `;

  const usernameInput = root.querySelector('#login-username');
  const passwordInput = root.querySelector('#login-password');
  const submitBtn = root.querySelector('#login-submit');
  const errorEl = root.querySelector('#login-error');

  async function attempt() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      errorEl.textContent = '請輸入帳號與密碼';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '登入中…';
    errorEl.textContent = '';
    try {
      const result = await api.login(username, password);
      setSession(result.token, result.user);
      onLogin(result.user);
    } catch (err) {
      errorEl.textContent = err instanceof ApiError && err.status === 401
        ? '帳號或密碼錯誤'
        : (err.message || '登入失敗，請稍後再試');
      passwordInput.value = '';
      passwordInput.focus();
      submitBtn.disabled = false;
      submitBtn.textContent = '登入';
    }
  }

  submitBtn.addEventListener('click', attempt);
  [usernameInput, passwordInput].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  });
  usernameInput.focus();
}

// ---------------------------------------------------------------------------
// 呼叫後端 Worker 的統一入口。所有需要登入的請求都會自動帶上
// Authorization: Bearer <token>；401 由呼叫端（多半是 sync.js）決定要不要
// 強制登出，這裡只負責把狀態碼帶出去，不在這裡直接踢人。
// ---------------------------------------------------------------------------
import { API_BASE_URL } from './config.js';
import { getToken } from './session.js';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('無法連線到伺服器，請確認網路連線', 0);
  }

  let json = null;
  try { json = await res.json(); } catch (e) { /* 沒有 body 或不是 JSON，忽略 */ }

  if (!res.ok) {
    throw new ApiError((json && json.error) || `請求失敗（HTTP ${res.status}）`, res.status);
  }
  return json;
}

export const api = {
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  logout: () => request('/auth/logout', { method: 'POST' }).catch(() => null),
  me: () => request('/auth/me'),

  listUsers: () => request('/admin/users'),
  createUser: (payload) => request('/admin/users', { method: 'POST', body: payload }),
  updateUser: (id, patch) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),

  syncPush: (changes, asUserId) => {
    const qs = asUserId ? `?as_user=${encodeURIComponent(asUserId)}` : '';
    return request(`/sync/push${qs}`, { method: 'POST', body: { changes } });
  },
  syncPull: (since, asUserId) => {
    const params = new URLSearchParams({ since: String(since || 0) });
    if (asUserId) params.set('as_user', asUserId);
    return request(`/sync/pull?${params.toString()}`);
  },
};

export { ApiError };

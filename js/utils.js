// ---------- General utilities ----------

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function nowIso() {
  return new Date().toISOString();
}

export function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('zh-Hant-TW');
}

// Format a Date object as a local yyyy-mm-dd string WITHOUT going through
// toISOString() (which converts to UTC first and shifts the date back by
// one day for any timezone ahead of UTC, e.g. UTC+8 — this was the root
// cause of Sundays showing up as Saturdays for auto-generated sessions).
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}（${weekday}）`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

// Count occurrences of a given weekday (0=Sun...6=Sat, inclusive) between two
// date strings (yyyy-mm-dd). Returns 0 if no weekday is specified (null/
// undefined/''), so "不指定" cleanly means "no auto-generated sessions".
export function countWeekdaysBetween(startStr, endStr, weekday) {
  if (weekday === null || weekday === undefined || weekday === '') return 0;
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || start > end) return 0;
  let count = 0;
  const d = new Date(start);
  const offset = (Number(weekday) - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  while (d <= end) {
    count++;
    d.setDate(d.getDate() + 7);
  }
  return count;
}

// Suggest a season name from date range, e.g. 2026-Q3
export function suggestSeasonName(startStr) {
  if (!startStr) return '';
  const d = new Date(startStr + 'T00:00:00');
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

// List every occurrence of a given weekday (0=Sun...6=Sat, inclusive) between
// two date strings (yyyy-mm-dd). Returns [] if no weekday is specified.
export function listWeekdaysBetween(startStr, endStr, weekday) {
  if (weekday === null || weekday === undefined || weekday === '') return [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || start > end) return [];
  const dates = [];
  const d = new Date(start);
  const offset = (Number(weekday) - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  while (d <= end) {
    dates.push(toDateStr(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// ---------- Season / session status ----------
// Point 1 correction: a season counts as "已結束" (completed) purely based on whether its
// configured end date is before today — NOT whether today falls within [start, end]. This
// means a season that hasn't started yet is still "進行中" (not yet completed), same bucket
// as one currently underway.
export function isSeasonOngoing(season, today = todayStr()) {
  return season.endDate >= today;
}

export function fmtDateOnly(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

// Compact single-line date for tight headers, e.g. "2026/08/02(日)" — half-width
// parens, no spaces, deliberately shorter than fmtDate() so it fits on one line
// at narrow (360px) viewports without wrapping.
export function fmtDateCompact(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}(${weekday})`;
}

export function isSessionUpcoming(session, today = todayStr()) {
  return session.date >= today;
}

// ---------- Settlement result formatting (退款 = "-", 補繳 = "+" in red, 0 = no sign) ----------
export function settlementResultHtml(settlement) {
  if (settlement.isMakeup) {
    return `<span class="amount-makeup">+$${fmtMoney(settlement.makeupAmount)}</span>`;
  }
  if (settlement.refundAmount > 0) {
    return `<span class="amount-refund">-$${fmtMoney(settlement.refundAmount)}</span>`;
  }
  return `<span class="text-faint small">$0</span>`;
}

// Splits a string on any whitespace (including full-width space) into a list of names,
// used for batch-adding multiple people at once from a single text field.
export function parseNamesInput(str) {
  return String(str || '')
    .split(/[\s\u3000]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Shared inline SVG for all "編輯" (edit) icon buttons — fill uses currentColor
// so it automatically follows whatever color the surrounding button/link
// applies (including its :hover state), the same way the app's other icon
// buttons already work.
export const EDIT_ICON_SVG = '<svg viewBox="0 0 110 110" width="22" height="22" fill="currentColor" style="vertical-align:middle;" aria-hidden="true"><path fill-rule="evenodd" d="m30.859 82.434h41.051v-0.042969c5.2852 0 9.6328-4.3047 9.6328-9.6328v-15.473c0-2.7695-2.2578-5.0742-5.0742-5.0742-2.8125 0-5.1133 2.2617-5.1133 5.0742v10.91c0 2.2188-1.7891 4.0078-4.0078 4.0078h-36.488c-2.2148 0-4.0039-1.7891-4.0039-4.0078v-36.484c0-2.2188 1.7891-4.0078 4.0039-4.0078h18.246c2.7695 0 5.0703-2.3008 5.0703-5.0742 0-2.7695-2.2578-5.0703-5.0703-5.0703h-18.246c-7.7969 0-14.191 6.3516-14.191 14.195v36.484c0 7.8008 6.3516 14.195 14.191 14.195zm49.105-49.062c0.12891 0.12891 0.38281 0.17188 0.38281 0.17188 0.12891 0 0.38672-0.17188 0.38672-0.17188l1.1484-1.1484c0.9375-0.9375 1.4492-2.1328 1.4492-3.4961 0-1.3633-0.51172-2.5586-1.4492-3.4961l-5.2852-5.2852c-1.9609-1.918-5.0703-1.918-6.9883 0l-1.1523 1.1523c-0.21484 0.21094 0 0.76562 0 0.76562zm-24.809 24.805c0.085938 0.12891 0.38672 0.17188 0.38672 0.17188 0.125 0 0.38281-0.17188 0.38281-0.17188l21.824-21.824c0.125-0.125 0.16797-0.25391 0.16797-0.38281s-0.16797-0.38281-0.16797-0.38281l-11.512-11.508c-0.21094-0.21484-0.76562 0-0.76562 0l-21.652 21.652c-0.21484 0.21094 0 0.76562 0 0.76562zm-18.414 6.9141c0.12891 0.12891 0.38672 0.17188 0.38672 0.17188h0.16797l14.492-4.8164c0.17188-0.042968 0.34375-0.21484 0.34375-0.38281 0.042969-0.17188-0.12891-0.51172-0.12891-0.51172l-9.5469-9.8906c-0.12891-0.17188-0.34375-0.17188-0.51172-0.17188-0.17187 0.042969-0.38672 0.34375-0.38672 0.34375l-4.9414 14.703c-0.042969 0.21484 0 0.42969 0.125 0.55469z"/></svg>';

// Strips trailing slash(es) from a URL before it's saved — a saved URL like
// Point 3: resolves a batch of typed names against existing members — reuses
// an existing member (matched by exact name AND gender) instead of creating a
// duplicate, and also catches duplicate name+gender pairs typed together in
// the same batch. A same name with a DIFFERENT gender is treated as a
// genuinely different person, so it still gets created as a new member.
// Returns only the genuinely NEW member records to persist, plus the full
// resolved id list (existing + new) in the same order as the input names.
export function resolveMembersByNames(names, gender, existingMembers) {
  const newMembers = [];
  const resolvedIds = [];
  const pool = [...existingMembers];
  names.forEach((name) => {
    const found = pool.find((m) => m.name === name && m.gender === gender);
    if (found) {
      resolvedIds.push(found.id);
    } else {
      const nm = { id: uid(), name, gender, note: '', isActive: true, createdAt: nowIso() };
      newMembers.push(nm);
      pool.push(nm);
      resolvedIds.push(nm.id);
    }
  });
  return { newMembers, resolvedIds };
}

// ---------- Back button ----------
export function backButtonHtml() {
  return `<button class="back-btn" id="page-back-btn" aria-label="返回上一頁" type="button">
    <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>`;
}

export function attachBackButton(root) {
  const btn = root.querySelector('#page-back-btn');
  if (btn) btn.addEventListener('click', () => window.history.back());
}

// ---------- Toast ----------
export function toast(msg) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 1800);
}

// ---------- Modal ----------
// Point 2: while any modal is open, the page behind it must not scroll —
// even when a swipe starts on the backdrop or the modal's own scroll
// reaches its top/bottom edge and would otherwise "chain" into scrolling
// the page underneath. We freeze the page in place (position:fixed at its
// current scroll offset) for as long as a modal is showing, and restore
// the exact scroll position on close.
let bodyScrollLocked = false;
let savedScrollY = 0;
function lockBodyScroll() {
  if (bodyScrollLocked) return;
  bodyScrollLocked = true;
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}
function unlockBodyScroll() {
  if (!bodyScrollLocked) return;
  bodyScrollLocked = false;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScrollY);
}

// Safety net: if a route change happens while a modal is still open (e.g.
// the user taps the tabbar or the browser back/forward button without
// explicitly closing it), make sure it's torn down and the page-scroll
// lock is released so the new page isn't left un-scrollable.
export function forceCloseModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  unlockBodyScroll();
}

// opts: { title, bodyHtml, onMount(panelEl), actions: [{label, primary, danger, onClick(closeFn)}] }
export function openModal(opts) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  lockBodyScroll();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.innerHTML = `
    <div class="modal-head">
      <h2 style="font-size:1.05rem;">${opts.title || ''}</h2>
      <button class="icon-btn" data-close aria-label="關閉">✕</button>
    </div>
    <div class="modal-body">${opts.bodyHtml || ''}</div>
    <div class="modal-actions" data-actions></div>
  `;
  backdrop.appendChild(panel);
  root.appendChild(backdrop);

  const close = () => { root.innerHTML = ''; unlockBodyScroll(); };

  panel.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const actionsRoot = panel.querySelector('[data-actions]');
  (opts.actions || []).forEach((a) => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : '');
    btn.textContent = a.label;
    btn.addEventListener('click', () => a.onClick(close, panel));
    actionsRoot.appendChild(btn);
  });

  if (opts.onMount) opts.onMount(panel, close);
  return { close, panel };
}

export function confirmDialog(message, onConfirm, opts = {}) {
  openModal({
    title: opts.title || '請確認',
    bodyHtml: `<p class="small text-soft">${message}</p>`,
    actions: [
      { label: '取消', onClick: (close) => close() },
      { label: opts.confirmLabel || '確定', danger: opts.danger !== false, onClick: (close) => { onConfirm(); close(); } },
    ],
  });
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

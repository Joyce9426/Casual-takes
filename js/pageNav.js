// ---------- 詳細頁的「上一個／下一個」切換（箭頭 + 左右滑動） ----------
// 場次詳細頁（上一場／下一場）與季度詳細頁（上一季／下一季）共用。
import { toast } from './utils.js';

const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 6 L8 12 L14 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 6 L16 12 L10 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SWIPE_MIN_DISTANCE = 60;   // px
const SWIPE_MAX_DURATION = 600;  // ms
const SWIPE_EDGE_GUARD = 24;     // 避開瀏覽器從螢幕邊緣滑動的「返回」手勢

// 用左右箭頭夾住標題區塊（titleHtml）。沒有上一個／下一個時箭頭會 disabled。
export function pageNavHtml(titleHtml, { hasPrev, hasNext, prevLabel, nextLabel }) {
  return `
    <div class="page-nav">
      <button class="page-nav-btn" id="page-nav-prev" type="button" aria-label="${prevLabel}" ${hasPrev ? '' : 'disabled'}>${CHEVRON_LEFT}</button>
      ${titleHtml}
      <button class="page-nav-btn" id="page-nav-next" type="button" aria-label="${nextLabel}" ${hasNext ? '' : 'disabled'}>${CHEVRON_RIGHT}</button>
    </div>
  `;
}

// 讀取網址上的 ?tab=，不在 validTabs 裡就用 fallback。切換上一個／下一個時
// 會把目前分頁帶在網址上，讓新頁面停在同一個分頁。
export function tabFromUrl(validTabs, fallback) {
  const tab = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab');
  return validTabs.includes(tab) ? tab : fallback;
}

// 把目前分頁寫回網址（replaceState 不會觸發 hashchange），背景同步重新渲染時
// 才會停在同一個分頁。
export function replaceTabInUrl(path, tab) {
  history.replaceState(null, '', `#${path}?tab=${tab}`);
}

// 綁定箭頭與滑動。每次 draw() 之後呼叫。
// options.path: 目前頁面的路徑（例如 /sessions/abc），用來確認滑動時還停在這頁
// options.prevPath / nextPath: 上一個／下一個的路徑，沒有就給 null
// options.tab: 目前分頁（切換時帶到新頁面）
// options.firstMsg / lastMsg: 已經到頭／到尾時滑動的提示
export function bindPageNav(root, options) {
  root._pageNav = options;
  root.querySelector('#page-nav-prev')?.addEventListener('click', () => goTo(options.prevPath, options.tab));
  root.querySelector('#page-nav-next')?.addEventListener('click', () => goTo(options.nextPath, options.tab));
  // root 是各頁共用的 #view-root，滑動監聽只綁一次，觸發時再讀最新的 root._pageNav。
  if (!root._pageNavSwipeBound) {
    root._pageNavSwipeBound = true;
    bindSwipe(root);
  }
}

// 用 location.replace 換頁，不新增瀏覽紀錄：不管切了幾個，按一次返回鍵都會
// 回到原本的列表。
function goTo(path, tab) {
  if (!path) return;
  window.location.replace(`#${path}${tab ? `?tab=${tab}` : ''}`);
}

// 從觸控起點往上找，只要經過輸入框或可以水平捲動的區塊（例如較寬的表格），
// 就不把這次滑動當成切換。
function isSwipeExcludedTarget(el, root) {
  for (let node = el; node && node !== root; node = node.parentElement) {
    if (node.matches('input, textarea, select, [contenteditable="true"]')) return true;
    if (node.scrollWidth > node.clientWidth + 1) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

function bindSwipe(root) {
  let start = null;
  root.addEventListener('touchstart', (e) => {
    start = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < SWIPE_EDGE_GUARD || t.clientX > window.innerWidth - SWIPE_EDGE_GUARD) return;
    if (isSwipeExcludedTarget(e.target, root)) return;
    start = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  root.addEventListener('touchend', (e) => {
    const nav = root._pageNav;
    if (!start || !nav) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const elapsed = Date.now() - start.time;
    start = null;
    // 確認目前還停在設定這組切換的頁面（換到其他頁後 root._pageNav 會留著舊值）。
    if (window.location.hash.split('?')[0] !== `#${nav.path}`) return;
    if (elapsed > SWIPE_MAX_DURATION) return;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const target = dx < 0 ? nav.nextPath : nav.prevPath;
    if (!target) {
      toast(dx < 0 ? nav.lastMsg : nav.firstMsg);
      return;
    }
    goTo(target, nav.tab);
  }, { passive: true });

  root.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}

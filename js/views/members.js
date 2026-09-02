import { getAll, put, putMany, remove } from '../db.js';
import { navigate } from '../router.js';
import { toast, openModal, confirmDialog, escapeHtml, parseNamesInput, backButtonHtml, attachBackButton, EDIT_ICON_SVG, resolveMembersByNames, fmtDateOnly } from '../utils.js';

const STAR_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.5l2.9 6.6 7.1.6-5.4 4.7 1.7 6.9L12 17.6l-6.3 3.7 1.7-6.9-5.4-4.7 7.1-.6z" fill="currentColor"/></svg>';
const STAR_OUTLINE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2.5l2.9 6.6 7.1.6-5.4 4.7 1.7 6.9L12 17.6l-6.3 3.7 1.7-6.9-5.4-4.7 7.1-.6z"/></svg>';

const SEARCH_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CHEVRON_RIGHT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X_ICON_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export async function renderMembers(root) {
  let members = (await getAll('members')).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  let query = '';
  let searchOpen = false;
  // Point 2/3: the search box needs to survive Chinese/pinyin IME composition
  // (typing "yan" via pinyin fires a burst of 'input' events for candidate
  // text before the syllable is committed) without the whole list re-rendering
  // mid-composition, and a redraw triggered by something OTHER than typing
  // (expanding a member's session history, clicking a session row, etc.)
  // must never steal focus back into the search box and pop the keyboard.
  let isComposing = false;
  let focusSearchAfterDraw = false;

  // Point: 人員名單需要能直接看到每位成員出現過的場次（含候補/季打），因此把
  // sessions / seasons / sessionRosters 一次讀進來，用 memberId 分組，
  // 展開某個人時直接查表即可，不用每次都重新掃描整個資料庫。
  const [allSessions, allSeasons, allRosters] = await Promise.all([
    getAll('sessions'),
    getAll('seasons'),
    getAll('sessionRosters'),
  ]);
  const sessionsById = Object.fromEntries(allSessions.map((s) => [s.id, s]));
  const seasonsById = Object.fromEntries(allSeasons.map((s) => [s.id, s]));
  const rostersByMemberId = allRosters.reduce((acc, r) => {
    (acc[r.memberId] ||= []).push(r);
    return acc;
  }, {});

  function sessionHistoryFor(memberId) {
    const rows = rostersByMemberId[memberId] || [];
    return rows
      // 季打（season pass）人員若該場標記「請假」，等同沒有出席，不該算作
      // 出現過的場次紀錄。
      .filter((r) => !(r.sourceType === 'seasonPass' && r.attendance === '請假'))
      .map((r) => ({ roster: r, session: sessionsById[r.sessionId] }))
      .filter((x) => x.session)
      .map((x) => ({
        sessionId: x.session.id,
        date: x.session.date,
        seasonName: seasonsById[x.session.seasonId]?.name || '',
        isWaitlist: x.roster.sourceType === 'waitlist',
        isSeasonPass: x.roster.sourceType === 'seasonPass',
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function matchQuery(m) {
    if (!query) return true;
    return m.name.includes(query) || (m.note || '').includes(query);
  }

  function draw() {
    // Point 2: 常用 (favorite) members sort first within each group.
    const byFavoriteThenName = (a, b) => (Boolean(b.isFavorite) - Boolean(a.isFavorite)) || a.name.localeCompare(b.name, 'zh-Hant');
    const filtered = members.filter(matchQuery);
    const male = filtered.filter((m) => m.gender === '男').sort(byFavoriteThenName);
    const female = filtered.filter((m) => m.gender === '女').sort(byFavoriteThenName);
    // Safety net: a member whose gender is missing/invalid (undefined, '', a
    // typo, etc.) used to match neither group above and simply vanish from
    // this page — invisible even to search, with no way to find or delete it
    // through the UI. Anyone who doesn't cleanly match 男/女 now shows up
    // here instead, so nothing can silently disappear.
    const other = filtered.filter((m) => m.gender !== '男' && m.gender !== '女');

    root.innerHTML = `
      <div class="page-head page-head-sticky flex-wrap-head">
        <div class="page-head-left">
          ${backButtonHtml()}
          <div style="min-width:0;">
            <h1 class="h1-nowrap">人員名單</h1>
            <div class="sub">共 ${members.length} 人（男 ${members.filter(m=>m.gender==='男').length}・女 ${members.filter(m=>m.gender==='女').length}）</div>
          </div>
        </div>
        <div class="flex gap-8">
          <button class="icon-action-btn" id="toggle-search-btn" aria-label="搜尋">${SEARCH_ICON_SVG}</button>
          <button class="btn btn-primary btn-sm" id="add-member-btn">＋ 新增</button>
        </div>
        ${searchOpen ? `
          <div style="width:100%;margin-top:8px;position:relative;">
            <input type="text" placeholder="搜尋姓名或備註…" id="search-input" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 34px 9px 10px;box-sizing:border-box;">
            ${query ? `<button type="button" id="search-clear-btn" aria-label="清除搜尋內容" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;padding:6px;cursor:pointer;color:var(--ink-soft);line-height:0;">${X_ICON_SVG}</button>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-title">男（${male.length}）</div>
        ${male.length ? male.map(memberRow).join('') : '<div class="small text-faint">尚無資料</div>'}
      </div>
      <div class="card">
        <div class="card-title">女（${female.length}）</div>
        ${female.length ? female.map(memberRow).join('') : '<div class="small text-faint">尚無資料</div>'}
      </div>
      ${other.length ? `
        <div class="card">
          <div class="card-title">其他（${other.length}）</div>
          ${other.map(memberRow).join('')}
        </div>
      ` : ''}
      ${filtered.length === 0 ? `<div class="empty-state"><div class="glyph">◍</div><p>找不到符合的人員</p></div>` : ''}
    `;

    attachBackButton(root);
    root.querySelector('#add-member-btn').addEventListener('click', () => openMemberModal());
    root.querySelector('#toggle-search-btn').addEventListener('click', () => {
      searchOpen = !searchOpen;
      if (!searchOpen) { query = ''; }
      else focusSearchAfterDraw = true;
      draw();
    });

    const searchInput = root.querySelector('#search-input');
    if (searchInput) {
      searchInput.value = query;
      if (focusSearchAfterDraw) {
        searchInput.focus();
        searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
      }
      searchInput.addEventListener('compositionstart', () => {
        isComposing = true;
      });
      searchInput.addEventListener('compositionend', (e) => {
        isComposing = false;
        query = e.target.value.trim();
        focusSearchAfterDraw = true;
        draw();
      });
      searchInput.addEventListener('input', (e) => {
        // While an IME (pinyin, zhuyin, etc.) composition is in progress,
        // 'input' fires for every intermediate candidate. Re-rendering the
        // list (which destroys/recreates this very <input>) mid-composition
        // is what breaks IME input, so we skip and wait for compositionend.
        if (isComposing || e.isComposing) return;
        query = e.target.value.trim();
        focusSearchAfterDraw = true;
        draw();
      });
    }
    focusSearchAfterDraw = false;

    const clearBtn = root.querySelector('#search-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        query = '';
        focusSearchAfterDraw = true;
        draw();
      });
    }

    // Opening a member's session-history modal (or clicking a session inside
    // it) should never re-focus the search box — that would pop the
    // on-screen keyboard back up. focusSearchAfterDraw stays false for
    // these, so the redraw above leaves the search input unfocused.
    root.querySelectorAll('[data-open-history]').forEach((el) => {
      el.addEventListener('click', () => {
        const m = members.find((x) => x.id === el.dataset.openHistory);
        if (m) openMemberHistoryModal(m);
      });
    });

    root.querySelectorAll('[data-toggle-favorite]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const m = members.find((x) => x.id === btn.dataset.toggleFavorite);
        const updated = { ...m, isFavorite: !m.isFavorite };
        await put('members', updated);
        members = members.map((x) => (x.id === m.id ? updated : x));
        draw();
      });
    });
    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = members.find((x) => x.id === btn.dataset.edit);
        openMemberModal(m);
      });
    });
    root.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = members.find((x) => x.id === btn.dataset.delete);
        confirmDialog(`確定要刪除「${escapeHtml(m.name)}」嗎？此動作無法復原。`, async () => {
          await remove('members', m.id);
          members = members.filter((x) => x.id !== m.id);
          draw();
          toast('已刪除人員');
        });
      });
    });
  }

  function memberRow(m) {
    return `
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title" data-open-history="${m.id}" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
            ${escapeHtml(m.name)}
            <span style="color:var(--ink-faint);display:inline-flex;">${CHEVRON_RIGHT_SVG}</span>
          </div>
          ${m.note ? `<div class="list-row-meta">${escapeHtml(m.note)}</div>` : ''}
        </div>
        <div class="list-row-actions">
          <button class="icon-btn ${m.isFavorite ? 'icon-btn-active' : ''}" data-toggle-favorite="${m.id}" aria-label="常用">${m.isFavorite ? STAR_ICON_SVG : STAR_OUTLINE_SVG}</button>
          <button class="icon-btn" data-edit="${m.id}" aria-label="編輯">${EDIT_ICON_SVG}</button>
          <button class="icon-btn" data-delete="${m.id}" aria-label="刪除">✕</button>
        </div>
      </div>
    `;
  }

  // Point 4: group a member's session history by season (newest season
  // first, newest session first within a season) and show it in a modal
  // instead of expanding inline in the list.
  function groupedHistoryFor(memberId) {
    const history = sessionHistoryFor(memberId);
    const order = [];
    const bySeason = new Map();
    history.forEach((h) => {
      const key = h.seasonName || '未分類';
      if (!bySeason.has(key)) { bySeason.set(key, []); order.push(key); }
      bySeason.get(key).push(h);
    });
    return order.map((seasonName) => ({ seasonName, sessions: bySeason.get(seasonName) }));
  }

  function openMemberHistoryModal(m) {
    const groups = groupedHistoryFor(m.id);
    // Point 3: each season starts collapsed; track which season keys are
    // expanded locally to this modal instance.
    const expandedSeasons = new Set();

    function seasonBodyHtml() {
      if (!groups.length) return `<div class="small text-faint">尚無場次紀錄</div>`;
      return groups.map((g) => {
        const isOpen = expandedSeasons.has(g.seasonName);
        const seasonIsPass = g.sessions.some((h) => h.isSeasonPass);
        return `
          <div style="margin-bottom:10px;">
            <button type="button" class="link-btn" data-toggle-season="${escapeHtml(g.seasonName)}" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;background:none;padding:6px 0;cursor:pointer;text-align:left;">
              <span style="font-size:.9rem;font-weight:700;color:var(--ink);display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${escapeHtml(g.seasonName)}（${g.sessions.length}）
                ${seasonIsPass ? `<span style="font-size:.72rem;font-weight:700;padding:1px 7px;border-radius:20px;background:var(--court-blue-tint);color:var(--court-blue);">季打</span>` : ''}
              </span>
              <span style="color:var(--ink-faint);display:inline-flex;flex-shrink:0;">${isOpen ? CHEVRON_DOWN_SVG : CHEVRON_RIGHT_SVG}</span>
            </button>
            ${isOpen ? `
              <div style="padding-left:14px;">
                ${g.sessions.map((h) => `
                  <div class="list-row" data-goto-session="${h.sessionId}" style="cursor:pointer;padding:8px 0;">
                    <div class="list-row-main">
                      <div class="list-row-title" style="font-size:.9rem;font-weight:400;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        ${fmtDateOnly(h.date)}
                        ${h.isWaitlist ? `<span style="font-size:.72rem;font-weight:700;padding:1px 7px;border-radius:20px;background:var(--gold-tint);color:var(--gold);">候補</span>` : ''}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    const { close, panel } = openModal({
      title: `${m.name} 的場次紀錄`,
      bodyHtml: seasonBodyHtml(),
    });

    function wireBody() {
      panel.querySelectorAll('[data-toggle-season]').forEach((el) => {
        el.addEventListener('click', () => {
          const key = el.dataset.toggleSeason;
          if (expandedSeasons.has(key)) expandedSeasons.delete(key);
          else expandedSeasons.add(key);
          panel.querySelector('.modal-body').innerHTML = seasonBodyHtml();
          wireBody();
        });
      });
      panel.querySelectorAll('[data-goto-session]').forEach((el) => {
        el.addEventListener('click', () => {
          document.activeElement?.blur();
          close();
          navigate(`/sessions/${el.dataset.gotoSession}`);
        });
      });
    }

    wireBody();
  }

  function openMemberModal(existing) {
    const isEdit = !!existing;
    openModal({
      title: isEdit ? '編輯人員' : '新增人員',
      bodyHtml: `
        <div class="field">
          <label>${isEdit ? '姓名' : '手動輸入'}</label>
          <input type="text" id="m-name" value="${isEdit ? escapeHtml(existing.name) : ''}">
        </div>
        <div class="field">
          <label>性別</label>
          <div class="radio-group" id="m-gender-group">
            <label class="radio-chip ${(!isEdit || existing.gender === '男') ? 'checked' : ''}">
              <input type="radio" name="m-gender" value="男" ${(!isEdit || existing.gender === '男') ? 'checked' : ''}> 男
            </label>
            <label class="radio-chip ${isEdit && existing.gender === '女' ? 'checked' : ''}">
              <input type="radio" name="m-gender" value="女" ${isEdit && existing.gender === '女' ? 'checked' : ''}> 女
            </label>
          </div>
        </div>
        <div class="field">
          <label>備註（選填）</label>
          <input type="text" id="m-note" value="${isEdit ? escapeHtml(existing.note || '') : ''}" placeholder="聯絡方式等">
        </div>
      `,
      onMount: (panel) => {
        panel.querySelectorAll('#m-gender-group .radio-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            panel.querySelectorAll('#m-gender-group .radio-chip').forEach((c) => c.classList.remove('checked'));
            chip.classList.add('checked');
          });
        });
        panel.querySelector('#m-name').focus();
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: isEdit ? '儲存' : '新增',
          primary: true,
          onClick: async (close, panel) => {
            const rawName = panel.querySelector('#m-name').value.trim();
            if (!rawName) { toast('請輸入姓名'); return; }
            const gender = panel.querySelector('input[name=m-gender]:checked').value;
            const note = panel.querySelector('#m-note').value.trim();

            if (isEdit) {
              const obj = { ...existing, name: rawName, gender, note };
              await put('members', obj);
              members = members.map((x) => (x.id === obj.id ? obj : x));
              members.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
              close();
              draw();
              toast('已更新人員');
              return;
            }

            const names = parseNamesInput(rawName);
            if (names.length === 0) { toast('請輸入姓名'); return; }
            const { newMembers: created, resolvedIds } = resolveMembersByNames(names, gender, members);
            const newMembers = created.map((nm) => ({ ...nm, note }));
            if (newMembers.length) await putMany('members', newMembers);
            members.push(...newMembers);
            members.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
            close();
            draw();
            const reusedCount = resolvedIds.length - newMembers.length;
            toast(reusedCount > 0
              ? `已新增 ${newMembers.length} 位、沿用 ${reusedCount} 位既有人員`
              : (names.length > 1 ? `已新增 ${names.length} 位人員` : '已新增人員'));
          },
        },
      ],
    });
  }

  draw();
}

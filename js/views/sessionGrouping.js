import { getById, put } from '../db.js';
import { uid, toast, escapeHtml } from '../utils.js';
import {
  suggestGroupCount, shuffleFill, planMatches, buildGroupRoundSchedule, shuffleGroupsOrder,
  naturalRoundsCount, computeAppearanceCounts, computeGroupScores, groupLabel,
} from '../grouping.js';

// 場次頁「分組對戰」分頁：分組（誰在哪一組）完全由管理員手動指定——點一個
// 組別讓它變成「作用中」，再點名單裡的人就會被移進去，操作全部靠點擊，不需
// 要拖拉。小組合併成 6 人隊、排出多輪對戰表（含輪休輪流），則是系統自動
// 處理的部分。
export async function renderGroupingTab(tabBody, { sessionId, membersById, attendingMemberIds }) {
  let grouping = await getById('sessionGroupings', sessionId);
  if (!grouping) {
    grouping = {
      id: sessionId,
      sessionId,
      groupSize: 6,
      groups: defaultGroups(6),
      rounds: [],
      createdAt: new Date().toISOString(),
    };
  }
  let activeGroupId = null;
  let desiredRounds = null; // null＝還沒手動調整過，畫面顯示系統建議的預設輪數
  // 需求 2：不再每個動作都寫 IndexedDB（會連帶每次都觸發一次背景推送 API）
  // ——所有操作只改這裡的記憶體狀態，標記「有未儲存的變更」，等按下最上面
  // 的「儲存」按鈕才一次寫入、一次觸發推送。
  let dirty = false;

  function markDirty() {
    dirty = true;
    const btn = tabBody.querySelector('#save-grouping-btn');
    if (btn) { btn.disabled = false; btn.classList.add('btn-primary'); }
  }

  function defaultGroups(size) {
    const count = suggestGroupCount(attendingMemberIds.length, size);
    return Array.from({ length: count }, () => ({ id: uid(), memberIds: [] }));
  }

  function assignedMemberIds() {
    return new Set(grouping.groups.flatMap((g) => g.memberIds));
  }

  function unassignedMemberIds() {
    const assigned = assignedMemberIds();
    return attendingMemberIds.filter((id) => !assigned.has(id));
  }

  function clearSchedule() {
    grouping.rounds = [];
  }

  async function persist() {
    await put('sessionGroupings', grouping);
  }

  function ensureActiveGroup() {
    if (activeGroupId && grouping.groups.some((g) => g.id === activeGroupId)) return;
    activeGroupId = grouping.groups[0]?.id || null;
  }

  // 需求 1：不再用文字標示性別，改用 chip 底色區分（男＝藍、女＝金，跟
  // 人員名單頁的男女配色一致）。
  function genderChipClass(gender) {
    return gender === '女' ? 'member-chip-female' : 'member-chip-male';
  }

  // 未分組名單池用——單純點擊整個 chip 就會加入目前作用中的組別。
  function poolChipHtml(memberId) {
    const m = membersById[memberId];
    if (!m) return '';
    return `<button type="button" class="member-chip ${genderChipClass(m.gender)}" data-member-chip="${memberId}">${escapeHtml(m.name)}</button>`;
  }

  // 組別內的人員——多一個「✕」可以直接取消分組（不管目前哪一組是作用
  // 中），跟點 chip 本身「移到作用中組別」是兩個獨立動作。
  function groupedChipHtml(memberId) {
    const m = membersById[memberId];
    if (!m) return '';
    return `
      <span class="member-chip member-chip-grouped ${genderChipClass(m.gender)}" data-member-chip="${memberId}">
        ${escapeHtml(m.name)}
        <button type="button" class="chip-remove" data-remove-member="${memberId}" aria-label="取消分組">✕</button>
      </span>
    `;
  }

  // 分組區塊橫向捲動，一頁直向顯示 3 組，捲動時可以看到下一頁的邊緣。
  // 回傳的每組物件保留原始 idx（在 grouping.groups 裡的位置），這樣組別
  // 字母編號（A/B/C...）才會照整體順序排，不會因為分頁而重算。
  function groupPages(groups, pageSize = 3) {
    const pages = [];
    for (let i = 0; i < groups.length; i += pageSize) {
      pages.push(groups.slice(i, i + pageSize).map((group, j) => ({ group, idx: i + j })));
    }
    return pages;
  }

  function groupCardHtml(group, idx) {
    const isActive = group.id === activeGroupId;
    return `
      <div class="card group-card ${isActive ? 'group-card-active' : ''}" data-group-card="${group.id}">
        <div class="card-title">
          <span>${groupLabel(idx)} 組（${group.memberIds.length}/${grouping.groupSize}）</span>
          <div class="flex gap-8">
            <button class="icon-btn icon-btn-text" data-clear-group="${group.id}" aria-label="清空這一組的人員">清空</button>
            <button class="icon-btn" data-remove-group="${group.id}" aria-label="移除此組">✕</button>
          </div>
        </div>
        <div class="chip-pool">
          ${group.memberIds.length ? group.memberIds.map(groupedChipHtml).join('') : '<div class="small text-faint">點選上方名單，加入這一組</div>'}
        </div>
      </div>
    `;
  }

  // 對戰表裡每一隊（或輪休的小組）依組成的原始小組分段顯示，一個小組一
  // 行，例如「A：小王、小明」換行「B：大王、大名」，每個小組各自用不同
  // 底色的匡區隔開。色塊本身用最大寬度（撐滿這一欄）而不是固定寬度——內
  // 容不多的時候底色跟著內容縮小，人數多顯示不下才換行。男女人數另外用
  // teamGenderLineHtml() 產生，不算在這裡面（見下方說明）。
  // team: { groupIds, memberIds }
  function teamCompositionHtml(team) {
    if (!team) return '';
    return team.groupIds.map((gid) => {
      const idx = grouping.groups.findIndex((g) => g.id === gid);
      const group = grouping.groups[idx];
      const label = idx === -1 ? '?' : groupLabel(idx);
      const names = (group ? group.memberIds : []).map((id) => escapeHtml(membersById[id]?.name || '')).join('、');
      const colorClass = `team-seg-${idx === -1 ? 0 : idx % 9}`;
      return `<span class="team-group-seg ${colorClass}"><span class="team-seg-label">${label}</span><span class="team-seg-names">${names}</span></span>`;
    }).join('');
  }

  // 男女人數獨立成自己的一行，不算進小組色塊的區塊裡——這樣比分輸入框
  // 垂直置中的對齊基準只看小組色塊本身的高度，不會被這行拉走。
  function teamGenderLineHtml(team) {
    if (!team) return '';
    const male = team.memberIds.filter((id) => membersById[id]?.gender === '男').length;
    const female = team.memberIds.filter((id) => membersById[id]?.gender === '女').length;
    return `<span class="team-gender-summary">（男${male}・女${female}）</span>`;
  }

  function restGroupTeam(gid) {
    const idx = grouping.groups.findIndex((g) => g.id === gid);
    const group = grouping.groups[idx];
    return { groupIds: [gid], memberIds: group ? group.memberIds : [] };
  }

  // 需求 5：每場比賽右側的比分輸入框，值取自 grouping.rounds 目前存的
  // scoreA/scoreB（可能是 null＝還沒填）。
  function scoreInputHtml(roundIdx, matchIdx, side, value) {
    return `<input type="text" inputmode="numeric" pattern="[0-9]*" class="score-input" data-round="${roundIdx}" data-match="${matchIdx}" data-side="${side}" value="${value ?? ''}" placeholder="-" aria-label="比分">`;
  }

  // 需求 5：把目前填好的比分加總成每個小組的總分，由高到低排序；只列出
  // 真正有排進對戰表的滿組小組。
  function leaderboardHtml() {
    const totals = computeGroupScores(grouping.rounds);
    const plan = planMatches(grouping.groups, grouping.groupSize);
    const entries = plan.completeGroups
      .map((g) => ({ idx: grouping.groups.findIndex((x) => x.id === g.id), total: totals[g.id] || 0 }))
      .sort((a, b) => b.total - a.total);
    if (!entries.length) return '';
    return `
      <div class="card-title">組別總得分</div>
      <div class="stack">
        ${entries.map(({ idx, total }) => `<div class="flex-between"><span class="team-group-seg team-seg-${idx % 9}">${groupLabel(idx)} 組</span><strong class="mono">${total}</strong></div>`).join('')}
      </div>
    `;
  }

  function roundsHtml() {
    if (!grouping.rounds.length) return '';
    const appearanceCounts = computeAppearanceCounts(grouping.rounds);
    const plan = planMatches(grouping.groups, grouping.groupSize);
    const leftoverNames = plan.incompleteGroupIds
      .flatMap((gid) => (grouping.groups.find((g) => g.id === gid)?.memberIds) || [])
      .map((id) => membersById[id]?.name)
      .filter(Boolean);
    const scheduledMemberIds = plan.completeGroups.flatMap((g) => g.memberIds);

    return `
      <div class="card">
        <div class="card-title">
          對戰表
          <button class="btn btn-sm" id="reroll-schedule-btn">重新排列</button>
        </div>
        ${grouping.rounds.map((round, i) => `
          <div class="round-block">
            <div class="round-block-title">第 ${i + 1} 輪</div>
            ${round.matches.map((m, mi) => `
              <div class="match-row">
                <div class="team-block">${teamCompositionHtml(m.teamA)}${teamGenderLineHtml(m.teamA)}</div>
                ${scoreInputHtml(i, mi, 'A', m.scoreA)}
                <div class="match-vs">vs</div>
                <div class="score-vs-divider">:</div>
                <div class="team-block">${teamCompositionHtml(m.teamB)}${teamGenderLineHtml(m.teamB)}</div>
                ${scoreInputHtml(i, mi, 'B', m.scoreB)}
              </div>
            `).join('')}
            ${round.restGroupIds.length ? `<div class="rest-row"><span class="rest-row-label">輪休：</span>${round.restGroupIds.map((gid) => teamCompositionHtml(restGroupTeam(gid))).join('')}</div>` : ''}
          </div>
        `).join('')}
        ${leftoverNames.length ? `<div class="small text-faint" style="margin-top:8px;">未能湊滿 ${grouping.groupSize} 人、未排入對戰表：${leftoverNames.map(escapeHtml).join('、')}</div>` : ''}
      </div>
      <div class="card">
        <div class="card-title">每人出場次數</div>
        <div class="chip-pool">
          ${scheduledMemberIds.map((id) => `<span class="badge badge-gray">${escapeHtml(membersById[id]?.name || '')} × ${appearanceCounts[id] || 0}</span>`).join('')}
        </div>
      </div>
      <div class="card" id="score-leaderboard-wrap">${leaderboardHtml()}</div>
    `;
  }

  function draw() {
    ensureActiveGroup();
    // 需求 1：每次互動（點人、點組別卡片…）都會整個重畫，DOM 節點是全新
    // 的，捲動位置預設會歸零——先記住重畫前的捲動位置，重畫完再還原，
    // 使用者停在哪裡就繼續停在哪裡，不會跳回最左邊。
    const prevGroupScrollLeft = tabBody.querySelector('.group-scroll')?.scrollLeft || 0;
    const unassigned = unassignedMemberIds();
    const unassignedMale = unassigned.filter((id) => membersById[id]?.gender === '男');
    const unassignedFemale = unassigned.filter((id) => membersById[id]?.gender === '女');
    const plan = planMatches(grouping.groups, grouping.groupSize);
    const canGenerate = plan.matchesPerRound >= 1;
    const defaultRounds = naturalRoundsCount(plan.completeGroups.length);
    const pages = groupPages(grouping.groups);

    tabBody.innerHTML = `
      <div class="flex-between" style="margin-bottom:12px;align-items:center;">
        <div class="small text-soft">
          出席 ${attendingMemberIds.length} 人・已分組 ${attendingMemberIds.length - unassigned.length} 人・未分組 ${unassigned.length} 人
        </div>
        <button class="btn btn-sm ${dirty ? 'btn-primary' : ''}" id="save-grouping-btn" ${dirty ? '' : 'disabled'}>儲存</button>
      </div>

      <div class="field">
        <label>分組大小</label>
        <div class="radio-group" id="group-size-group">
          ${[2, 3, 6].map((sz) => `<label class="radio-chip ${grouping.groupSize === sz ? 'checked' : ''}"><input type="radio" name="group-size" value="${sz}" ${grouping.groupSize === sz ? 'checked' : ''}>${sz} 人一組</label>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">未分組（${unassigned.length}）</div>
        ${unassigned.length ? `
          <div class="roster-group-head-male" style="font-size:.72rem;font-weight:700;">男（${unassignedMale.length}）</div>
          <div class="chip-pool" style="margin-bottom:10px;">
            ${unassignedMale.length ? unassignedMale.map(poolChipHtml).join('') : '<div class="small text-faint">尚無</div>'}
          </div>
          <div class="roster-group-head-female" style="font-size:.72rem;font-weight:700;">女（${unassignedFemale.length}）</div>
          <div class="chip-pool">
            ${unassignedFemale.length ? unassignedFemale.map(poolChipHtml).join('') : '<div class="small text-faint">尚無</div>'}
          </div>
        ` : '<div class="small text-faint">目前沒有未分組的人</div>'}
      </div>

      <div class="flex gap-8" style="margin-bottom:12px;flex-wrap:wrap;">
        <button class="btn btn-sm" id="shuffle-fill-btn">隨機快速分配</button>
        <button class="btn btn-sm" id="add-group-btn">＋ 新增一組</button>
        <button class="btn btn-sm" id="clear-all-groups-btn">一鍵清除</button>
      </div>

      <div class="group-scroll ${pages.length <= 1 ? 'group-scroll-center' : ''}">
        ${pages.map((page) => `
          <div class="group-page">
            ${page.map(({ group, idx }) => groupCardHtml(group, idx)).join('')}
          </div>
        `).join('')}
      </div>

      <div class="small text-soft" style="margin:12px 0 8px;">
        每輪可同時進行 ${plan.matchesPerRound} 場比賽${plan.restGroupsCount ? `，${plan.restGroupsCount} 組輪休` : ''}${plan.incompleteGroupIds.length ? '，另有部分小組人數不足' : ''}
      </div>
      <div class="field-row rounds-generate-row">
        <div class="field" style="flex:1;">
          <label>輪數</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="rounds-count-input" value="${desiredRounds ?? defaultRounds}" ${canGenerate ? '' : 'disabled'}>
        </div>
        <div class="field" style="flex:1;">
          <label>&nbsp;</label>
          <button class="btn btn-primary btn-block" id="generate-schedule-btn" ${canGenerate ? '' : 'disabled'}>產生對戰表</button>
        </div>
      </div>

      <div style="margin-top:14px;">
        ${roundsHtml()}
      </div>
    `;

    const newGroupScroll = tabBody.querySelector('.group-scroll');
    if (newGroupScroll) newGroupScroll.scrollLeft = prevGroupScrollLeft;

    bindEvents();
  }

  function bindEvents() {
    const saveBtn = tabBody.querySelector('#save-grouping-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        await persist();
        dirty = false;
        draw();
        toast('已儲存分組與對戰表');
      });
    }

    tabBody.querySelectorAll('#group-size-group .radio-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const size = Number(chip.querySelector('input').value);
        grouping.groupSize = size;
        if (grouping.groups.every((g) => g.memberIds.length === 0)) {
          grouping.groups = defaultGroups(size);
        }
        clearSchedule();
        markDirty();
        draw();
      });
    });

    // 需求 2：整個組別卡片框內點擊都可以切換作用中組別（不再只限標題文字）。
    tabBody.querySelectorAll('[data-group-card]').forEach((card) => {
      card.addEventListener('click', () => {
        activeGroupId = card.dataset.groupCard;
        draw();
      });
    });

    // 需求：每張組別卡片自己的「清空」——只清掉這一組的人（回到未分組名
    // 單），組別本身留著，跟下面「移除此組」（整組一起刪掉）是不同的動作。
    tabBody.querySelectorAll('[data-clear-group]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const gid = el.dataset.clearGroup;
        const group = grouping.groups.find((g) => g.id === gid);
        if (!group || !group.memberIds.length) return;
        group.memberIds = [];
        clearSchedule();
        markDirty();
        draw();
      });
    });

    tabBody.querySelectorAll('[data-remove-group]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // 不要連帶觸發卡片本身的「切換作用中」
        const gid = el.dataset.removeGroup;
        grouping.groups = grouping.groups.filter((g) => g.id !== gid);
        if (activeGroupId === gid) activeGroupId = null;
        clearSchedule();
        markDirty();
        draw();
      });
    });

    // 需求 1：組別內的人員多一個「✕」可以直接取消分組，不管目前哪一組是
    // 作用中；跟下面「點 chip 本身」的移動邏輯是分開的兩個動作。
    tabBody.querySelectorAll('[data-remove-member]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const memberId = el.dataset.removeMember;
        grouping.groups.forEach((g) => { g.memberIds = g.memberIds.filter((id) => id !== memberId); });
        clearSchedule();
        markDirty();
        draw();
      });
    });

    tabBody.querySelectorAll('[data-member-chip]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // 不要連帶把作用中組別切成這個人原本所在的組別
        const memberId = el.dataset.memberChip;
        const activeGroup = grouping.groups.find((g) => g.id === activeGroupId);
        if (!activeGroup) { toast('請先新增一組，並點選要放入的組別'); return; }
        if (activeGroup.memberIds.includes(memberId)) return; // 已經在這一組了，不用重複處理
        if (activeGroup.memberIds.length >= grouping.groupSize) {
          toast('這一組已滿，請切換到其他組別');
          return;
        }
        grouping.groups.forEach((g) => { g.memberIds = g.memberIds.filter((id) => id !== memberId); });
        activeGroup.memberIds.push(memberId);
        clearSchedule();
        markDirty();
        draw();
      });
    });

    tabBody.querySelector('#add-group-btn').addEventListener('click', () => {
      const g = { id: uid(), memberIds: [] };
      grouping.groups.push(g);
      activeGroupId = g.id;
      clearSchedule();
      markDirty();
      draw();
    });

    tabBody.querySelector('#shuffle-fill-btn').addEventListener('click', () => {
      const unassigned = unassignedMemberIds();
      if (!unassigned.length) { toast('目前沒有未分組的人'); return; }
      grouping.groups = shuffleFill(unassigned, grouping.groups, grouping.groupSize);
      clearSchedule();
      markDirty();
      draw();
    });

    // 需求：一鍵把「所有」組別的人都清空、回到未分組名單（組別本身都還
    // 在），影響範圍比單一組別的清空大很多，多一個確認對話框避免手滑。
    tabBody.querySelector('#clear-all-groups-btn').addEventListener('click', () => {
      const hasAny = grouping.groups.some((g) => g.memberIds.length > 0);
      if (!hasAny) { toast('目前沒有已分組的人'); return; }
      grouping.groups.forEach((g) => { g.memberIds = []; });
      clearSchedule();
      markDirty();
      draw();
      toast('已清空所有組別');
    });

    const roundsInput = tabBody.querySelector('#rounds-count-input');
    if (roundsInput) {
      roundsInput.addEventListener('input', () => {
        const v = Number(roundsInput.value);
        desiredRounds = v > 0 ? v : desiredRounds;
      });
    }

    tabBody.querySelector('#generate-schedule-btn').addEventListener('click', () => {
      const plan = planMatches(grouping.groups, grouping.groupSize);
      if (plan.matchesPerRound < 1) { toast('滿組的小組不足，至少要能湊出一場比賽才能排對戰表'); return; }
      const roundsCount = Math.max(1, Number(roundsInput?.value) || naturalRoundsCount(plan.completeGroups.length));
      const { rounds } = buildGroupRoundSchedule(shuffleGroupsOrder(grouping.groups), grouping.groupSize, roundsCount);
      grouping.rounds = rounds;
      markDirty();
      draw();
      toast('已產生對戰表（記得按上方「儲存」）');
    });

    // 需求 5：填比分只更新資料 + 重畫「組別總得分」那一小塊，不整頁重畫，
    // 不然打字打到一半游標跟輸入焦點會被打斷。
    tabBody.querySelectorAll('.score-input').forEach((el) => {
      el.addEventListener('input', () => {
        const ri = Number(el.dataset.round);
        const mi = Number(el.dataset.match);
        const side = el.dataset.side;
        const raw = el.value.trim();
        const value = raw === '' ? null : (Number(raw) || 0);
        grouping.rounds[ri].matches[mi][side === 'A' ? 'scoreA' : 'scoreB'] = value;
        markDirty();
        const wrap = tabBody.querySelector('#score-leaderboard-wrap');
        if (wrap) wrap.innerHTML = leaderboardHtml();
      });
    });

    const rerollBtn = tabBody.querySelector('#reroll-schedule-btn');
    if (rerollBtn) {
      rerollBtn.addEventListener('click', () => {
        const { rounds } = buildGroupRoundSchedule(shuffleGroupsOrder(grouping.groups), grouping.groupSize, grouping.rounds.length);
        grouping.rounds = rounds;
        markDirty();
        draw();
        toast('已重新排列對戰表（記得按上方「儲存」）');
      });
    }
  }

  draw();
}

import { getById, put } from '../db.js';
import { uid, toast, escapeHtml } from '../utils.js';
import {
  suggestGroupCount, shuffleFill, buildTeams, buildRoundRobinSchedule, naturalRoundsCount, computeAppearanceCounts, groupLabel,
} from '../grouping.js';

// 場次頁「分組對戰」分頁：分組（誰在哪一組）完全由管理員手動指定——點一個
// 組別讓它變成「作用中」，再點名單裡的人就會被移進去，操作全部靠點擊，不需
// 要拖拉。小組合併成 6 人隊、排出多輪對戰表，則是系統自動處理的部分。
export async function renderGroupingTab(tabBody, { sessionId, membersById, attendingMemberIds }) {
  let grouping = await getById('sessionGroupings', sessionId);
  if (!grouping) {
    grouping = {
      id: sessionId,
      sessionId,
      groupSize: 6,
      groups: defaultGroups(6),
      teams: [],
      incompleteTeamGroupIds: [],
      rounds: [],
      createdAt: new Date().toISOString(),
    };
  }
  let activeGroupId = null;
  let desiredRounds = null; // null＝還沒手動調整過，畫面顯示系統建議的預設輪數

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
    grouping.teams = [];
    grouping.incompleteTeamGroupIds = [];
    grouping.rounds = [];
  }

  async function persist() {
    await put('sessionGroupings', grouping);
  }

  function ensureActiveGroup() {
    if (activeGroupId && grouping.groups.some((g) => g.id === activeGroupId)) return;
    activeGroupId = grouping.groups[0]?.id || null;
  }

  // 未分組名單池用——單純點擊整個 chip 就會加入目前作用中的組別。
  function poolChipHtml(memberId) {
    const m = membersById[memberId];
    if (!m) return '';
    return `<button type="button" class="member-chip" data-member-chip="${memberId}">${escapeHtml(m.name)}<span class="gender-tag">${m.gender}</span></button>`;
  }

  // 組別內的人員——多一個「✕」可以直接取消分組（不管目前哪一組是作用
  // 中），跟點 chip 本身「移到作用中組別」是兩個獨立動作。
  function groupedChipHtml(memberId) {
    const m = membersById[memberId];
    if (!m) return '';
    return `
      <span class="member-chip member-chip-grouped" data-member-chip="${memberId}">
        ${escapeHtml(m.name)}<span class="gender-tag">${m.gender}</span>
        <button type="button" class="chip-remove" data-remove-member="${memberId}" aria-label="取消分組">✕</button>
      </span>
    `;
  }

  function groupCardHtml(group, idx) {
    const isActive = group.id === activeGroupId;
    return `
      <div class="card group-card ${isActive ? 'group-card-active' : ''}" data-group-card="${group.id}">
        <div class="card-title">
          <span>${groupLabel(idx)} 組（${group.memberIds.length}/${grouping.groupSize}）</span>
          <button class="icon-btn" data-remove-group="${group.id}" aria-label="移除此組">✕</button>
        </div>
        <div class="chip-pool">
          ${group.memberIds.length ? group.memberIds.map(groupedChipHtml).join('') : '<div class="small text-faint">點選上方名單，加入這一組</div>'}
        </div>
      </div>
    `;
  }

  // 對戰表裡每一隊依組成的原始小組分段顯示，例如「A：小王、小明 B：大王、
  // 大名」，後面再加註這一隊的男女人數（需求 4）。
  function teamCompositionHtml(team) {
    if (!team) return '';
    const segs = team.groupIds.map((gid) => {
      const idx = grouping.groups.findIndex((g) => g.id === gid);
      const group = grouping.groups[idx];
      const label = idx === -1 ? '?' : groupLabel(idx);
      const names = (group ? group.memberIds : []).map((id) => escapeHtml(membersById[id]?.name || '')).join('、');
      return `<span class="team-group-seg">${label}：${names}</span>`;
    }).join('');
    const male = team.memberIds.filter((id) => membersById[id]?.gender === '男').length;
    const female = team.memberIds.filter((id) => membersById[id]?.gender === '女').length;
    return `${segs}<span class="team-gender-summary">（男${male}・女${female}）</span>`;
  }

  function roundsHtml() {
    if (!grouping.rounds.length) return '';
    const teamsById = Object.fromEntries(grouping.teams.map((t) => [t.id, t]));
    const appearanceCounts = computeAppearanceCounts(grouping.teams, grouping.rounds);
    const leftoverNames = (grouping.incompleteTeamGroupIds || [])
      .flatMap((gid) => (grouping.groups.find((g) => g.id === gid)?.memberIds) || [])
      .map((id) => membersById[id]?.name)
      .filter(Boolean);

    return `
      <div class="card">
        <div class="card-title">
          對戰表
          <button class="btn btn-sm" id="reroll-schedule-btn">重新排列</button>
        </div>
        ${grouping.rounds.map((round, i) => `
          <div class="round-block">
            <div class="round-block-title">第 ${i + 1} 輪</div>
            ${round.matches.map((m) => `
              <div class="match-row">
                <span class="team-names">${teamCompositionHtml(teamsById[m.teamAId])}</span>
                <span class="vs">vs</span>
                <span class="team-names">${teamCompositionHtml(teamsById[m.teamBId])}</span>
              </div>
            `).join('')}
            ${round.byeTeamIds.length ? `<div class="small text-faint">輪空：${round.byeTeamIds.map((id) => teamCompositionHtml(teamsById[id])).join('、')}</div>` : ''}
          </div>
        `).join('')}
        ${leftoverNames.length ? `<div class="small text-faint" style="margin-top:8px;">未能湊滿 6 人、未排入對戰表：${leftoverNames.map(escapeHtml).join('、')}</div>` : ''}
      </div>
      <div class="card">
        <div class="card-title">每人出場次數</div>
        <div class="chip-pool">
          ${grouping.teams.flatMap((t) => t.memberIds).map((id) => `<span class="badge badge-gray">${escapeHtml(membersById[id]?.name || '')} × ${appearanceCounts[id]}</span>`).join('')}
        </div>
      </div>
    `;
  }

  function draw() {
    ensureActiveGroup();
    const unassigned = unassignedMemberIds();
    const unassignedMale = unassigned.filter((id) => membersById[id]?.gender === '男');
    const unassignedFemale = unassigned.filter((id) => membersById[id]?.gender === '女');
    const preview = buildTeams(grouping.groups, grouping.groupSize);
    const canGenerate = preview.teams.length >= 2;
    const defaultRounds = naturalRoundsCount(preview.teams.length) || 1;

    tabBody.innerHTML = `
      <div class="small text-soft" style="margin-bottom:12px;">
        出席 ${attendingMemberIds.length} 人・已分組 ${attendingMemberIds.length - unassigned.length} 人・未分組 ${unassigned.length} 人
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

      <div class="flex gap-8" style="margin-bottom:12px;">
        <button class="btn btn-sm" id="shuffle-fill-btn">隨機快速分配</button>
        <button class="btn btn-sm" id="add-group-btn">＋ 新增一組</button>
      </div>

      <div class="group-scroll">
        ${grouping.groups.map((g, idx) => groupCardHtml(g, idx)).join('')}
      </div>

      <div class="small text-soft" style="margin:12px 0 8px;">
        目前分組可組成 ${preview.teams.length} 隊（6 人一隊）${preview.incompleteTeamGroupIds.length ? '，另有部分小組人數不足 6 人' : ''}
      </div>
      <div class="field-row" style="align-items:flex-end;">
        <div class="field" style="flex:1;">
          <label>輪數</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="rounds-count-input" value="${desiredRounds ?? defaultRounds}" ${canGenerate ? '' : 'disabled'}>
        </div>
        <button class="btn btn-primary" id="generate-schedule-btn" style="flex:1;" ${canGenerate ? '' : 'disabled'}>產生對戰表</button>
      </div>

      <div style="margin-top:14px;">
        ${roundsHtml()}
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    tabBody.querySelectorAll('#group-size-group .radio-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const size = Number(chip.querySelector('input').value);
        grouping.groupSize = size;
        if (grouping.groups.every((g) => g.memberIds.length === 0)) {
          grouping.groups = defaultGroups(size);
        }
        clearSchedule();
        await persist();
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

    tabBody.querySelectorAll('[data-remove-group]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation(); // 不要連帶觸發卡片本身的「切換作用中」
        const gid = el.dataset.removeGroup;
        grouping.groups = grouping.groups.filter((g) => g.id !== gid);
        if (activeGroupId === gid) activeGroupId = null;
        clearSchedule();
        await persist();
        draw();
      });
    });

    // 需求 1：組別內的人員多一個「✕」可以直接取消分組，不管目前哪一組是
    // 作用中；跟下面「點 chip 本身」的移動邏輯是分開的兩個動作。
    tabBody.querySelectorAll('[data-remove-member]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const memberId = el.dataset.removeMember;
        grouping.groups.forEach((g) => { g.memberIds = g.memberIds.filter((id) => id !== memberId); });
        clearSchedule();
        await persist();
        draw();
      });
    });

    tabBody.querySelectorAll('[data-member-chip]').forEach((el) => {
      el.addEventListener('click', async (e) => {
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
        await persist();
        draw();
      });
    });

    tabBody.querySelector('#add-group-btn').addEventListener('click', async () => {
      const g = { id: uid(), memberIds: [] };
      grouping.groups.push(g);
      activeGroupId = g.id;
      clearSchedule();
      await persist();
      draw();
    });

    tabBody.querySelector('#shuffle-fill-btn').addEventListener('click', async () => {
      const unassigned = unassignedMemberIds();
      if (!unassigned.length) { toast('目前沒有未分組的人'); return; }
      grouping.groups = shuffleFill(unassigned, grouping.groups, grouping.groupSize);
      clearSchedule();
      await persist();
      draw();
    });

    const roundsInput = tabBody.querySelector('#rounds-count-input');
    if (roundsInput) {
      roundsInput.addEventListener('input', () => {
        const v = Number(roundsInput.value);
        desiredRounds = v > 0 ? v : desiredRounds;
      });
    }

    tabBody.querySelector('#generate-schedule-btn').addEventListener('click', async () => {
      const { teams, incompleteTeamGroupIds } = buildTeams(grouping.groups, grouping.groupSize);
      if (teams.length < 2) { toast('隊伍不足，至少需要 2 隊才能排對戰表'); return; }
      const roundsCount = Math.max(1, Number(roundsInput?.value) || naturalRoundsCount(teams.length));
      const { rounds } = buildRoundRobinSchedule(teams.map((t) => t.id), roundsCount);
      grouping.teams = teams;
      grouping.incompleteTeamGroupIds = incompleteTeamGroupIds;
      grouping.rounds = rounds;
      await persist();
      draw();
      toast('已產生對戰表');
    });

    const rerollBtn = tabBody.querySelector('#reroll-schedule-btn');
    if (rerollBtn) {
      rerollBtn.addEventListener('click', async () => {
        const { rounds } = buildRoundRobinSchedule(grouping.teams.map((t) => t.id), grouping.rounds.length);
        grouping.rounds = rounds;
        await persist();
        draw();
        toast('已重新排列對戰表');
      });
    }
  }

  draw();
}

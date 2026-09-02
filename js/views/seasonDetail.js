import { getById, getByIndex, getAll, put, remove, putMany } from '../db.js';
import { getSettings } from '../db.js';
import {
  uid, toast, openModal, confirmDialog, escapeHtml, fmtDate, fmtDateOnly, fmtMoney,
  backButtonHtml, attachBackButton, settlementResultHtml, parseNamesInput, resolveMembersByNames,
} from '../utils.js';
import { navigate } from '../router.js';
import { refreshTopbar } from '../topbar.js';
import { computeSessionStats, computeSeasonStats, computeSeasonPassSettlement, seasonPassFeeOf, buildSeasonPassPaidMap, computeSeasonPassPrepaidByMethod, roundUpToNearest5, acFeeBaselineOf } from '../calc.js';
import { sessionSectionsHtml, openAddSessionModal, sessionDefaultsFieldsHtml, bindSessionDefaultsFieldEvents, readSessionDefaultsFromPanel, applySeasonDefaultsToAllSessions, candidatePickerFieldHtml, bindCandidatePicker } from '../sessionShared.js';
import { buildSettlementFlexMessage, buildRefundDetailFlexMessage, sendToLineRelay } from '../lineShare.js';
import { API_BASE_URL } from '../config.js';

export async function renderSeasonDetail(root, seasonId) {
  const season = await getById('seasons', seasonId);
  if (!season) { navigate('/seasons'); return; }

  const members = await getAll('members');
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  const settings = await getSettings();

  let sessions = (await getByIndex('sessions', 'seasonId', seasonId)).sort((a, b) => a.date.localeCompare(b.date));
  let seasonPasses = (await getByIndex('seasonPasses', 'seasonId', seasonId));
  let allRosters = [];
  for (const s of sessions) {
    const r = await getByIndex('sessionRosters', 'sessionId', s.id);
    allRosters.push(...r);
  }

  let activeTab = 'sessions';
  let selectedPassIds = new Set();

  function rostersFor(sessionId) { return allRosters.filter((r) => r.sessionId === sessionId); }

  // rosterRowsBySessionId for one member (only their seasonPass-sourced rows)
  function memberRosterMap(memberId) {
    const map = {};
    allRosters.forEach((r) => {
      if (r.memberId === memberId && r.sourceType === 'seasonPass') map[r.sessionId] = r;
    });
    return map;
  }

  function buildSettlements() {
    // Point 4: a season pass that was never actually prepaid (paymentStatus
    // !== '已繳') has nothing to "settle" — there's no prepayment to refund
    // from, so showing them here would just produce a misleading "owes a
    // full makeup" line. They stay visible in 季打名單 (with their paid
    // status ), just excluded from 統計結算 and the season-level refund
    // total.
    return seasonPasses.filter((sp) => sp.paymentStatus === '已繳').map((sp) => {
      const settlement = computeSeasonPassSettlement(sp, sessions, memberRosterMap(sp.memberId), season);
      return { seasonPass: sp, settlement };
    });
  }

  function buildSessionStats() {
    const out = {};
    const paidMap = buildSeasonPassPaidMap(seasonPasses);
    sessions.forEach((s) => { out[s.id] = computeSessionStats(s, rostersFor(s.id), paidMap); });
    return out;
  }

  function draw() {
    const sessionStatsById = buildSessionStats();
    const settlements = buildSettlements();
    const seasonPassesWithSettlement = settlements.map((x) => ({ ...x.seasonPass, settlement: x.settlement }));
    const seasonStats = computeSeasonStats(sessions, sessionStatsById, seasonPassesWithSettlement);

    root.innerHTML = `
      <div class="page-head page-head-sticky flex-wrap-head">
        <div class="page-head-left">
          ${backButtonHtml()}
          <div style="min-width:0;">
            <h1 class="h1-nowrap">${escapeHtml(season.name)}・共${sessions.length}場</h1>
            <div class="sub">${fmtDateOnly(season.startDate)} － ${fmtDateOnly(season.endDate)}</div>
          </div>
        </div>
        <button class="icon-action-btn" id="edit-season-btn" aria-label="季度設定"><img src="icons/icon-settings-button.png" alt=""></button>
      </div>

      <div class="scoreboard">
        <div class="scoreboard-label">季度總覽・已收 / 應收</div>
        <div class="scoreboard-grid">
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(seasonStats.received)}</div><div class="cap">已收金額</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(seasonStats.receivable)}</div><div class="cap">應收金額</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(seasonStats.expense)}</div><div class="cap">總支出</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(seasonStats.receivedSurplus)}</div><div class="cap">已收盈餘</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(seasonStats.receivableSurplus)}</div><div class="cap">應收盈餘</div></div>
          <div class="scoreboard-cell warn"><div class="num mono">$${fmtMoney(seasonStats.refundTotal)}</div><div class="cap">季打退款總額</div></div>
        </div>
      </div>

      <div class="subtabs">
        <button data-tab="sessions" class="${activeTab === 'sessions' ? 'active' : ''}">場次管理</button>
        <button data-tab="passes" class="${activeTab === 'passes' ? 'active' : ''}">季打名單</button>
        <button data-tab="ac" class="${activeTab === 'ac' ? 'active' : ''}">冷氣使用</button>
        <button data-tab="stats" class="${activeTab === 'stats' ? 'active' : ''}">統計結算</button>
      </div>

      <div id="tab-body"></div>
    `;

    attachBackButton(root);
    root.querySelector('#edit-season-btn').addEventListener('click', () => openEditSeasonModal());
    root.querySelectorAll('.subtabs button').forEach((btn) => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; draw(); });
    });

    const tabBody = root.querySelector('#tab-body');
    if (activeTab === 'passes') drawPassesTab(tabBody);
    else if (activeTab === 'sessions') drawSessionsTab(tabBody);
    else if (activeTab === 'ac') drawAcTab(tabBody);
    else drawStatsTab(tabBody, settlements, seasonStats);
  }

  // ---------------- 場次管理 tab ----------------
  function drawSessionsTab(tabBody) {
    tabBody.innerHTML = `
      <div class="flex-between mt-8" style="margin-bottom:10px;">
        <div class="small text-soft">共 ${sessions.length} 場</div>
        <button class="btn btn-primary btn-sm" id="add-session-btn">＋ 新增場次</button>
      </div>
      ${sessionSectionsHtml(sessions, rostersFor, seasonPasses)}
    `;
    tabBody.querySelector('#add-session-btn').addEventListener('click', () => {
      const lastSession = sessions[sessions.length - 1];
      openAddSessionModal({
        ongoingSeasons: [season],
        defaultSeasonId: season.id,
        showSeasonSelect: false,
        lastSession,
        onCreated: async (session, rosterRows) => {
          sessions.push(session);
          sessions.sort((a, b) => a.date.localeCompare(b.date));
          allRosters.push(...rosterRows);
          draw();
        },
      });
    });
    tabBody.querySelectorAll('[data-open-session]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/sessions/${el.dataset.openSession}`));
    });
    tabBody.querySelectorAll('[data-delete-session]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = sessions.find((x) => x.id === btn.dataset.deleteSession);
        confirmDialog(`確定要刪除 ${fmtDate(s.date)} 這場場次嗎？名單與紀錄將一併刪除。`, async () => {
          const rosters = rostersFor(s.id);
          await Promise.all(rosters.map((r) => remove('sessionRosters', r.id)));
          await remove('sessions', s.id);
          sessions = sessions.filter((x) => x.id !== s.id);
          allRosters = allRosters.filter((r) => r.sessionId !== s.id);
          draw();
        });
      });
    });
  }

  // Point 3: shows every session's AC usage status for this season, sorted by date.
  function drawAcTab(tabBody) {
    const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
    const acLabelClass = { '未使用': 'badge-gray', '使用': 'badge-blue', '部分使用': 'badge-gold' };
    tabBody.innerHTML = `
      <div class="small text-soft mt-8" style="margin-bottom:10px;">共 ${sorted.length} 場</div>
      ${sorted.length === 0 ? `
        <div class="empty-state"><div class="glyph">◷</div><p>本季尚未建立任何場次</p></div>
      ` : `<div class="card">
            ${sorted.map((s) => `
              <div class="list-row" data-open-session="${s.id}" style="cursor:pointer;">
                <div class="list-row-main">
                  <div class="list-row-title">${fmtDate(s.date)}</div>
                  <div class="list-row-meta">冷氣費 $${fmtMoney(s.acCost)}</div>
                </div>
                <span class="badge ${acLabelClass[s.acUsed] || 'badge-gray'}">${escapeHtml(s.acUsed || '未使用')}</span>
              </div>
            `).join('')}
          </div>`}
    `;
    tabBody.querySelectorAll('[data-open-session]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/sessions/${el.dataset.openSession}`));
    });
  }

  // ---------------- 季打名單 tab ----------------
  function drawPassesTab(tabBody) {
    const rows = seasonPasses
      .map((sp) => ({ sp, member: membersById[sp.memberId] }))
      .filter((x) => x.member)
      .sort((a, b) => a.member.name.localeCompare(b.member.name, 'zh-Hant'));
    const male = rows.filter((x) => x.member.gender === '男');
    const female = rows.filter((x) => x.member.gender === '女');
    const theadHtml = `<thead><tr>
      <th style="width:44px;"></th><th>姓名</th><th style="width:64px;">繳費</th><th style="width:38px;"></th>
    </tr></thead>`;

    // Point 1: this card is specifically "how much season-pass prepayment have
    // we collected" — a member who never prepaid but paid one session ad-hoc
    // must not show up here, so this uses a dedicated computation rather than
    // the broader computeSeasonStats (which folds in casual/per-session money).
    const prepaidStats = computeSeasonPassPrepaidByMethod(seasonPasses);
    const methodEntries = Object.entries(prepaidStats.byMethod);

    tabBody.innerHTML = `
      <div class="card">
        <div class="card-title flex-between"><span>總計</span><span class="mono">$${fmtMoney(prepaidStats.total)}</span></div>
        ${methodEntries.length ? `
          <div class="stack">
            ${methodEntries.map(([k, v]) => `<div class="flex-between"><span>${escapeHtml(k)}</span><span class="mono">$${fmtMoney(v)}</span></div>`).join('')}
          </div>
        ` : '<div class="small text-faint">尚無已收款項</div>'}
      </div>

      <div class="flex-between mt-8" style="margin-bottom:10px;">
        <div class="small text-soft">共 ${rows.length} 位季打（男 ${male.length} 位・女 ${female.length} 位）</div>
        <button class="btn btn-primary btn-sm" id="add-pass-btn">＋ 加入季打</button>
      </div>
      ${selectedPassIds.size ? `
        <div class="batch-bar">
          已選取 <strong>${selectedPassIds.size}</strong> 位
          <button class="btn btn-sm" id="batch-payment-btn">繳費狀態</button>
          <button class="btn btn-sm" id="clear-select-btn">取消</button>
        </div>
      ` : ''}
      ${rows.length === 0 ? `
        <div class="empty-state"><div class="glyph">◍</div><p>本季尚未設定季打名單</p></div>
      ` : `<div class="card">
            <label style="display:flex;align-items:center;gap:14px;margin-bottom:10px;">
              <input type="checkbox" id="select-all-passes"><span class="small text-soft">全選</span>
            </label>
            <div class="roster-group-head roster-group-head-male">男（${male.length}）</div>
            <div class="table-scroll"><table class="roster">${theadHtml}<tbody>${male.length ? male.map(passRow).join('') : blankPassRow()}</tbody></table></div>
            <div class="roster-group-head roster-group-head-female mt-16">女（${female.length}）</div>
            <div class="table-scroll"><table class="roster">${theadHtml}<tbody>${female.length ? female.map(passRow).join('') : blankPassRow()}</tbody></table></div>
          </div>`}
    `;

    tabBody.querySelector('#add-pass-btn').addEventListener('click', () => openAddPassModal());
    const selectAll = tabBody.querySelector('#select-all-passes');
    if (selectAll) {
      selectAll.checked = rows.length > 0 && selectedPassIds.size === rows.length;
      selectAll.addEventListener('change', () => {
        if (selectAll.checked) rows.forEach((r) => selectedPassIds.add(r.sp.id));
        else selectedPassIds.clear();
        drawPassesTab(tabBody);
      });
    }
    tabBody.querySelectorAll('[data-select-pass]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedPassIds.add(cb.dataset.selectPass);
        else selectedPassIds.delete(cb.dataset.selectPass);
        drawPassesTab(tabBody);
      });
    });
    const clearBtn = tabBody.querySelector('#clear-select-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => { selectedPassIds.clear(); drawPassesTab(tabBody); });
    const batchBtn = tabBody.querySelector('#batch-payment-btn');
    if (batchBtn) batchBtn.addEventListener('click', () => openBatchPassPaymentModal(tabBody));

    tabBody.querySelectorAll('[data-open-member]').forEach((el) => {
      el.addEventListener('click', () => {
        const sp = seasonPasses.find((x) => x.id === el.dataset.openMember);
        openMemberAttendanceModal(sp);
      });
    });
    tabBody.querySelectorAll('[data-show-join-date]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const sp = seasonPasses.find((x) => x.id === el.dataset.showJoinDate);
        const member = membersById[sp.memberId];
        openModal({
          title: `${escapeHtml(member?.name || '')}・中途加入`,
          bodyHtml: `<p class="small text-soft">加入日期為 <strong>${fmtDateOnly(sp.joinedFromSessionDate)}</strong></p>`,
          actions: [{ label: '關閉', primary: true, onClick: (close) => close() }],
        });
      });
    });
    tabBody.querySelectorAll('[data-edit-pass]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sp = seasonPasses.find((x) => x.id === btn.dataset.editPass);
        openEditPassModal(sp);
      });
    });
    tabBody.querySelectorAll('[data-remove-pass]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sp = seasonPasses.find((x) => x.id === btn.dataset.removePass);
        const m = membersById[sp.memberId];
        confirmDialog(`確定要將「${escapeHtml(m?.name || '')}」移出本季季打名單嗎？已建立場次的歷史名單不會被回溯修改。`, async () => {
          await remove('seasonPasses', sp.id);
          seasonPasses = seasonPasses.filter((x) => x.id !== sp.id);
          selectedPassIds.delete(sp.id);
          drawPassesTab(tabBody);
          toast('已移出季打名單');
        });
      });
    });
  }

  function blankPassRow() {
    return `<tr><td colspan="4" class="small text-faint" style="padding:8px;">尚無人員</td></tr>`;
  }

  function passRow({ sp, member }) {
    const isMidSeason = sp.joinedFromSessionDate && sp.joinedFromSessionDate !== season.startDate;
    return `
      <tr>
        <td><input type="checkbox" data-select-pass="${sp.id}" ${selectedPassIds.has(sp.id) ? 'checked' : ''}></td>
        <td class="roster-name" data-open-member="${sp.id}" style="cursor:pointer;">
          ${escapeHtml(member.name)}<span class="gender-tag">${member.gender}</span>
          ${isMidSeason ? `<span class="badge badge-blue" data-show-join-date="${sp.id}" style="cursor:pointer;">中途加入</span>` : ''}
        </td>
        <td>
          <span class="badge ${sp.paymentStatus === '已繳' ? 'badge-green' : 'badge-gray'}" data-edit-pass="${sp.id}" style="cursor:pointer;">${sp.paymentStatus === '已繳' ? '已繳' : '未繳'}</span>
        </td>
        <td class="text-right">
          <button class="icon-btn" data-remove-pass="${sp.id}" aria-label="移出">✕</button>
        </td>
      </tr>
    `;
  }

  // Point 9: multi-select add. Point 10: auto-add newly joined members (出席) to every
  // session in this season that hasn't happened yet (date >= today) — history is untouched.
  function openAddPassModal() {
    const existingMemberIds = new Set(seasonPasses.map((sp) => sp.memberId));
    // Point 2: only show 常用 (favorite) members in the multi-select picker.
    const candidates = members.filter((m) => m.isFavorite && !existingMemberIds.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const selectedCandidateIds = new Set();

    openModal({
      title: '加入季打名單',
      bodyHtml: `
        ${candidatePickerFieldHtml('pass-candidate', '選擇常用人員（可搜尋、可多選）')}
        <div class="field">
          <label>手動輸入</label>
          <div class="field-row">
            <input type="text" id="new-member-name" style="flex:2;">
            <div class="radio-group" id="new-gender-group" style="flex:1;">
              <label class="radio-chip checked"><input type="radio" name="new-gender" value="男" checked>男</label>
              <label class="radio-chip"><input type="radio" name="new-gender" value="女">女</label>
            </div>
          </div>
          <div class="field-hint">同名的既有人員會直接沿用，不會重複新增。</div>
        </div>
        <div class="field">
          <label>加入日期</label>
          <input type="date" id="pass-join-date" value="${season.startDate}" min="${season.startDate}" max="${season.endDate}">
          <div class="field-hint">預設為季度開始日期。加入日期「之後」（含當天）的場次會自動把這些人加進去，之前的場次不會加入。</div>
        </div>
        <div class="field">
          <label>本季預收金額（每人）</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="pass-prepaid" value="${season.seasonPassFee || 0}">
          <div class="field-hint">預設帶入季度設定中的整季預收金額，套用於本次選取的所有人。</div>
        </div>
      `,
      onMount: (panel) => {
        bindCandidatePicker(panel, 'pass-candidate', candidates, selectedCandidateIds, escapeHtml);
        panel.querySelectorAll('#new-gender-group .radio-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            panel.querySelectorAll('#new-gender-group .radio-chip').forEach((c) => c.classList.remove('checked'));
            chip.classList.add('checked');
          });
        });
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '加入',
          primary: true,
          onClick: async (close, panel) => {
            const prepaidAmount = Number(panel.querySelector('#pass-prepaid').value) || 0;
            const memberIds = [...selectedCandidateIds];
            const newNames = parseNamesInput(panel.querySelector('#new-member-name').value);
            if (newNames.length) {
              const gender = panel.querySelector('input[name=new-gender]:checked').value;
              const { newMembers, resolvedIds } = resolveMembersByNames(newNames, gender, members);
              if (newMembers.length) {
                await putMany('members', newMembers);
                members.push(...newMembers);
                newMembers.forEach((nm) => { membersById[nm.id] = nm; });
              }
              memberIds.push(...resolvedIds);
            }
            if (memberIds.length === 0) { toast('請至少選擇一位人員'); return; }

            const joinDate = panel.querySelector('#pass-join-date').value || season.startDate;
            const newPasses = [];
            const newRosterRows = [];
            for (const memberId of memberIds) {
              const sp = {
                id: uid(), seasonId, memberId,
                joinedFromSessionDate: joinDate,
                prepaidAmount,
                paymentStatus: '未繳',
                paymentMethod: '',
                createdAt: new Date().toISOString(),
              };
              newPasses.push(sp);
              // Every session in the season gets an explicit row: on/after the join date the
              // member is marked 出席; before it, explicitly 請假 (so settlement calculations
              // don't accidentally treat pre-join sessions as attended — see point 3 fix).
              sessions.forEach((s) => {
                newRosterRows.push({
                  id: uid(), sessionId: s.id, memberId, sourceType: 'seasonPass',
                  attendance: s.date >= joinDate ? '出席' : '請假',
                  // Point (bugfix): default to THIS session's own configured season-pass
                  // rate, not a hardcoded 0 — otherwise later picking a payment method
                  // for a single unpaid session leaves the stale $0 fee in place, and
                  // that per-session payment silently contributes $0 to the money totals.
                  feeAmount: seasonPassFeeOf(s), paymentMethod: '', createdAt: new Date().toISOString(),
                });
              });
            }
            await putMany('seasonPasses', newPasses);
            if (newRosterRows.length) await putMany('sessionRosters', newRosterRows);
            seasonPasses.push(...newPasses);
            allRosters.push(...newRosterRows);
            close();
            draw();
            const attendingCount = sessions.filter((s) => s.date >= joinDate).length;
            toast(`已加入 ${newPasses.length} 位季打：加入日期之後共 ${attendingCount} 場設為出席，之前的場次設為請假`);
          },
        },
      ],
    });
  }

  function openEditPassModal(sp) {
    const member = membersById[sp.memberId];
    openModal({
      title: `編輯季打・${escapeHtml(member?.name || '')}`,
      bodyHtml: `
        <div class="field"><label>本季預收金額</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-prepaid" value="${sp.prepaidAmount}"></div>
        <div class="field">
          <label>繳費方式</label>
          <select id="edit-method" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            <option value="">－ 未指定 －</option>
            ${settings.paymentMethods.map((m) => `<option value="${m}" ${sp.paymentMethod === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <div class="field-hint" id="edit-status-preview">繳費狀態：${sp.paymentMethod ? '已繳' : '未繳'}（跟著繳費方式自動判斷：選了方式即為已繳，選「未指定」即為未繳）</div>
        </div>
      `,
      onMount: (panel) => {
        const methodSelect = panel.querySelector('#edit-method');
        const preview = panel.querySelector('#edit-status-preview');
        methodSelect.addEventListener('change', () => {
          preview.textContent = `繳費狀態：${methodSelect.value ? '已繳' : '未繳'}（跟著繳費方式自動判斷：選了方式即為已繳，選「未指定」即為未繳）`;
        });
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '儲存',
          primary: true,
          onClick: async (close, panel) => {
            const paymentMethod = panel.querySelector('#edit-method').value;
            const updated = {
              ...sp,
              prepaidAmount: Number(panel.querySelector('#edit-prepaid').value) || 0,
              paymentMethod,
              // Point 2: 繳費狀態 is no longer a separate manual toggle — it's
              // derived directly from whether a payment method is set.
              paymentStatus: paymentMethod ? '已繳' : '未繳',
            };
            await put('seasonPasses', updated);
            seasonPasses = seasonPasses.map((x) => (x.id === sp.id ? updated : x));
            close();
            draw();
            toast('已更新');
          },
        },
      ],
    });
  }

  function openBatchPassPaymentModal(tabBody) {
    openModal({
      title: `批量設定繳費（${selectedPassIds.size} 位）`,
      bodyHtml: `
        <div class="field">
          <label>繳費方式</label>
          <select id="batch-method" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            <option value="">－ 未指定（設為未繳）－</option>
            ${settings.paymentMethods.map((m) => `<option value="${m}">${m}</option>`).join('')}
          </select>
          <div class="field-hint">繳費狀態會跟著自動判斷：選了方式即為已繳，選「未指定」即為未繳。</div>
        </div>
      `,
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '套用',
          primary: true,
          onClick: async (close, panel) => {
            const method = panel.querySelector('#batch-method').value;
            const status = method ? '已繳' : '未繳';
            const updates = seasonPasses
              .filter((sp) => selectedPassIds.has(sp.id))
              .map((sp) => ({ ...sp, paymentStatus: status, paymentMethod: method }));
            await putMany('seasonPasses', updates);
            seasonPasses = seasonPasses.map((sp) => updates.find((u) => u.id === sp.id) || sp);
            selectedPassIds.clear();
            close();
            draw();
            toast('已批量更新繳費狀態');
          },
        },
      ],
    });
  }

  // Point 12/15 — click a season-pass member's name: see attendance across every session,
  // total leave count, batch-adjust multiple sessions at once (syncs straight back into that
  // session's own 季打管理 state), all changes save immediately.
  function openMemberAttendanceModal(sp) {
    const member = membersById[sp.memberId];
    let selectedSessionIds = new Set();

    function currentSettlement() {
      return computeSeasonPassSettlement(sp, sessions, memberRosterMap(sp.memberId), season);
    }

    function bodyHtml() {
      const settlement = currentSettlement();
      const leaveCount = settlement.rows.filter((r) => r.attendance === '請假').length;
      return `
        <div class="small text-soft" style="margin-bottom:8px;">共 ${sessions.length} 場・請假 ${leaveCount} 場</div>
        ${selectedSessionIds.size ? `
          <div class="batch-bar" style="margin-bottom:8px;">
            已選取 <strong>${selectedSessionIds.size}</strong> 場
            <button class="btn btn-sm" data-batch-attendance="出席">設為出席</button>
            <button class="btn btn-sm" data-batch-attendance="請假">設為請假</button>
            <button class="btn btn-sm" id="modal-clear-select">取消選取</button>
          </div>
        ` : ''}
        <div class="stack">
          <label style="display:flex;align-items:center;gap:14px;"><input type="checkbox" id="modal-select-all"><span class="small text-soft">全選</span></label>
          ${settlement.rows.map((r) => `
            <div class="flex-between" style="gap:8px;">
              <label style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;">
                <input type="checkbox" class="modal-session-checkbox" value="${r.sessionId}" ${selectedSessionIds.has(r.sessionId) ? 'checked' : ''}>
                <span class="small" style="white-space:nowrap;">${fmtDate(r.date)}</span>
              </label>
              <select class="inline-select" style="width:64px;flex-shrink:0;" data-attendance-session="${r.sessionId}">
                <option value="出席" ${r.attendance === '出席' ? 'selected' : ''}>出席</option>
                <option value="請假" ${r.attendance === '請假' ? 'selected' : ''}>請假</option>
              </select>
            </div>
          `).join('')}
        </div>
        <div class="divider"></div>
        <div class="flex-between small">
          <span class="text-soft">預收 $${fmtMoney(settlement.prepaidAmount)}　應付 $${fmtMoney(settlement.actualTotalDue)}</span>
          ${settlementResultHtml(settlement)}
        </div>
      `;
    }

    const modal = openModal({
      title: `${escapeHtml(member?.name || '')}・本季出席紀錄`,
      bodyHtml: bodyHtml(),
      actions: [],
    });

    async function setAttendance(sessionId, value) {
      const existing = allRosters.find((r) => r.sessionId === sessionId && r.memberId === sp.memberId && r.sourceType === 'seasonPass');
      if (existing) {
        // Point (bugfix): same fix as session detail's own attendance select
        // — switching to 請假 clears any leftover per-session payment method.
        const updated = { ...existing, attendance: value, ...(value === '請假' ? { paymentMethod: '' } : {}) };
        await put('sessionRosters', updated);
        allRosters = allRosters.map((r) => (r.id === existing.id ? updated : r));
      } else {
        const created = {
          id: uid(), sessionId, memberId: sp.memberId, sourceType: 'seasonPass',
          attendance: value, feeAmount: seasonPassFeeOf(sessions.find((s) => s.id === sessionId)), paymentMethod: '', createdAt: new Date().toISOString(),
        };
        await put('sessionRosters', created);
        allRosters.push(created);
      }
    }

    function rerender(panel) {
      panel.querySelector('.modal-body').innerHTML = bodyHtml();
      bindEvents(panel);
      draw();
    }

    function bindEvents(panel) {
      panel.querySelectorAll('[data-attendance-session]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          await setAttendance(sel.dataset.attendanceSession, sel.value);
          rerender(panel);
        });
      });
      const selectAll = panel.querySelector('#modal-select-all');
      if (selectAll) {
        selectAll.checked = sessions.length > 0 && selectedSessionIds.size === sessions.length;
        selectAll.addEventListener('change', () => {
          if (selectAll.checked) sessions.forEach((s) => selectedSessionIds.add(s.id));
          else selectedSessionIds.clear();
          rerender(panel);
        });
      }
      panel.querySelectorAll('.modal-session-checkbox').forEach((cb) => {
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSessionIds.add(cb.value);
          else selectedSessionIds.delete(cb.value);
          rerender(panel);
        });
      });
      const clearBtn = panel.querySelector('#modal-clear-select');
      if (clearBtn) clearBtn.addEventListener('click', () => { selectedSessionIds.clear(); rerender(panel); });
      panel.querySelectorAll('[data-batch-attendance]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const value = btn.dataset.batchAttendance;
          for (const sessionId of selectedSessionIds) {
            await setAttendance(sessionId, value);
          }
          selectedSessionIds.clear();
          rerender(panel);
          toast(`已批量設定為${value}`);
        });
      });
    }
    bindEvents(modal.panel);
  }

  // ---------------- 統計結算 tab ----------------
  function drawStatsTab(tabBody, settlements, seasonStats) {
    tabBody.innerHTML = `
      <div class="card">
        <div class="flex-between" style="margin-bottom:6px;">
          <div class="card-title" style="margin-bottom:0;">季打退款 / 補收結算</div>
          <button class="icon-action-btn" id="send-settlement-line-btn" aria-label="發送到LINE"><img src="icons/icon-line-button.png" alt=""></button>
        </div>
        <div class="small text-faint mt-8" style="margin-bottom:8px;">退費以「-」顯示，需要補繳則以「+」標紅顯示。點擊姓名可看詳細內容。</div>
        ${settlements.length === 0 ? '<div class="small text-faint">本季尚無季打名單</div>' : `
          <div class="table-scroll">
          <table class="roster">
            <thead><tr><th>姓名</th><th style="width:78px;">結果</th><th style="width:82px;">狀態</th></tr></thead>
            <tbody>
              ${settlements.map((x) => settlementRow(x)).join('')}
            </tbody>
          </table>
          </div>
        `}
      </div>
    `;

    tabBody.querySelectorAll('[data-toggle-refund]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        (async () => {
          const sp = seasonPasses.find((x) => x.id === btn.dataset.toggleRefund);
          const updated = { ...sp, refundStatus: sp.refundStatus === '已結清' ? '未結清' : '已結清' };
          await put('seasonPasses', updated);
          seasonPasses = seasonPasses.map((x) => (x.id === sp.id ? updated : x));
          draw();
        })();
      });
    });
    tabBody.querySelectorAll('[data-open-settlement]').forEach((el) => {
      el.addEventListener('click', () => {
        const found = settlements.find((x) => x.seasonPass.id === el.dataset.openSettlement);
        if (found) openSettlementDetailModal(found);
      });
    });
    const sendBtn = tabBody.querySelector('#send-settlement-line-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => openSendSettlementToLineModal(settlements));
  }

  function settlementRow({ seasonPass, settlement }) {
    const member = membersById[seasonPass.memberId];
    const needsAction = settlement.isMakeup || settlement.refundAmount > 0;
    const status = seasonPass.refundStatus === '已結清' ? '已結清' : '未結清';
    return `
      <tr>
        <td class="roster-name" data-open-settlement="${seasonPass.id}" style="cursor:pointer;vertical-align:top;">${escapeHtml(member?.name || '')}</td>
        <td style="vertical-align:top;">${settlementResultHtml(settlement)}</td>
        <td style="vertical-align:top;">
          ${needsAction ? `<button class="btn btn-sm ${status === '已結清' ? '' : 'btn-primary'}" data-toggle-refund="${seasonPass.id}">${status}</button>` : '<span class="small text-faint">－</span>'}
        </td>
      </tr>
    `;
  }

  // Point 7: click a name in the settlement table to see the full breakdown.

  function openSettlementDetailModal({ seasonPass, settlement }) {
    const member = membersById[seasonPass.memberId];
    const sessionsByIdLocal = Object.fromEntries(sessions.map((s) => [s.id, s]));
    const attendedRows = settlement.rows.filter((r) => r.attendance === '出席');
    const leaveRows = settlement.rows.filter((r) => r.attendance === '請假');
    const leaveCount = leaveRows.length;

    // Point 2: split each attended session's flat fee into a 場地費 / 冷氣費 portion,
    // using that session's own 人數 (divisor): 冷氣費 = ROUND_UP(acCost ÷ 人數, 至5的倍數),
    // 場地費 = fee − 冷氣費.
    let venueTotal = 0;
    let acTotal = 0;
    const attendedDetails = attendedRows.map((r) => {
      const s = sessionsByIdLocal[r.sessionId];
      const divisor = s && s.seasonPassDivisor > 0 ? s.seasonPassDivisor : 18;
      const acShare = s ? roundUpToNearest5((Number(s.acCost) || 0) / divisor) : 0;
      const venueShare = r.fee - acShare;
      venueTotal += venueShare;
      acTotal += acShare;
      return { date: r.date, fee: r.fee, divisor };
    });

    const status = seasonPass.refundStatus === '已結清' ? '已結清' : '未結清';
    openModal({
      title: `${escapeHtml(member?.name || '')}・結算明細`,
      bodyHtml: `
        <div class="stack">
          <div class="flex-between"><span class="text-soft">預收金額</span><span class="mono">$${fmtMoney(settlement.prepaidAmount)}</span></div>
          <div class="flex-between"><span class="text-soft">場地費</span><span class="mono">$${fmtMoney(venueTotal)}</span></div>
          <div class="flex-between"><span class="text-soft">冷氣費</span><span class="mono">$${fmtMoney(acTotal)}</span></div>
          ${attendedDetails.length > 0 ? `
            <div class="detail-accordion">
              <button class="btn btn-sm detail-toggle-btn" id="toggle-attend-list-btn" style="width:100%;">出席詳情</button>
              <div id="attend-list" class="detail-expand" style="display:none;">
                <div class="stack" style="gap:4px;">
                  ${attendedDetails.map((d) => `<div class="flex-between small text-soft"><span>${fmtDate(d.date)}</span><span>$${fmtMoney(d.fee)}（${d.divisor}人）</span></div>`).join('')}
                </div>
              </div>
            </div>
          ` : ''}
          <div class="flex-between"><span class="text-soft">實際應付金額</span><span class="mono">$${fmtMoney(settlement.actualTotalDue)}</span></div>
          <div class="flex-between"><span class="text-soft">請假場次</span><span class="mono">${leaveCount} 場</span></div>
          ${leaveCount > 0 ? `
            <div class="detail-accordion">
              <button class="btn btn-sm detail-toggle-btn" id="toggle-leave-list-btn" style="width:100%;">請假詳情</button>
              <div id="leave-list" class="detail-expand" style="display:none;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;">
                  ${leaveRows.map((r) => `<div class="small text-soft">${fmtDate(r.date)}</div>`).join('')}
                </div>
              </div>
            </div>
          ` : ''}
          <div class="divider"></div>
          <div class="flex-between"><span class="text-soft">結果</span>${settlementResultHtml(settlement)}</div>
          <div class="flex-between"><span class="text-soft">狀態</span><span class="small">${status}</span></div>
        </div>
      `,
      onMount: (panel) => {
        const toggleAttendBtn = panel.querySelector('#toggle-attend-list-btn');
        if (toggleAttendBtn) {
          toggleAttendBtn.addEventListener('click', () => {
            const list = panel.querySelector('#attend-list');
            list.style.display = list.style.display === 'none' ? '' : 'none';
          });
        }
        const toggleBtn = panel.querySelector('#toggle-leave-list-btn');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', () => {
            const list = panel.querySelector('#leave-list');
            list.style.display = list.style.display === 'none' ? '' : 'none';
          });
        }
      },
      actions: [],
    });
  }

  // Point 11: send the whole season's refund/makeup summary to a saved LINE chat.
  // Stores each member's full refund-detail Flex Message to the Worker (D1),
  // so that later — whenever someone taps their name's postback button in the
  // group message — the Worker can look it up and push it to them privately,
  // without needing the PWA to be open. Best-effort: if this fails, the group
  // message itself has ALREADY been sent successfully, so we don't want a
  // storage hiccup to make the whole "send" action look like it failed —
  // just warn quietly instead.
  async function storeRefundDetailsForPostback(settlements) {
    const items = settlements
      .map(({ seasonPass, settlement }) => {
        const member = membersById[seasonPass.memberId];
        if (!member) return null;
        return { memberId: seasonPass.memberId, message: buildRefundDetailFlexMessage(season, member, settlement) };
      })
      .filter(Boolean);
    if (items.length === 0) return { ok: true };
    console.log('[refund-detail store] 準備儲存', items.length, '筆，memberId：', items.map((i) => i.memberId));

    const CHUNK_SIZE = 100;
    try {
      let totalStored = 0;
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const res = await fetch(`${API_BASE_URL}/refund-details/store`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.lineRelayApiKey || '' },
          body: JSON.stringify({ items: chunk }),
        });
        const resBody = await res.json().catch(() => null);
        console.log('[refund-detail store] Worker 回應：', res.status, resBody);
        // Point (bugfix): a 200 OK response isn't enough — the Worker silently
        // skips any item missing memberId/message and still returns 200. Only
        // trust it if the reported `stored` count actually matches what we
        // sent; otherwise something is malformed even though the HTTP call
        // itself "succeeded".
        if (!res.ok) throw new Error(`儲存退費詳情失敗（HTTP ${res.status}）`);
        if (!resBody || typeof resBody.stored !== 'number') throw new Error('儲存退費詳情失敗（Worker 回應格式不符預期，可能是舊版 Worker）');
        totalStored += resBody.stored;
      }
      if (totalStored !== items.length) {
        console.warn(`[refund-detail store] 只有 ${totalStored}/${items.length} 筆真的寫入，可能有 memberId 或 message 缺漏`);
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      console.warn('Failed to store refund details for postback:', err);
      return { ok: false };
    }
  }

  function openSendSettlementToLineModal(settlements) {
    if (!settings.lineTargets || settings.lineTargets.length === 0) {
      openModal({
        title: '尚未設定LINE發送',
        bodyHtml: `<p class="small text-soft">請先到「設定」頁面至少新增一個常用聊天室，才能發送結算結果到LINE。</p>`,
        actions: [
          { label: '取消', onClick: (close) => close() },
          { label: '前往設定', primary: true, onClick: (close) => { close(); navigate('/settings'); } },
        ],
      });
      return;
    }
    openModal({
      title: '發送季打結算到LINE',
      bodyHtml: `
        <div class="field">
          <label>選擇聊天室</label>
          <select id="settlement-line-target-select" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            ${settings.lineTargets.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <p class="small text-faint">將會發送本季（${escapeHtml(season.name)}）所有季打的退款／補收結算結果。</p>
      `,
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '送出',
          primary: true,
          onClick: async (close, panel) => {
            const targetId = panel.querySelector('#settlement-line-target-select').value;
            const target = settings.lineTargets.find((t) => t.id === targetId);
            if (!target) { toast('找不到選擇的聊天室'); return; }
            try {
              const message = buildSettlementFlexMessage(season, settlements, membersById);
              await sendToLineRelay({
                relayUrl: API_BASE_URL,
                apiKey: settings.lineRelayApiKey,
                groupId: target.groupId,
                messages: [message],
              });
              // Point (bugfix): wait for the refund-detail storage to finish
              // TOO, before closing the modal — otherwise, once the modal
              // closes and the success toast shows, the user is likely to
              // background or close the app immediately, and a still-in-
              // flight fire-and-forget fetch can get killed by the browser
              // before it ever reaches the Worker (mobile browsers throttle
              // background tabs aggressively).
              const storeResult = await storeRefundDetailsForPostback(settlements);
              close();
              toast(storeResult.ok
                ? `已發送到「${target.name}」`
                : `已發送到「${target.name}」，但退費詳情儲存失敗，點擊姓名可能查不到個人詳情`);
            } catch (err) {
              toast(err.message || '發送失敗');
            }
          },
        },
      ],
    });
  }

  function openEditSeasonModal() {
    openModal({
      title: '季度設定',
      bodyHtml: `
        <div class="field-row">
          <div class="field"><label>起始日期</label><input type="date" id="edit-start" value="${season.startDate}"></div>
          <div class="field"><label>結束日期</label><input type="date" id="edit-end" value="${season.endDate}"></div>
        </div>
        <div class="field"><label>季度名稱</label><input type="text" id="edit-name" value="${escapeHtml(season.name)}"></div>
        <div class="field"><label>預計場次數</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-count" value="${season.estimatedSessionCount}"></div>
        <div class="field"><label>季打整季預收金額（每人）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-fee" value="${season.seasonPassFee}"></div>
        <div class="field">
          <label>預設人均冷氣費</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-ac-baseline" value="${season.acFeePerPersonBaseline ?? 45}">
          <div class="field-hint">正常整場都有開冷氣時，每人應負擔的冷氣費基準。季打結算時，若某場實際冷氣費（換算每人）低於這個基準，會自動退回差額；請假場次的退費本身已經包含冷氣費，不會再重複退。</div>
        </div>
        <div class="divider"></div>
        <div class="section-eyebrow">場次預設值</div>
        <div class="field-hint" style="margin-bottom:10px;">調整後會自動套用到本季「所有」場次；之後仍可到個別場次再單獨調整，只影響那一場。</div>
        ${sessionDefaultsFieldsHtml('edit-tpl', season)}
      `,
      onMount: (panel) => {
        bindSessionDefaultsFieldEvents(panel, 'edit-tpl');
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '儲存',
          primary: true,
          onClick: async (close, panel) => {
            const template = readSessionDefaultsFromPanel(panel, 'edit-tpl');
            const updated = {
              ...season,
              startDate: panel.querySelector('#edit-start').value,
              endDate: panel.querySelector('#edit-end').value,
              name: panel.querySelector('#edit-name').value.trim() || season.name,
              estimatedSessionCount: Number(panel.querySelector('#edit-count').value) || 0,
              seasonPassFee: Number(panel.querySelector('#edit-fee').value) || 0,
              acFeePerPersonBaseline: Number(panel.querySelector('#edit-ac-baseline').value) || 0,
              ...template,
            };
            await put('seasons', updated);
            Object.assign(season, updated);
            const updatedSessions = await applySeasonDefaultsToAllSessions(seasonId, template);
            sessions = sessions.map((s) => updatedSessions.find((u) => u.id === s.id) || s);
            close();
            await refreshTopbar();
            draw();
            toast('已更新季度設定，並同步套用到本季所有場次');
          },
        },
      ],
    });
  }

  draw();
}

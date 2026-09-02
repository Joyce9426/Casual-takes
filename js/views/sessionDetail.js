import { getById, getByIndex, getAll, put, remove, putMany, getSettings } from '../db.js';
import { API_BASE_URL } from '../config.js';
import { uid, toast, openModal, confirmDialog, escapeHtml, fmtDate, fmtDateCompact, fmtMoney, backButtonHtml, attachBackButton, parseNamesInput, resolveMembersByNames } from '../utils.js';
import { navigate } from '../router.js';
import { computeSessionStats, seasonPassFeeOf, buildSeasonPassPaidMap } from '../calc.js';
import { buildRosterFlexMessage, sendToLineRelay } from '../lineShare.js';
import { candidatePickerFieldHtml, bindCandidatePicker } from '../sessionShared.js';

export async function renderSessionDetail(root, seasonId, sessionId) {
  const season = await getById('seasons', seasonId);
  let session = await getById('sessions', sessionId);
  if (!season || !session) { navigate('/sessions'); return; }

  const settings = await getSettings();
  const members = await getAll('members');
  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));
  let rosters = await getByIndex('sessionRosters', 'sessionId', sessionId);
  let seasonPasses = await getByIndex('seasonPasses', 'seasonId', seasonId);

  let activeTab = 'roster';
  let selectedPayingIds = new Set(); // memberId set — covers 臨打 (casual) and unpaid 季打 rows (point 8)

  function draw() {
    const stats = computeSessionStats(session, rosters, buildSeasonPassPaidMap(seasonPasses));

    root.innerHTML = `
      <div class="page-head page-head-sticky flex-wrap-head">
        <div class="page-head-left">
          ${backButtonHtml()}
          <div style="min-width:0;">
            <h1 class="h1-nowrap">${fmtDateCompact(session.date)}</h1>
            <div class="sub">${session.timeSlot ? escapeHtml(session.timeSlot) : ''}</div>
          </div>
        </div>
        <div class="flex gap-8">
          <button class="icon-action-btn" id="send-line-btn" aria-label="發送到LINE"><img src="icons/icon-line-button.png" alt=""></button>
          <button class="icon-action-btn" id="edit-session-btn" aria-label="場次設定"><img src="icons/icon-settings-button.png" alt=""></button>
        </div>
      </div>

      <div class="scoreboard">
        <div class="scoreboard-label">本場次統計</div>
        <div class="scoreboard-grid">
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(stats.received)}</div><div class="cap">臨打已收</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(stats.receivable)}</div><div class="cap">臨打應收</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(stats.seasonPassIncome)}</div><div class="cap">季打已收</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(stats.expense)}</div><div class="cap">總支出</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(stats.receivedSurplus)}</div><div class="cap">已收盈餘</div></div>
          <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(stats.receivableSurplus)}</div><div class="cap">應收盈餘</div></div>
        </div>
      </div>

      <div class="subtabs">
        <button data-tab="roster" class="${activeTab === 'roster' ? 'active' : ''}">人員名單</button>
        <button data-tab="seasonpass" class="${activeTab === 'seasonpass' ? 'active' : ''}">季打管理</button>
      </div>

      <div id="tab-body"></div>
    `;

    attachBackButton(root);
    root.querySelector('#edit-session-btn').addEventListener('click', () => openEditSessionModal());
    root.querySelector('#send-line-btn').addEventListener('click', () => openSendToLineModal());
    root.querySelectorAll('.subtabs button').forEach((btn) => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; draw(); });
    });

    const tabBody = root.querySelector('#tab-body');
    if (activeTab === 'roster') drawRosterTab(tabBody, stats);
    else drawSeasonPassTab(tabBody);
  }

  // ---------------- 人員名單 tab ----------------
  function drawRosterTab(tabBody, stats) {
    // A season-pass member counts as attending (visible here) unless explicitly marked 請假.
    const leaveMemberIds = new Set(
      rosters.filter((r) => r.sourceType === 'seasonPass' && r.attendance === '請假').map((r) => r.memberId)
    );
    const seasonPassAttendingMemberIds = seasonPasses.map((sp) => sp.memberId).filter((id) => !leaveMemberIds.has(id));
    // Point 3: sort by join time (oldest first) — a batch add's rows get
    // distinct increasing createdAt offsets (see openAddPayingMemberModal),
    // so this also preserves input order within a single batch.
    const byCreatedAtAsc = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');
    const casualRows = rosters.filter((r) => r.sourceType === 'casual').sort(byCreatedAtAsc);
    const waitlistRows = rosters.filter((r) => r.sourceType === 'waitlist').sort(byCreatedAtAsc);

    const visibleRows = [
      ...seasonPassAttendingMemberIds.map((memberId) => ({
        sourceType: 'seasonPass',
        memberId,
        m: membersById[memberId],
        r: rosters.find((x) => x.memberId === memberId && x.sourceType === 'seasonPass'),
        sp: seasonPasses.find((x) => x.memberId === memberId),
      })),
      ...casualRows.map((r) => ({ ...r, m: membersById[r.memberId] })),
    ].filter((x) => x.m);
    const male = visibleRows.filter((x) => x.m.gender === '男');
    const female = visibleRows.filter((x) => x.m.gender === '女');
    const waitlist = waitlistRows.map((r) => ({ ...r, m: membersById[r.memberId] })).filter((x) => x.m);
    const methodEntries = Object.entries(stats.byMethod);

    const totalCount = stats.seasonPassAttendingCount + stats.casualCount + stats.waitlistCount;

    tabBody.innerHTML = `
      <div class="flex-between mt-8" style="margin-bottom:10px;align-items:center;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <input type="checkbox" id="select-all-roster">
          <span class="small text-soft">
            <div>季打 ${stats.seasonPassAttendingCount} 人・臨打 ${stats.casualCount} 人</div>
            <div>候補 ${stats.waitlistCount} 人・總共 ${totalCount} 人</div>
          </span>
        </label>
        <div class="flex gap-8">
          <button class="btn btn-sm" id="add-waitlist-btn">＋ 候補</button>
          <button class="btn btn-primary btn-sm" id="add-casual-btn">＋ 臨打</button>
        </div>
      </div>

      ${selectedPayingIds.size ? `
        <div class="batch-bar">
          已選取 <strong>${selectedPayingIds.size}</strong> 位
          <button class="btn btn-sm" id="batch-method-btn">繳費方式</button>
          <button class="btn btn-sm" id="batch-fee-btn">費用調整</button>
          <button class="btn btn-sm" id="clear-select-btn">取消</button>
        </div>
      ` : ''}

      <div class="card">
        <div class="table-scroll">
        <table class="roster roster-4col">
          <thead><tr>
            <th style="width:44px;"></th><th>姓名</th><th style="width:84px;">繳費方式</th><th style="width:38px;"></th>
          </tr></thead>
          <tbody>
            <tr><td colspan="4" class="roster-group-head roster-group-head-male">男（${male.length}）</td></tr>
            ${male.length ? male.map(rosterRow).join('') : blankRow()}
            <tr><td colspan="4" class="roster-group-head roster-group-head-female">女（${female.length}）</td></tr>
            ${female.length ? female.map(rosterRow).join('') : blankRow()}
          </tbody>
        </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">候補（${waitlist.length}）</div>
        <div class="table-scroll">
        <table class="roster roster-2col">
          <thead><tr>
            <th>姓名</th><th style="width:150px;"></th>
          </tr></thead>
          <tbody>
            ${waitlist.length ? waitlist.map(waitlistRow).join('') : blankWaitlistRow()}
          </tbody>
        </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">總計</div>
        ${methodEntries.length ? `
          <div class="stack">
            ${methodEntries.map(([k, v]) => `<div class="flex-between"><span>${escapeHtml(k)}</span><span class="mono">$${fmtMoney(v)}</span></div>`).join('')}
            <div class="flex-between" style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px;"><strong>合計已收</strong><strong class="mono">$${fmtMoney(stats.totalCollected)}</strong></div>
          </div>
        ` : '<div class="small text-faint">尚無已繳款項</div>'}
      </div>
    `;

    tabBody.querySelector('#add-casual-btn').addEventListener('click', () => openAddPayingMemberModal('casual'));
    tabBody.querySelector('#add-waitlist-btn').addEventListener('click', () => openAddPayingMemberModal('waitlist'));
    tabBody.querySelectorAll('[data-edit-fee]').forEach((el) => {
      el.addEventListener('click', () => openEditFeeModal(el.dataset.editFee));
    });
    tabBody.querySelectorAll('[data-toggle-seasonpass-paid]').forEach((el) => {
      el.addEventListener('click', async () => {
        const memberId = el.dataset.toggleSeasonpassPaid;
        const existing = rosters.find((x) => x.memberId === memberId && x.sourceType === 'seasonPass');
        const sp = seasonPasses.find((x) => x.memberId === memberId);
        const currentEffective = existing && existing.paidThisSession != null ? existing.paidThisSession : sp?.paymentStatus === '已繳';
        const next = !currentEffective;
        if (existing) {
          const updated = { ...existing, paidThisSession: next };
          await put('sessionRosters', updated);
          rosters = rosters.map((x) => (x.id === existing.id ? updated : x));
        } else {
          const created = {
            id: uid(), sessionId, memberId, sourceType: 'seasonPass', attendance: '出席',
            feeAmount: seasonPassFeeOf(session), paymentMethod: '', paidThisSession: next, createdAt: new Date().toISOString(),
          };
          await put('sessionRosters', created);
          rosters.push(created);
        }
        draw();
        toast(next ? '已標記為已預繳（僅本場）' : '已標記為未繳費（僅本場）');
      });
    });
    // Point 1: unpaid season-pass rows behave like 臨打 — clickable name to
    // edit this session's fee, and a payment-method select. Both may need to
    // create the season-pass roster row first if it doesn't already exist
    // (e.g. a member added mid-season without ever getting an explicit row).
    tabBody.querySelectorAll('[data-edit-seasonpass-fee]').forEach((el) => {
      el.addEventListener('click', async () => {
        const row = await ensureSeasonPassRosterRow(el.dataset.editSeasonpassFee);
        openEditFeeModal(row.id);
      });
    });
    tabBody.querySelectorAll('[data-method-seasonpass]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const row = await ensureSeasonPassRosterRow(sel.dataset.methodSeasonpass);
        const updated = { ...row, paymentMethod: sel.value };
        await put('sessionRosters', updated);
        rosters = rosters.map((x) => (x.id === row.id ? updated : x));
        draw();
      });
    });
    tabBody.querySelectorAll('[data-promote-waitlist]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = rosters.find((x) => x.id === btn.dataset.promoteWaitlist);
        const updated = { ...r, sourceType: 'casual' };
        await put('sessionRosters', updated);
        rosters = rosters.map((x) => (x.id === r.id ? updated : x));
        draw();
        toast('已將候補加入人員名單');
      });
    });
    tabBody.querySelectorAll('[data-select-paying]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedPayingIds.add(cb.dataset.selectPaying);
        else selectedPayingIds.delete(cb.dataset.selectPaying);
        draw();
      });
    });
    const selectAllRoster = tabBody.querySelector('#select-all-roster');
    if (selectAllRoster) {
      const selectableIds = [...tabBody.querySelectorAll('[data-select-paying]')].map((cb) => cb.dataset.selectPaying);
      selectAllRoster.checked = selectableIds.length > 0 && selectableIds.every((id) => selectedPayingIds.has(id));
      selectAllRoster.addEventListener('change', () => {
        if (selectAllRoster.checked) selectableIds.forEach((id) => selectedPayingIds.add(id));
        else selectableIds.forEach((id) => selectedPayingIds.delete(id));
        draw();
      });
    }
    const clearBtn = tabBody.querySelector('#clear-select-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => { selectedPayingIds.clear(); draw(); });
    const batchFeeBtn = tabBody.querySelector('#batch-fee-btn');
    if (batchFeeBtn) batchFeeBtn.addEventListener('click', () => openBatchFeeModal());
    const batchMethodBtn = tabBody.querySelector('#batch-method-btn');
    if (batchMethodBtn) batchMethodBtn.addEventListener('click', () => openBatchMethodModal());

    tabBody.querySelectorAll('[data-method]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const r = rosters.find((x) => x.id === sel.dataset.method);
        const updated = { ...r, paymentMethod: sel.value };
        await put('sessionRosters', updated);
        rosters = rosters.map((x) => (x.id === r.id ? updated : x));
        draw();
      });
    });
    tabBody.querySelectorAll('[data-remove-roster]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = rosters.find((x) => x.id === btn.dataset.removeRoster);
        const m = membersById[r.memberId];
        confirmDialog(`將「${escapeHtml(m.name)}」自本場次名單移除？`, async () => {
          await remove('sessionRosters', r.id);
          rosters = rosters.filter((x) => x.id !== r.id);
          selectedPayingIds.delete(r.id);
          draw();
        });
      });
    });
  }

  function blankRow() {
    return `<tr><td colspan="4" class="small text-faint" style="padding:8px;">尚無人員</td></tr>`;
  }

  function blankWaitlistRow() {
    return `<tr><td colspan="2" class="small text-faint" style="padding:8px;">尚無候補人員</td></tr>`;
  }

  function rosterRow(row) {
    const isSeasonPass = row.sourceType === 'seasonPass';
    const m = row.m;
    if (isSeasonPass) {
      const nameCellHtml = `${escapeHtml(m.name)}<span class="badge badge-blue">季打</span>`;
      // Point 8: if the season pass itself hasn't been paid, reflect that here too — this
      // can be overridden for THIS session only (paidThisSession), without touching the
      // season-level paymentStatus or any other session.
      const override = row.r && row.r.paidThisSession != null ? row.r.paidThisSession : null;
      const paidBySeasonLevelOrOverride = override != null ? override : row.sp?.paymentStatus === '已繳';

      if (paidBySeasonLevelOrOverride) {
        return `
          <tr>
            <td></td>
            <td class="roster-name">${nameCellHtml}</td>
            <td><span class="badge badge-gold" data-toggle-seasonpass-paid="${row.memberId}" style="cursor:pointer;">已預繳</span></td>
            <td></td>
          </tr>
        `;
      }
      // Point 8: batch-select is available to anyone EXCEPT a season-pass
      // member who's actually paid — everyone else (unpaid season-pass,
      // casual) gets a checkbox here.
      const hasPerSessionPayment = Boolean(row.r?.paymentMethod);
      return `
        <tr class="${hasPerSessionPayment ? '' : 'row-unpaid'}">
          <td><input type="checkbox" data-select-paying="${row.memberId}" ${selectedPayingIds.has(row.memberId) ? 'checked' : ''}></td>
          <td class="roster-name" data-edit-seasonpass-fee="${row.memberId}" style="cursor:pointer;">${nameCellHtml}</td>
          <td>
            <select class="inline-select" data-method-seasonpass="${row.memberId}">
              <option value="" ${!hasPerSessionPayment ? 'selected' : ''}>－</option>
              ${settings.paymentMethods.map((pm) => `<option value="${pm}" ${row.r?.paymentMethod === pm ? 'selected' : ''}>${pm}</option>`).join('')}
            </select>
          </td>
          <td></td>
        </tr>
      `;
    }
    const r = row;
    const nameCellHtml = `${escapeHtml(m.name)}<span class="badge badge-gray">臨打</span>`;
    const unpaid = !r.paymentMethod;
    return `
      <tr class="${unpaid ? 'row-unpaid' : ''}">
        <td><input type="checkbox" data-select-paying="${r.memberId}" ${selectedPayingIds.has(r.memberId) ? 'checked' : ''}></td>
        <td class="roster-name" data-edit-fee="${r.id}" style="cursor:pointer;">${nameCellHtml}</td>
        <td>
          <select class="inline-select" data-method="${r.id}">
            <option value="" ${!r.paymentMethod ? 'selected' : ''}>－</option>
            ${settings.paymentMethods.map((pm) => `<option value="${pm}" ${r.paymentMethod === pm ? 'selected' : ''}>${pm}</option>`).join('')}
          </select>
        </td>
        <td><button class="icon-btn" data-remove-roster="${r.id}" aria-label="移除">✕</button></td>

      </tr>
    `;
  }

  // Point 11: waitlist rows have no payment method — just name (click to edit fee) and a
  // button that promotes them straight into the correct gender section of the roster above.
  function waitlistRow(row) {
    const r = row;
    const m = row.m;
    return `
      <tr>
        <td class="roster-name" data-edit-fee="${r.id}" style="cursor:pointer;">${escapeHtml(m.name)}<span class="gender-tag">${m.gender}</span></td>
        <td class="text-right">
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:nowrap;white-space:nowrap;">
            <button class="btn btn-sm btn-primary" data-promote-waitlist="${r.id}">加入名單</button>
            <button class="icon-btn" data-remove-roster="${r.id}" aria-label="移除">✕</button>
          </div>
        </td>
      </tr>
    `;
  }

  // Points 1/2: fee is no longer shown inline in the table — click the name to edit it here.
  // Batch fee adjustment (via the batch bar) is untouched and still edits rosters directly.
  // Point 1: returns this member's existing season-pass roster row for this
  // session, creating a default one first if it doesn't exist yet (so the
  // edit-fee / payment-method UI always has a real row to work with).
  async function ensureSeasonPassRosterRow(memberId) {
    const existing = rosters.find((x) => x.memberId === memberId && x.sourceType === 'seasonPass');
    if (existing) return existing;
    const created = {
      // Point 2: default this session's fee to the season-pass rate already
      // configured for this session, so the admin doesn't have to type it in
      // by hand every time — they can still adjust it via the edit-fee modal.
      id: uid(), sessionId, memberId, sourceType: 'seasonPass', attendance: '出席',
      feeAmount: seasonPassFeeOf(session), paymentMethod: '', createdAt: new Date().toISOString(),
    };
    await put('sessionRosters', created);
    rosters.push(created);
    return created;
  }

  function openEditFeeModal(rosterId) {
    const r = rosters.find((x) => x.id === rosterId);
    if (!r) return;
    const m = membersById[r.memberId];
    // Point 2: if this is a season-pass row that's never had a fee explicitly
    // set (still 0, e.g. created before this default existed), pre-fill with
    // this session's configured season-pass rate instead of a bare 0.
    const defaultFee = (r.sourceType === 'seasonPass' && !r.feeAmount) ? seasonPassFeeOf(session) : r.feeAmount;
    openModal({
      title: `編輯費用・${escapeHtml(m?.name || '')}`,
      bodyHtml: `<div class="field"><label>本場次費用</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-fee-input" value="${defaultFee}"></div>`,
      onMount: (panel) => panel.querySelector('#edit-fee-input').focus(),
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '儲存',
          primary: true,
          onClick: async (close, panel) => {
            const updated = { ...r, feeAmount: Number(panel.querySelector('#edit-fee-input').value) || 0 };
            await put('sessionRosters', updated);
            rosters = rosters.map((x) => (x.id === r.id ? updated : x));
            close();
            draw();
            toast('已更新費用');
          },
        },
      ],
    });
  }

  // Point 7: excludes this season's season-pass members and anyone already on this session's
  // roster; includes a live search filter. Point 10: identical fields/flow for 候補 (waitlist).
  function openAddPayingMemberModal(sourceType) {
    const seasonPassMemberIds = new Set(seasonPasses.map((sp) => sp.memberId));
    const alreadyOnRosterIds = new Set(rosters.map((r) => r.memberId));
    // Point 2: the multi-select list only shows 常用 (favorite) members — keeps
    // the picker short and fast for the people actually shown up regularly.
    const candidates = members
      .filter((m) => m.isFavorite && !seasonPassMemberIds.has(m.id) && !alreadyOnRosterIds.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

    const title = sourceType === 'waitlist' ? '加入候補' : '加入臨打';
    const selectedMemberIds = new Set();

    const modal = openModal({
      title,
      bodyHtml: `
        ${candidatePickerFieldHtml('paying-candidate', '選擇常用人員（可複選，此季的季打成員與本場次已有的人員不會出現）')}
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
        <div class="field"><label>本場次費用</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="paying-fee" value="${session.baseFeePerPerson}"></div>
      `,
      onMount: (panel) => {
        bindCandidatePicker(panel, 'paying-candidate', candidates, selectedMemberIds, escapeHtml);
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
            const fee = Number(panel.querySelector('#paying-fee').value) || 0;
            const memberIds = [...selectedMemberIds];

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
            if (memberIds.length === 0) { toast('請選擇或新增至少一位人員'); return; }

            // Point 3: stamp each row's createdAt with a distinct, increasing
            // offset (not all identical) so a batch add preserves the exact
            // input order when the roster is later sorted by join time —
            // Date.now() alone can tie within the same millisecond for a
            // fast synchronous batch.
            const baseTs = Date.now();
            const newRosters = memberIds.map((memberId, idx) => ({
              id: uid(),
              sessionId,
              memberId,
              sourceType,
              attendance: '出席',
              feeAmount: fee,
              paymentMethod: '',
              createdAt: new Date(baseTs + idx).toISOString(),
            }));
            await putMany('sessionRosters', newRosters);
            rosters.push(...newRosters);
            close();
            draw();
            const label = sourceType === 'waitlist' ? '候補' : '臨打';
            toast(newRosters.length > 1 ? `已加入 ${newRosters.length} 位${label}` : `已加入${label}`);
          },
        },
      ],
    });
  }

  async function resolveSelectedRosterRows() {
    // Point 8: selectedPayingIds now holds memberId (covers both 臨打 and
    // unpaid 季打), not roster row id — an unpaid season-pass member might
    // not have a roster row yet, so create one on demand.
    const result = [];
    for (const memberId of selectedPayingIds) {
      let row = rosters.find((r) => r.memberId === memberId && (r.sourceType === 'casual' || r.sourceType === 'seasonPass'));
      if (!row) row = await ensureSeasonPassRosterRow(memberId);
      result.push(row);
    }
    return result;
  }

  function openBatchFeeModal() {
    openModal({
      title: `批量調整費用（${selectedPayingIds.size} 位）`,
      bodyHtml: `
        <div class="field">
          <label>調整方式</label>
          <div class="radio-group" id="mode-group">
            <label class="radio-chip checked"><input type="radio" name="mode" value="set" checked>設為固定金額</label>
            <label class="radio-chip"><input type="radio" name="mode" value="delta">整體調整（±）</label>
          </div>
        </div>
        <div class="field"><label>金額</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="batch-fee-value" value="0"></div>
      `,
      onMount: (panel) => {
        panel.querySelectorAll('#mode-group .radio-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            panel.querySelectorAll('#mode-group .radio-chip').forEach((c) => c.classList.remove('checked'));
            chip.classList.add('checked');
          });
        });
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '套用',
          primary: true,
          onClick: async (close, panel) => {
            const mode = panel.querySelector('input[name=mode]:checked').value;
            const value = Number(panel.querySelector('#batch-fee-value').value) || 0;
            const targetRows = await resolveSelectedRosterRows();
            const updates = targetRows.map((r) => ({ ...r, feeAmount: mode === 'set' ? value : Math.max(0, (Number(r.feeAmount) || 0) + value) }));
            await putMany('sessionRosters', updates);
            rosters = rosters.map((r) => updates.find((u) => u.id === r.id) || r);
            const newRowIds = new Set(rosters.map((r) => r.id));
            updates.forEach((u) => { if (!newRowIds.has(u.id)) rosters.push(u); });
            selectedPayingIds.clear();
            close();
            draw();
            toast('已批量調整費用');
          },
        },
      ],
    });
  }

  function openBatchMethodModal() {
    openModal({
      title: `批量設定繳費方式（${selectedPayingIds.size} 位）`,
      bodyHtml: `
        <div class="field">
          <label>繳費方式</label>
          <select id="batch-method" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            <option value="">－（設為未繳）</option>
            ${settings.paymentMethods.map((m) => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </div>
      `,
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '套用',
          primary: true,
          onClick: async (close, panel) => {
            const method = panel.querySelector('#batch-method').value;
            const targetRows = await resolveSelectedRosterRows();
            const updates = targetRows.map((r) => ({ ...r, paymentMethod: method }));
            await putMany('sessionRosters', updates);
            const existingIds = new Set(rosters.map((r) => r.id));
            rosters = rosters.map((r) => updates.find((u) => u.id === r.id) || r);
            updates.forEach((u) => { if (!existingIds.has(u.id)) rosters.push(u); });
            selectedPayingIds.clear();
            close();
            draw();
            toast('已批量設定繳費方式');
          },
        },
      ],
    });
  }

  // ---------------- 季打管理 tab ----------------
  // Only two states — 出席 (default) / 請假 — grouped by gender.
  function drawSeasonPassTab(tabBody) {
    const rows = seasonPasses
      .map((sp) => ({ sp, member: membersById[sp.memberId], roster: rosters.find((r) => r.memberId === sp.memberId && r.sourceType === 'seasonPass') }))
      .filter((x) => x.member)
      .sort((a, b) => a.member.name.localeCompare(b.member.name, 'zh-Hant'));
    const male = rows.filter((x) => x.member.gender === '男');
    const female = rows.filter((x) => x.member.gender === '女');

    tabBody.innerHTML = `
      <div class="small text-soft mt-8" style="margin-bottom:10px;">預設為出席。設定「請假」會從人員名單移除，並在季度結算時視為當場退費。</div>
      ${rows.length === 0 ? `
        <div class="empty-state"><div class="glyph">◍</div><p>本季尚未設定季打名單</p></div>
      ` : `<div class="card"><div class="table-scroll"><table class="roster">
            <thead><tr><th colspan="2" class="roster-group-head-male">男（${male.length}）</th></tr></thead>
            <tbody>${male.length ? male.map(seasonPassRow).join('') : blankSpRow()}</tbody>
            <thead><tr><th colspan="2" class="roster-group-head-female">女（${female.length}）</th></tr></thead>
            <tbody>${female.length ? female.map(seasonPassRow).join('') : blankSpRow()}</tbody>
          </table></div></div>`}
    `;

    tabBody.querySelectorAll('[data-sp-attendance]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const memberId = sel.dataset.spAttendance;
        const value = sel.value;
        const existing = rosters.find((r) => r.memberId === memberId && r.sourceType === 'seasonPass');
        if (existing) {
          // Point (bugfix): switching to 請假 clears any per-session payment
          // method already recorded — a 請假 session's fee is fully refunded
          // through the leave mechanism, so a leftover paymentMethod value
          // would otherwise get double-counted into 依付款方式加總 even
          // though this person didn't actually attend.
          const updated = { ...existing, attendance: value, ...(value === '請假' ? { paymentMethod: '' } : {}) };
          await put('sessionRosters', updated);
          rosters = rosters.map((r) => (r.id === existing.id ? updated : r));
        } else {
          const created = {
            id: uid(), sessionId, memberId, sourceType: 'seasonPass',
            attendance: value, feeAmount: seasonPassFeeOf(session), paymentMethod: '', createdAt: new Date().toISOString(),
          };
          await put('sessionRosters', created);
          rosters.push(created);
        }
        draw();
      });
    });
  }

  function blankSpRow() {
    return `<tr><td colspan="2" class="small text-faint" style="padding:8px;">尚無人員</td></tr>`;
  }

  function seasonPassRow({ sp, member, roster }) {
    const state = roster ? roster.attendance : '出席';
    return `
      <tr>
        <td class="roster-name">${escapeHtml(member.name)}</td>
        <td>
          <select class="inline-select" data-sp-attendance="${sp.memberId}">
            <option value="出席" ${state === '出席' ? 'selected' : ''}>出席</option>
            <option value="請假" ${state === '請假' ? 'selected' : ''}>請假</option>
          </select>
        </td>
      </tr>
    `;
  }

  function openEditSessionModal() {
    openModal({
      title: '場次設定',
      bodyHtml: `
        <div class="field-row">
          <div class="field"><label>日期</label><input type="date" id="e-date" value="${session.date}"></div>
          <div class="field"><label>時段</label><input type="text" id="e-time" value="${escapeHtml(session.timeSlot || '')}"></div>
        </div>
        <div class="field"><label>場地</label><input type="text" id="e-venue" value="${escapeHtml(session.venue || '')}"></div>
        <div class="field">
          <label>冷氣使用狀態</label>
          <div class="radio-group" id="e-ac-group">
            ${['未使用', '使用', '部分使用'].map((v) => `<label class="radio-chip ${session.acUsed === v ? 'checked' : ''}"><input type="radio" name="e-ac" value="${v}" ${session.acUsed === v ? 'checked' : ''}>${v}</label>`).join('')}
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>場地費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="e-venue-cost" value="${session.venueCost}"></div>
          <div class="field"><label>冷氣費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="e-ac-cost" value="${session.acCost}" ${session.acUsed === '未使用' ? 'disabled' : ''}></div>
        </div>
        <div class="field-row">
          <div class="field"><label>其他支出</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="e-other-cost" value="${session.otherCost}"></div>
          <div class="field"><label>臨打預設收費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="e-base-fee" value="${session.baseFeePerPerson}"></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>季打預設收費</label>
            <input type="text" inputmode="numeric" pattern="[0-9]*" id="e-seasonpass-fee" value="${seasonPassFeeOf(session)}">
          </div>
          <div class="field">
            <label>人數</label>
            <input type="text" inputmode="numeric" pattern="[0-9]*" id="e-divisor" value="${session.seasonPassDivisor ?? 18}">
          </div>
        </div>
        <div class="field-hint" style="margin-top:-6px;">只影響這一場。</div>
      `,
      onMount: (panel) => {
        panel.querySelectorAll('#e-ac-group .radio-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            panel.querySelectorAll('#e-ac-group .radio-chip').forEach((c) => c.classList.remove('checked'));
            chip.classList.add('checked');
            const val = chip.querySelector('input').value;
            const acCostInput = panel.querySelector('#e-ac-cost');
            acCostInput.disabled = val === '未使用';
            if (val === '未使用') acCostInput.value = 0;
          });
        });
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '儲存',
          primary: true,
          onClick: async (close, panel) => {
            const acUsed = panel.querySelector('input[name=e-ac]:checked').value;
            const updated = {
              ...session,
              date: panel.querySelector('#e-date').value,
              timeSlot: panel.querySelector('#e-time').value.trim(),
              venue: panel.querySelector('#e-venue').value.trim(),
              acUsed,
              venueCost: Number(panel.querySelector('#e-venue-cost').value) || 0,
              acCost: acUsed === '未使用' ? 0 : (Number(panel.querySelector('#e-ac-cost').value) || 0),
              otherCost: Number(panel.querySelector('#e-other-cost').value) || 0,
              baseFeePerPerson: Number(panel.querySelector('#e-base-fee').value) || 0,
              seasonPassFeePerSession: Number(panel.querySelector('#e-seasonpass-fee').value) || 0,
              seasonPassDivisor: Number(panel.querySelector('#e-divisor').value) || 18,
            };
            await put('sessions', updated);
            session = updated;
            close();
            draw();
            toast('已更新場次設定');
          },
        },
      ],
    });
  }

  // ---------------- 發送到LINE ----------------
  function openSendToLineModal() {
    if (!settings.lineTargets || settings.lineTargets.length === 0) {
      openModal({
        title: '尚未設定LINE發送',
        bodyHtml: `<p class="small text-soft">請先到「設定」頁面至少新增一個常用聊天室，才能發送場次名單到LINE。</p>`,
        actions: [
          { label: '取消', onClick: (close) => close() },
          { label: '前往設定', primary: true, onClick: (close) => { close(); navigate('/settings'); } },
        ],
      });
      return;
    }

    openModal({
      title: '發送場次名單到LINE',
      bodyHtml: `
        <div class="field">
          <label>選擇聊天室</label>
          <select id="line-target-select" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            ${settings.lineTargets.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <p class="small text-faint">將會發送本場次（${fmtDate(session.date)}）目前的人員名單、繳費狀況與統計金額。</p>
      `,
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: '送出',
          primary: true,
          onClick: async (close, panel) => {
            const targetId = panel.querySelector('#line-target-select').value;
            const target = settings.lineTargets.find((t) => t.id === targetId);
            if (!target) { toast('找不到選擇的聊天室'); return; }
            try {
              const message = buildRosterFlexMessage(season, session, rosters, seasonPasses, membersById);
              await sendToLineRelay({
                relayUrl: API_BASE_URL,
                apiKey: settings.lineRelayApiKey,
                groupId: target.groupId,
                messages: [message],
              });
              close();
              toast(`已發送到「${target.name}」`);
            } catch (err) {
              toast(err.message || '發送失敗');
            }
          },
        },
      ],
    });
  }

  draw();
}

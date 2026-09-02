import { getAll, getById, getByIndex, put, putMany } from './db.js';
import {
  uid, toast, openModal, escapeHtml, fmtDate, fmtMoney, todayStr, isSessionUpcoming, toDateStr,
} from './utils.js';
import { computeSessionStats, buildSeasonPassPaidMap } from './calc.js';
import { SESSION_DEFAULTS } from './constants.js';

// Renders the "進行中" (upcoming/today) + "已結束" (past) two-section session list.
// sessions: sessions to show (already scoped to whichever season(s) the caller wants)
// rostersBySessionId: fn(sessionId) => roster rows for that session
// seasonPasses: this season's SeasonPass rows, so per-session stats can tell which
// season-pass members are actually prepaid (vs. paying per-session instead).
export function sessionSectionsHtml(sessions, rostersBySessionId, seasonPasses = []) {
  const today = todayStr();
  const seasonPassPaidMap = buildSeasonPassPaidMap(seasonPasses);
  const upcoming = sessions.filter((s) => isSessionUpcoming(s, today)).sort((a, b) => a.date.localeCompare(b.date));
  const past = sessions.filter((s) => !isSessionUpcoming(s, today)).sort((a, b) => b.date.localeCompare(a.date));

  function row(s) {
    const stats = computeSessionStats(s, rostersBySessionId(s.id), seasonPassPaidMap);
    const acLabel = { '未使用': '無冷氣', '使用': '有冷氣', '部分使用': '部分冷氣' }[s.acUsed] || '';
    return `
      <div class="list-row" data-open-session="${s.id}" style="cursor:pointer;">
        <div class="list-row-main">
          <div class="list-row-title">${fmtDate(s.date)} ${s.timeSlot ? `・${escapeHtml(s.timeSlot)}` : ''}</div>
          <div class="list-row-meta">季打${stats.seasonPassAttendingCount}人 ・ 臨打${stats.casualCount}人 ・ ${acLabel}</div>
          <div class="list-row-meta">已收 $${fmtMoney(stats.received)} / 盈餘 $${fmtMoney(stats.receivedSurplus)}</div>
        </div>
        <div class="list-row-actions">
          <button class="icon-btn" data-delete-session="${s.id}" aria-label="刪除">✕</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="section-eyebrow">進行中</div>
    ${upcoming.length ? `<div class="card">${upcoming.map(row).join('')}</div>` : `<div class="card small text-faint">目前沒有即將到來的場次</div>`}
    <div class="section-eyebrow mt-16">已結束</div>
    ${past.length ? `<div class="card card-muted">${past.map(row).join('')}</div>` : `<div class="card small text-faint">尚無已結束的場次</div>`}
  `;
}

// Opens the "新增場次" modal.
// options.ongoingSeasons: list of ongoing seasons to choose from (only ongoing seasons are offered)
// options.defaultSeasonId: which season should be pre-selected
// options.showSeasonSelect: whether to render the season dropdown (top-level Sessions nav) or
//   hide it and just use defaultSeasonId (season detail's 場次管理 tab)
// options.onCreated(session): called after the session + auto-added season-pass rosters are persisted
export function openAddSessionModal({ ongoingSeasons, defaultSeasonId, showSeasonSelect, lastSession, onCreated }) {
  openModal({
    title: '新增場次',
    bodyHtml: `
      ${showSeasonSelect ? `
        <div class="field">
          <label>季度</label>
          <select id="sess-season" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            ${ongoingSeasons.map((s) => `<option value="${s.id}" ${s.id === defaultSeasonId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
          <div class="field-hint">只會列出目前進行中的季度。</div>
        </div>
      ` : ''}
      <div class="field-row">
        <div class="field"><label>日期</label><input type="date" id="sess-date" value="${lastSession ? addWeek(lastSession.date) : todayStr()}"></div>
        <div class="field"><label>時段</label><input type="text" id="sess-time" value="${lastSession ? escapeHtml(lastSession.timeSlot || '') : SESSION_DEFAULTS.timeSlot}"></div>
      </div>
      <div class="field"><label>場地</label><input type="text" id="sess-venue" value="${lastSession ? escapeHtml(lastSession.venue || '') : SESSION_DEFAULTS.venue}"></div>
      <div class="field">
        <label>冷氣使用狀態</label>
        <div class="radio-group" id="ac-group">
          ${['未使用', '使用', '部分使用'].map((v) => {
            const checked = (lastSession ? lastSession.acUsed : SESSION_DEFAULTS.acUsed) === v;
            return `<label class="radio-chip ${checked ? 'checked' : ''}"><input type="radio" name="ac" value="${v}" ${checked ? 'checked' : ''}>${v}</label>`;
          }).join('')}
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>場地費（支出）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="sess-venue-cost" value="${lastSession ? lastSession.venueCost : SESSION_DEFAULTS.venueCost}"></div>
        <div class="field"><label>冷氣費（支出）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="sess-ac-cost" value="${lastSession ? lastSession.acCost : SESSION_DEFAULTS.acCost}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>其他支出（選填）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="sess-other-cost" value="${lastSession ? lastSession.otherCost : SESSION_DEFAULTS.otherCost}"></div>
        <div class="field"><label>臨打預設收費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="sess-base-fee" value="${lastSession ? lastSession.baseFeePerPerson : SESSION_DEFAULTS.baseFeePerPerson}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>季打預設收費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="sess-seasonpass-fee" value="${lastSession ? (lastSession.seasonPassFeePerSession ?? SESSION_DEFAULTS.seasonPassFeePerSession) : SESSION_DEFAULTS.seasonPassFeePerSession}"></div>
        <div class="field"><label>人數</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="sess-divisor" value="${lastSession ? (lastSession.seasonPassDivisor ?? SESSION_DEFAULTS.seasonPassDivisor) : SESSION_DEFAULTS.seasonPassDivisor}"></div>
      </div>
    `,
    onMount: (panel) => {
      panel.querySelectorAll('#ac-group .radio-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          panel.querySelectorAll('#ac-group .radio-chip').forEach((c) => c.classList.remove('checked'));
          chip.classList.add('checked');
          const val = chip.querySelector('input').value;
          const acCostInput = panel.querySelector('#sess-ac-cost');
          acCostInput.disabled = val === '未使用';
          if (val === '未使用') acCostInput.value = 0;
        });
      });
    },
    actions: [
      { label: '取消', onClick: (close) => close() },
      {
        label: '新增',
        primary: true,
        onClick: async (close, panel) => {
          const date = panel.querySelector('#sess-date').value;
          if (!date) { toast('請選擇日期'); return; }
          const seasonId = showSeasonSelect ? panel.querySelector('#sess-season').value : defaultSeasonId;
          if (!seasonId) { toast('請選擇季度'); return; }
          const acUsed = panel.querySelector('input[name=ac]:checked').value;
          const session = {
            id: uid(),
            seasonId,
            date,
            timeSlot: panel.querySelector('#sess-time').value.trim(),
            venue: panel.querySelector('#sess-venue').value.trim(),
            acUsed,
            venueCost: Number(panel.querySelector('#sess-venue-cost').value) || 0,
            acCost: acUsed === '未使用' ? 0 : (Number(panel.querySelector('#sess-ac-cost').value) || 0),
            otherCost: Number(panel.querySelector('#sess-other-cost').value) || 0,
            baseFeePerPerson: Number(panel.querySelector('#sess-base-fee').value) || 0,
            seasonPassFeePerSession: Number(panel.querySelector('#sess-seasonpass-fee').value) || 0,
            seasonPassDivisor: Number(panel.querySelector('#sess-divisor').value) || 18,
            status: '未開始',
            createdAt: new Date().toISOString(),
          };
          await put('sessions', session);

          const seasonPasses = await getByIndex('seasonPasses', 'seasonId', seasonId);
          const rosterRows = seasonPasses.map((sp) => ({
            id: uid(),
            sessionId: session.id,
            memberId: sp.memberId,
            sourceType: 'seasonPass',
            attendance: '出席',
            feeAmount: 0,
            paymentMethod: '',
            createdAt: new Date().toISOString(),
          }));
          if (rosterRows.length) await putMany('sessionRosters', rosterRows);

          close();
          toast('已新增場次，並帶入目前季打名單（預設出席）');
          onCreated(session, rosterRows);
        },
      },
    ],
  });
}

function addWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  return toDateStr(d);
}

// ---------------- Season-level session-defaults template (point 6) ----------------
// Seasons carry the same set of fields as an individual session (time slot, venue, AC,
// costs, fees). These seed newly auto-generated sessions, and — whenever edited later —
// get pushed out to overwrite every existing session in that season. Sessions can still be
// tweaked individually afterward; that only affects that one session, not the others.
export function sessionDefaultsFieldsHtml(idPrefix, values) {
  const v = { ...SESSION_DEFAULTS, ...values };
  return `
    <div class="field-row">
      <div class="field"><label>時段</label><input type="text" id="${idPrefix}-time" value="${escapeHtml(v.timeSlot || '')}"></div>
      <div class="field"><label>場地</label><input type="text" id="${idPrefix}-venue" value="${escapeHtml(v.venue || '')}"></div>
    </div>
    <div class="field">
      <label>冷氣使用狀態</label>
      <div class="radio-group" id="${idPrefix}-ac-group">
        ${['未使用', '使用', '部分使用'].map((opt) => {
          const checked = v.acUsed === opt;
          return `<label class="radio-chip ${checked ? 'checked' : ''}"><input type="radio" name="${idPrefix}-ac" value="${opt}" ${checked ? 'checked' : ''}>${opt}</label>`;
        }).join('')}
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>場地費（支出）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="${idPrefix}-venue-cost" value="${v.venueCost}"></div>
      <div class="field"><label>冷氣費（支出）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="${idPrefix}-ac-cost" value="${v.acCost}" ${v.acUsed === '未使用' ? 'disabled' : ''}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>其他支出（選填）</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="${idPrefix}-other-cost" value="${v.otherCost}"></div>
      <div class="field"><label>臨打預設收費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="${idPrefix}-base-fee" value="${v.baseFeePerPerson}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>季打預設收費</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="${idPrefix}-seasonpass-fee" value="${v.seasonPassFeePerSession}"></div>
      <div class="field"><label>人數</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="${idPrefix}-divisor" value="${v.seasonPassDivisor}"></div>
    </div>
  `;
}

export function bindSessionDefaultsFieldEvents(panel, idPrefix) {
  panel.querySelectorAll(`#${idPrefix}-ac-group .radio-chip`).forEach((chip) => {
    chip.addEventListener('click', () => {
      panel.querySelectorAll(`#${idPrefix}-ac-group .radio-chip`).forEach((c) => c.classList.remove('checked'));
      chip.classList.add('checked');
      const val = chip.querySelector('input').value;
      const acCostInput = panel.querySelector(`#${idPrefix}-ac-cost`);
      acCostInput.disabled = val === '未使用';
      if (val === '未使用') acCostInput.value = 0;
    });
  });
}

export function readSessionDefaultsFromPanel(panel, idPrefix) {
  const acUsed = panel.querySelector(`input[name=${idPrefix}-ac]:checked`).value;
  return {
    timeSlot: panel.querySelector(`#${idPrefix}-time`).value.trim(),
    venue: panel.querySelector(`#${idPrefix}-venue`).value.trim(),
    acUsed,
    venueCost: Number(panel.querySelector(`#${idPrefix}-venue-cost`).value) || 0,
    acCost: acUsed === '未使用' ? 0 : (Number(panel.querySelector(`#${idPrefix}-ac-cost`).value) || 0),
    otherCost: Number(panel.querySelector(`#${idPrefix}-other-cost`).value) || 0,
    baseFeePerPerson: Number(panel.querySelector(`#${idPrefix}-base-fee`).value) || 0,
    seasonPassFeePerSession: Number(panel.querySelector(`#${idPrefix}-seasonpass-fee`).value) || 0,
    seasonPassDivisor: Number(panel.querySelector(`#${idPrefix}-divisor`).value) || 18,
  };
}

// Pushes the season's current template defaults out to every session already belonging to
// it (called whenever the season's default fields are saved/edited). Returns the updated
// session records so the caller can refresh its in-memory list.
export async function applySeasonDefaultsToAllSessions(seasonId, defaults) {
  const seasonSessions = await getByIndex('sessions', 'seasonId', seasonId);
  const updated = seasonSessions.map((s) => ({ ...s, ...defaults }));
  if (updated.length) await putMany('sessions', updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Shared searchable, multi-select candidate picker — used everywhere a modal
// needs to let the admin pick one or more existing members (加入臨打/候補 in
// session detail, 加入季打 in season detail). A 2-column CSS grid keeps every
// row the same width regardless of name length, so checkboxes and names stay
// aligned instead of drifting based on content — and both are left-aligned
// within their cell (not pushed to the right).
// ---------------------------------------------------------------------------
export function candidatePickerFieldHtml(idPrefix, label) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="text" id="${idPrefix}-search" placeholder="輸入姓名搜尋…">
      <div id="${idPrefix}-list" class="candidate-grid-wrap"></div>
    </div>
  `;
}

// `candidates`: array of {id, name, gender}. `selectedIds`: a Set the caller
// owns — mutated in place as checkboxes are (un)checked, and preserved across
// search filtering so narrowing/clearing the search never loses a selection.
export function bindCandidatePicker(panel, idPrefix, candidates, selectedIds, escapeHtmlFn) {
  const listEl = panel.querySelector(`#${idPrefix}-list`);
  const searchEl = panel.querySelector(`#${idPrefix}-search`);

  function renderList(query) {
    const filtered = query ? candidates.filter((m) => m.name.includes(query)) : candidates;
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="small text-faint" style="padding:8px;">${candidates.length === 0 ? '沒有可選擇的人員' : '找不到符合的人員'}</div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="candidate-grid">
        ${filtered.map((m) => `
          <label class="candidate-grid-item">
            <input type="checkbox" class="candidate-checkbox" value="${m.id}" ${selectedIds.has(m.id) ? 'checked' : ''}>
            <span>${escapeHtmlFn(m.name)}<span class="gender-tag">${m.gender}</span></span>
          </label>
        `).join('')}
      </div>
    `;
    listEl.querySelectorAll('.candidate-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.value);
        else selectedIds.delete(cb.value);
      });
    });
  }

  renderList('');
  searchEl.addEventListener('input', () => renderList(searchEl.value.trim()));
}

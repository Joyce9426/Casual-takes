import { getAll, put, putMany, remove, getByIndex, removeMany } from '../db.js';
import {
  uid, toast, openModal, confirmDialog, escapeHtml, fmtDateOnly, suggestSeasonName,
  countWeekdaysBetween, listWeekdaysBetween, todayStr, addDays, isSeasonOngoing, EDIT_ICON_SVG,
} from '../utils.js';
import { navigate } from '../router.js';
import { refreshTopbar } from '../topbar.js';
import { SESSION_DEFAULTS } from '../constants.js';
import { sessionDefaultsFieldsHtml, bindSessionDefaultsFieldEvents, readSessionDefaultsFromPanel, applySeasonDefaultsToAllSessions } from '../sessionShared.js';

export async function renderSeasonsList(root) {
  let seasons = await getAll('seasons');
  const allSessions = await getAll('sessions');
  const allPasses = await getAll('seasonPasses');

  function countsFor(seasonId) {
    return {
      sessions: allSessions.filter((s) => s.seasonId === seasonId).length,
      passes: allPasses.filter((p) => p.seasonId === seasonId).length,
    };
  }

  function draw() {
    const today = todayStr();
    const ongoing = seasons.filter((s) => isSeasonOngoing(s, today)).sort((a, b) => b.startDate.localeCompare(a.startDate));
    const completed = seasons.filter((s) => !isSeasonOngoing(s, today)).sort((a, b) => b.endDate.localeCompare(a.endDate));

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>季度管理</h1>
          <!--<div class="sub">以三個月為一季，管理場次與季打名單</div> -->
        </div>
        <button class="btn btn-primary" id="add-season-btn">＋ 新增季度</button>
      </div>

      ${seasons.length === 0 ? `
        <div class="empty-state">
          <div class="glyph"><svg width="32" height="32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 -15 110.0 110.0">
 <path d="m53.125 43.75c0 1.7188 1.4062 3.125 3.125 3.125h37.344c-1.5312-21.625-18.844-38.938-40.469-40.469z"/>
 <path d="m56.25 53.125c-5.1562 0-9.375-4.2188-9.375-9.375v-37.344c-22.656 1.625-40.625 20.531-40.625 43.594s19.625 43.75 43.75 43.75 41.969-17.969 43.594-40.625z"/></svg></div>
          <p>還沒有任何季度</p>
          <p>建立第一季，開始管理你的場次吧</p>
        </div>
      ` : `
        <div class="section-eyebrow">進行中</div>
        ${ongoing.length ? `<div class="card">${ongoing.map((s) => seasonRow(s, false)).join('')}</div>` : `<div class="card small text-faint">目前沒有進行中的季度</div>`}

        <div class="section-eyebrow mt-16">已結束</div>
        ${completed.length ? `<div class="card card-muted">${completed.map((s) => seasonRow(s, true)).join('')}</div>` : `<div class="card small text-faint">尚無已結束的季度</div>`}
      `}
    `;

    root.querySelector('#add-season-btn').addEventListener('click', () => openSeasonModal());
    root.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/seasons/${el.dataset.open}`));
    });
    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = seasons.find((x) => x.id === btn.dataset.edit);
        openSeasonModal(s);
      });
    });
    root.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = seasons.find((x) => x.id === btn.dataset.delete);
        const c = countsFor(s.id);
        confirmDialog(
          `確定要刪除「${escapeHtml(s.name)}」嗎？此季共有 ${c.sessions} 個場次、${c.passes} 位季打，將一併刪除且無法復原。`,
          async () => {
            const sessions = allSessions.filter((x) => x.seasonId === s.id);
            for (const sess of sessions) {
              const rosters = await getByIndex('sessionRosters', 'sessionId', sess.id);
              await removeMany('sessionRosters', rosters.map((r) => r.id));
            }
            await removeMany('sessions', sessions.map((x) => x.id));
            const passes = allPasses.filter((x) => x.seasonId === s.id);
            await removeMany('seasonPasses', passes.map((x) => x.id));
            await remove('seasons', s.id);
            seasons = seasons.filter((x) => x.id !== s.id);
            draw();
            await refreshTopbar();
            toast('已刪除季度');
          }
        );
      });
    });
  }

  function seasonRow(s, isCompleted) {
    const c = countsFor(s.id);
    return `
      <div class="list-row" data-open="${s.id}" style="cursor:pointer;">
        <div class="list-row-main">
          <div class="list-row-title">${escapeHtml(s.name)}</div>
          <div class="list-row-meta">${fmtDateOnly(s.startDate)} － ${fmtDateOnly(s.endDate)}</div>
          <div class="list-row-meta">場次 ${c.sessions}　・　季打 ${c.passes} 人</div>
        </div>
        <div class="list-row-actions">
          <button class="icon-btn" data-edit="${s.id}" aria-label="編輯">${EDIT_ICON_SVG}</button>
          <button class="icon-btn" data-delete="${s.id}" aria-label="刪除">✕</button>
        </div>
      </div>
    `;
  }

  function openSeasonModal(existing) {
    const isEdit = !!existing;
    const defaultStart = todayStr();
    const defaultEnd = addDays(defaultStart, 89);

    openModal({
      title: isEdit ? '編輯季度' : '新增季度',
      bodyHtml: `
        <div class="field-row">
          <div class="field">
            <label>起始日期</label>
            <input type="date" id="s-start" value="${isEdit ? existing.startDate : defaultStart}">
          </div>
          <div class="field">
            <label>結束日期</label>
            <input type="date" id="s-end" value="${isEdit ? existing.endDate : defaultEnd}">
          </div>
        </div>
        <div class="field">
          <label>季度名稱</label>
          <input type="text" id="s-name" value="${isEdit ? escapeHtml(existing.name) : suggestSeasonName(defaultStart)}">
        </div>
        ${!isEdit ? `
        <div class="field">
          <label>自動產生場次的星期</label>
          <select id="s-weekday" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;">
            <option value="">不指定（不自動產生場次）</option>
            <option value="0">星期日</option>
            <option value="1">星期一</option>
            <option value="2">星期二</option>
            <option value="3">星期三</option>
            <option value="4">星期四</option>
            <option value="5">星期五</option>
            <option value="6">星期六</option>
          </select>
          <div class="field-hint">選擇星期幾之後，建立季度時會自動在起訖日期內產生每週該天的場次；不指定則不會自動建立任何場次。</div>
        </div>
        ` : ''}
        <div class="field">
          <label>預計場次數${isEdit ? '' : '（依所選星期自動推算，可手動調整）'}</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="s-count" value="${isEdit ? existing.estimatedSessionCount : 0}">
        </div>
        <div class="field">
          <label>季打整季預收金額（每人）</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="s-fee" value="${isEdit ? existing.seasonPassFee : ''}" placeholder="例：1300">
          <div class="field-hint">新增季打人員時，會直接帶入這個金額作為預收金額。</div>
        </div>
        <div class="field">
          <label>預設人均冷氣費</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" id="s-ac-baseline" value="${isEdit ? (existing.acFeePerPersonBaseline ?? 45) : 45}">
          <div class="field-hint">正常整場都有開冷氣時，每人應負擔的冷氣費基準。季打結算時，若某場實際冷氣費（換算每人）低於這個基準，會自動退回差額；請假場次的退費本身已經包含冷氣費，不會再重複退。</div>
        </div>
        <div class="divider"></div>
        <div class="section-eyebrow">場次預設值</div>
        <div class="field-hint" style="margin-bottom:10px;">${isEdit ? '調整後會自動套用到本季「所有」場次；之後仍可到個別場次再單獨調整，只影響那一場。' : '如果上面有選擇星期，建立後會自動依起訖日期產生每週該天的場次，並套用以下預設值。'}</div>
        ${sessionDefaultsFieldsHtml('s-tpl', isEdit ? existing : SESSION_DEFAULTS)}
      `,
      onMount: (panel) => {
        bindSessionDefaultsFieldEvents(panel, 's-tpl');
        const startEl = panel.querySelector('#s-start');
        const endEl = panel.querySelector('#s-end');
        const nameEl = panel.querySelector('#s-name');
        const countEl = panel.querySelector('#s-count');
        const weekdayEl = panel.querySelector('#s-weekday');
        let nameTouched = isEdit;
        let countTouched = isEdit;
        nameEl.addEventListener('input', () => { nameTouched = true; });
        countEl.addEventListener('input', () => { countTouched = true; });
        function recalc() {
          if (!nameTouched) nameEl.value = suggestSeasonName(startEl.value);
          if (!countTouched) countEl.value = countWeekdaysBetween(startEl.value, endEl.value, weekdayEl ? weekdayEl.value : '');
        }
        startEl.addEventListener('change', recalc);
        endEl.addEventListener('change', recalc);
        if (weekdayEl) weekdayEl.addEventListener('change', recalc);
      },
      actions: [
        { label: '取消', onClick: (close) => close() },
        {
          label: isEdit ? '儲存' : '新增',
          primary: true,
          onClick: async (close, panel) => {
            const startDate = panel.querySelector('#s-start').value;
            const endDate = panel.querySelector('#s-end').value;
            const name = panel.querySelector('#s-name').value.trim();
            const estimatedSessionCount = Number(panel.querySelector('#s-count').value) || 0;
            const seasonPassFee = Number(panel.querySelector('#s-fee').value) || 0;
            const acFeePerPersonBaseline = Number(panel.querySelector('#s-ac-baseline').value) || 0;
            const template = readSessionDefaultsFromPanel(panel, 's-tpl');
            const weekdayEl = panel.querySelector('#s-weekday');
            const weekday = weekdayEl ? weekdayEl.value : '';
            if (!name || !startDate || !endDate) { toast('請完整填寫季度資訊'); return; }
            const obj = existing
              ? { ...existing, name, startDate, endDate, estimatedSessionCount, seasonPassFee, acFeePerPersonBaseline, ...template }
              : { id: uid(), name, startDate, endDate, estimatedSessionCount, seasonPassFee, acFeePerPersonBaseline, ...template, createdAt: new Date().toISOString() };
            await put('seasons', obj);

            let generatedCount = 0;
            if (!isEdit) {
              const weekdayDates = listWeekdaysBetween(startDate, endDate, weekday);
              generatedCount = weekdayDates.length;
              const newSessions = weekdayDates.map((date) => ({
                id: uid(),
                seasonId: obj.id,
                date,
                ...template,
                status: '未開始',
                createdAt: new Date().toISOString(),
              }));
              if (newSessions.length) await putMany('sessions', newSessions);
            } else {
              await applySeasonDefaultsToAllSessions(obj.id, template);
            }

            close();
            await refreshTopbar();
            if (isEdit) {
              seasons = seasons.map((x) => (x.id === obj.id ? obj : x));
              draw();
              toast('已更新季度，並同步套用到本季所有場次');
            } else {
              toast(generatedCount > 0 ? `已建立季度，並自動產生 ${generatedCount} 個場次` : '已建立季度（未指定星期，尚未自動產生任何場次）');
              navigate(`/seasons/${obj.id}`);
            }
          },
        },
      ],
    });
  }

  draw();
}

import { getAll, getByIndex, getSettings, getById } from '../db.js';
import { fmtDate, fmtDateOnly, fmtMoney, escapeHtml, todayStr } from '../utils.js';
import { navigate } from '../router.js';
import { computeSessionStats, buildSeasonPassPaidMap } from '../calc.js';

export async function renderDashboard(root) {
  const seasons = await getAll('seasons');
  if (seasons.length === 0) {
    root.innerHTML = `
      <div class="page-head"><h1 style="font-size:1.2rem;">總覽</h1></div>
      <div class="empty-state">
        <div class="glyph"><img src="icons/icon.svg" alt="" width="56" height="56" style="border-radius:14px;"></div>
        <p>歡迎使用隨手場記m</p>
        <p>先建立第一個季度，開始管理你的週日場次吧</p>
      </div>
      <button class="btn btn-primary btn-block" id="go-seasons">前往季度管理</button>
    `;
    root.querySelector('#go-seasons').addEventListener('click', () => navigate('/seasons'));
    return;
  }

  const settings = await getSettings();
  const season = (settings.activeSeasonId && await getById('seasons', settings.activeSeasonId))
    || seasons.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

  const sessions = (await getByIndex('sessions', 'seasonId', season.id)).sort((a, b) => a.date.localeCompare(b.date));
  const seasonPasses = await getByIndex('seasonPasses', 'seasonId', season.id);

  let allRosters = [];
  for (const s of sessions) {
    const r = await getByIndex('sessionRosters', 'sessionId', s.id);
    allRosters.push(...r);
  }
  const sessionStatsById = {};
  const seasonPassPaidMap = buildSeasonPassPaidMap(seasonPasses);
  sessions.forEach((s) => { sessionStatsById[s.id] = computeSessionStats(s, allRosters.filter((r) => r.sessionId === s.id), seasonPassPaidMap); });

  const today = todayStr();
  const upcoming = sessions.filter((s) => s.date >= today).slice(0, 3);
  // 本季速覽只算已經結束的場次(date < today),不是整季排定的場次。
  // 當前總額 = 已結束場次的臨打已收 + 季打已收(seasonPassIncome 本來就只算
  // 出席、排除請假的季打，見 calc.js computeSessionStats)。
  const expiredSessions = sessions.filter((s) => s.date < today);
  const currentTotal = expiredSessions.reduce((sum, s) => {
    const st = sessionStatsById[s.id];
    return sum + (st ? st.received + st.seasonPassIncome : 0);
  }, 0);
  const currentExpense = expiredSessions.reduce((sum, s) => sum + ((sessionStatsById[s.id] && sessionStatsById[s.id].expense) || 0), 0);
  const currentSurplus = currentTotal - currentExpense;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${escapeHtml(season.name)}</h1>
        <div class="sub">${fmtDateOnly(season.startDate)} － ${fmtDateOnly(season.endDate)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" id="go-season-detail">查看季度</button>
    </div>

    <div class="scoreboard">
      <div class="scoreboard-label">本季速覽</div>
      <div class="scoreboard-grid scoreboard-grid-left2-right1">
        <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(currentTotal)}</div><div class="cap">當前總額</div></div>
        <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(currentSurplus)}</div><div class="cap">當前盈餘</div></div>
        <div class="scoreboard-cell"><div class="num mono">$${fmtMoney(currentExpense)}</div><div class="cap">當前支出</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">最近場次</div>
      ${upcoming.length ? upcoming.map((s) => {
        const st = sessionStatsById[s.id];
        return `<div class="list-row" data-open-session="${s.id}" style="cursor:pointer;">
          <div class="list-row-main">
            <div class="list-row-title">${fmtDate(s.date)}${s.timeSlot ? `・${escapeHtml(s.timeSlot)}` : ''}</div>
            <div class="list-row-meta">出席 ${st.attendeeCount} 人・已收 $${fmtMoney(st.received)} / 應收 $${fmtMoney(st.receivable)}</div>
          </div>
        </div>`;
      }).join('') : '<div class="small text-faint">本季近期沒有安排場次</div>'}
    </div>

  `;

  root.querySelector('#go-season-detail').addEventListener('click', () => navigate(`/seasons/${season.id}`));
  root.querySelectorAll('[data-open-session]').forEach((el) => {
    el.addEventListener('click', () => navigate(`/sessions/${el.dataset.openSession}`));
  });
}

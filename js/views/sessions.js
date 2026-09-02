import { getAll, getById, getByIndex, getSettings, remove } from '../db.js';
import { confirmDialog, fmtDate, isSeasonOngoing } from '../utils.js';
import { navigate } from '../router.js';
import { sessionSectionsHtml, openAddSessionModal } from '../sessionShared.js';

export async function renderSessionsList(root) {
  const seasons = await getAll('seasons');
  if (seasons.length === 0) {
    root.innerHTML = `
      <div class="page-head"><h1 style="font-size:1.2rem;">場次</h1></div>
      <div class="empty-state">
        <div class="glyph"><svg width="32" height="32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 -15 110.0 110.0">
 <path d="m53.125 43.75c0 1.7188 1.4062 3.125 3.125 3.125h37.344c-1.5312-21.625-18.844-38.938-40.469-40.469z"/>
 <path d="m56.25 53.125c-5.1562 0-9.375-4.2188-9.375-9.375v-37.344c-22.656 1.625-40.625 20.531-40.625 43.594s19.625 43.75 43.75 43.75 41.969-17.969 43.594-40.625z"/></svg></div>
        <p>還沒有任何季度</p>
        <p>先建立一個季度，才能開始安排場次</p>
      </div>
      <button class="btn btn-primary btn-block" id="go-seasons">前往季度管理</button>
    `;
    root.querySelector('#go-seasons').addEventListener('click', () => navigate('/seasons'));
    return;
  }

  const settings = await getSettings();
  let season = (settings.activeSeasonId && await getById('seasons', settings.activeSeasonId))
    || seasons.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

  let sessions = (await getByIndex('sessions', 'seasonId', season.id)).sort((a, b) => a.date.localeCompare(b.date));
  const seasonPasses = await getByIndex('seasonPasses', 'seasonId', season.id);
  let allRosters = [];
  for (const s of sessions) {
    allRosters.push(...(await getByIndex('sessionRosters', 'sessionId', s.id)));
  }

  function rostersFor(sessionId) { return allRosters.filter((r) => r.sessionId === sessionId); }

  function draw() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>場次</h1>
          <div class="sub">${season.name}　・　共 ${sessions.length} 場</div>
        </div>
        <button class="btn btn-primary btn-sm" id="add-session-btn">＋ 新增場次</button>
      </div>

      ${sessionSectionsHtml(sessions, rostersFor, seasonPasses)}
    `;

    root.querySelector('#add-session-btn').addEventListener('click', () => openAdd());
    root.querySelectorAll('[data-open-session]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/sessions/${el.dataset.openSession}`));
    });
    root.querySelectorAll('[data-delete-session]').forEach((btn) => {
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

  function openAdd() {
    const ongoingSeasons = seasons.filter((s) => isSeasonOngoing(s));
    if (ongoingSeasons.length === 0) {
      confirmDialog('目前沒有進行中的季度，無法新增場次。要先去建立一個季度嗎？', () => navigate('/seasons'), { confirmLabel: '前往季度管理', danger: false });
      return;
    }
    const lastSession = sessions[sessions.length - 1];
    openAddSessionModal({
      ongoingSeasons,
      defaultSeasonId: ongoingSeasons.some((s) => s.id === season.id) ? season.id : ongoingSeasons[0].id,
      showSeasonSelect: true,
      lastSession,
      onCreated: async (session, rosterRows) => {
        if (session.seasonId === season.id) {
          sessions.push(session);
          sessions.sort((a, b) => a.date.localeCompare(b.date));
          allRosters.push(...rosterRows);
        }
        draw();
      },
    });
  }

  draw();
}

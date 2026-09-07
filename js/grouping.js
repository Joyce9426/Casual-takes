// ---------- 分組 / 對戰表 純邏輯（無 DOM 依賴） ----------
// 分組本身（誰在哪一組）由管理員手動指定，這裡只負責「小組確定之後」系統
// 該自動處理的部分：小組合併成 6 人隊、排出出場次數平均的多輪對戰表。
import { uid } from './utils.js';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 組別編號用英文字母（A、B...Z、AA、AB...），idx 從 0 開始。
export function groupLabel(idx) {
  let n = idx + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

// 給一開始還沒有任何分組時，預設要開幾組空組別用（人數 ÷ 組大小，無條件進位）。
export function suggestGroupCount(totalCount, groupSize) {
  if (totalCount <= 0) return 1;
  return Math.max(1, Math.ceil(totalCount / groupSize));
}

// 「隨機快速分配」輔助按鈕用：把未分組的人隨機洗牌後，依序輪流塞進目前還沒
// 滿（未達 groupSize）的組別，讓管理員從一個大致分好的狀態開始微調，而不是
// 從空白開始一個個點。塞不進去（所有組別都滿了）的人維持未分組，不會硬塞。
export function shuffleFill(unassignedMemberIds, groups, groupSize) {
  const shuffled = shuffle(unassignedMemberIds);
  const result = groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
  let idx = 0;
  while (idx < shuffled.length) {
    let placedAny = false;
    for (const g of result) {
      if (idx >= shuffled.length) break;
      if (g.memberIds.length < groupSize) {
        g.memberIds.push(shuffled[idx]);
        idx++;
        placedAny = true;
      }
    }
    if (!placedAny) break;
  }
  return result;
}

// 把管理員排定的小組，依建立順序合併成 6 人一隊：
// groupSize=6 → 每組本身就是一隊；groupSize=3 → 每 2 組併一隊；
// groupSize=2 → 每 3 組併一隊。併不滿 6 人的最後一批小組（含空組別會被略過）
// 回傳在 incompleteTeamGroupIds，不進入對戰表。
export function buildTeams(groups, groupSize) {
  const groupsPerTeam = groupSize === 6 ? 1 : groupSize === 3 ? 2 : 3;
  const nonEmpty = groups.filter((g) => g.memberIds.length > 0);
  const teams = [];
  const incompleteTeamGroupIds = [];
  for (let i = 0; i < nonEmpty.length; i += groupsPerTeam) {
    const chunk = nonEmpty.slice(i, i + groupsPerTeam);
    const memberIds = chunk.flatMap((g) => g.memberIds);
    if (chunk.length === groupsPerTeam && memberIds.length === 6) {
      teams.push({ id: uid(), memberIds, groupIds: chunk.map((g) => g.id) });
    } else {
      incompleteTeamGroupIds.push(...chunk.map((g) => g.id));
    }
  }
  return { teams, incompleteTeamGroupIds };
}

// 隊伍數 n 在「不指定輪數」時的預設輪數：偶數隊每輪都上場（共 N-1
// 輪即可讓每隊都對戰過彼此一次）；奇數隊每輪輪空 1 隊（共 N 輪，每隊恰好
// 輪空 1 次）。
export function naturalRoundsCount(n) {
  if (n < 2) return 0;
  return n % 2 === 0 ? n - 1 : n;
}

// 排出指定輪數的對戰表：每輪從目前「累計出場數最少」的隊伍裡選出可以上場
// 的名額（隊伍數為奇數時每輪固定 1 隊輪空），沒被選中的自然變成輪空。這個
// 貪心作法（每次都優先讓出場數落後的人上場）保證跑完指定輪數之後，每支
// 隊伍的出場次數差距不會超過 1——輪數剛好等於 naturalRoundsCount() 時，
// 效果等同於傳統單循環賽（每隊對戰過彼此一次）。
export function buildRoundRobinSchedule(teamIds, roundsCount) {
  const n = teamIds.length;
  if (n < 2) return { rounds: [] };
  const totalRounds = Math.max(1, roundsCount ?? naturalRoundsCount(n));
  const playPerRound = n - (n % 2); // 隊伍數為奇數時，每輪固定空出 1 個名額
  const appearances = Object.fromEntries(teamIds.map((id) => [id, 0]));
  const rounds = [];
  for (let r = 0; r < totalRounds; r++) {
    // 先洗牌製造隨機性，再依累計出場數由少到多排序（次數相同的人靠洗牌
    // 決定順序）——出場數最少的一批人優先上場，其餘的自然變成輪空。
    const ordered = shuffle(teamIds).sort((a, b) => appearances[a] - appearances[b]);
    const playing = shuffle(ordered.slice(0, playPerRound));
    const byeTeamIds = ordered.slice(playPerRound);
    const matches = [];
    for (let i = 0; i < playing.length; i += 2) {
      matches.push({ teamAId: playing[i], teamBId: playing[i + 1] });
    }
    matches.forEach((m) => { appearances[m.teamAId] += 1; appearances[m.teamBId] += 1; });
    rounds.push({ matches, byeTeamIds });
  }
  return { rounds };
}

// 對戰表產生後，統計每個人整場下來的出場次數——正常情況下應該全部相同，或
// 頂多只差 1（奇數隊伍時，輪空那一輪不算出場）。給 UI 當肉眼驗證公平用。
export function computeAppearanceCounts(teams, rounds) {
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const counts = {};
  teams.forEach((t) => t.memberIds.forEach((id) => { counts[id] = 0; }));
  rounds.forEach((round) => {
    round.matches.forEach((m) => {
      [m.teamAId, m.teamBId].forEach((tid) => {
        const team = teamsById[tid];
        if (!team) return;
        team.memberIds.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      });
    });
  });
  return counts;
}

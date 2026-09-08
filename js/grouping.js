// ---------- 分組 / 對戰表 純邏輯（無 DOM 依賴） ----------
// 分組本身（誰在哪一組）由管理員手動指定，這裡只負責「小組確定之後」系統
// 該自動處理的部分：小組合併成 6 人隊、排出出場次數平均、輪休也公平輪流
// 的多輪對戰表。

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

function groupsPerTeamOf(groupSize) {
  return groupSize === 6 ? 1 : groupSize === 3 ? 2 : 3;
}

// 分析目前的小組，算出「每輪最多可以同時排幾場比賽」「每輪會有幾組輪休」，
// 給畫面上的即時提示用。只有人數剛好等於 groupSize 的小組（「已滿」的組）
// 才會參與排賽——人數不足的小組沒辦法湊出完整的 6 人隊，永遠不會被排進
// 對戰表（跟「輪休」是兩回事：輪休是滿組的小組排隊等下一輪，人數不足的
// 小組則是完全排不進去，直到補滿人數為止）。
export function planMatches(groups, groupSize) {
  const groupsPerTeam = groupsPerTeamOf(groupSize);
  const matchGroupSize = groupsPerTeam * 2; // 一場比賽（兩隊）需要幾組
  const completeGroups = groups.filter((g) => g.memberIds.length === groupSize);
  const incompleteGroupIds = groups
    .filter((g) => g.memberIds.length > 0 && g.memberIds.length !== groupSize)
    .map((g) => g.id);
  const matchesPerRound = Math.floor(completeGroups.length / matchGroupSize);
  const playGroupsCount = matchesPerRound * matchGroupSize;
  return {
    groupsPerTeam,
    matchGroupSize,
    completeGroups,
    incompleteGroupIds,
    matchesPerRound,
    restGroupsCount: completeGroups.length - playGroupsCount,
  };
}

// 「不指定輪數」時的預設輪數：用完整小組數 n 當一個完整循環——n 輪之後，
// 每一組被排休息的次數會完全一樣多（見 buildGroupRoundSchedule 的說明）。
export function naturalRoundsCount(n) {
  return Math.max(1, n);
}

// 排出指定輪數的對戰表，直接在「小組」層級運作（不是先固定分隊再排賽）：
// 把目前所有滿組的小組排成一個環，每一輪都把這個環往前轉一格再從頭數，
// 前面湊得出完整比賽的小組出場比賽，剩下的自然輪休。
//
// 例：15 人、3 人一組，共 5 組 a~e，每隊需要 2 組（groupsPerTeam=2）：
//   第 1 輪：環＝[a,b,c,d,e] → a+b 對 c+d，e 輪休
//   第 2 輪：環轉 1 格＝[b,c,d,e,a] → b+c 對 d+e，a 輪休
//   第 3 輪：環轉 2 格＝[c,d,e,a,b] → c+d 對 e+a，b 輪休
// 因為每一組在 n 輪之內會轉過每一個位置恰好一次，跑完 n 輪（naturalRoundsCount）
// 之後，每一組被排到「輪休」位置的次數完全相同，天生公平；輪數比 n 少或多
// 都只是這個循環的一部分或重複幾次，一樣公平。
export function buildGroupRoundSchedule(groups, groupSize, roundsCount) {
  const { groupsPerTeam, matchGroupSize, completeGroups, matchesPerRound } = planMatches(groups, groupSize);
  const n = completeGroups.length;
  if (matchesPerRound < 1) return { rounds: [] };
  const totalRounds = Math.max(1, roundsCount ?? naturalRoundsCount(n));
  const playGroupsCount = matchesPerRound * matchGroupSize;
  const rounds = [];
  for (let r = 0; r < totalRounds; r++) {
    const offset = r % n;
    const rotated = Array.from({ length: n }, (_, i) => completeGroups[(offset + i) % n]);
    const playing = rotated.slice(0, playGroupsCount);
    const restGroups = rotated.slice(playGroupsCount);
    const matches = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const base = m * matchGroupSize;
      const teamAGroups = playing.slice(base, base + groupsPerTeam);
      const teamBGroups = playing.slice(base + groupsPerTeam, base + matchGroupSize);
      matches.push({
        teamA: { groupIds: teamAGroups.map((g) => g.id), memberIds: teamAGroups.flatMap((g) => g.memberIds) },
        teamB: { groupIds: teamBGroups.map((g) => g.id), memberIds: teamBGroups.flatMap((g) => g.memberIds) },
        scoreA: null,
        scoreB: null,
      });
    }
    rounds.push({ matches, restGroupIds: restGroups.map((g) => g.id) });
  }
  return { rounds };
}

// 排賽前把小組順序洗牌一次（不影響小組本身的字母編號，只影響排賽時「環」
// 的起始排列），讓「重新排列」按鈕可以排出不一樣的對戰組合。
export function shuffleGroupsOrder(groups) {
  return shuffle(groups);
}

// 對戰表產生後，統計每個人整場下來的出場次數——正常情況下應該全部相同，或
// 頂多只差 1。給 UI 當肉眼驗證公平用。
export function computeAppearanceCounts(rounds) {
  const counts = {};
  rounds.forEach((round) => {
    round.matches.forEach((m) => {
      [m.teamA, m.teamB].forEach((team) => {
        team.memberIds.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      });
    });
  });
  return counts;
}

// 依管理員填入的每場比分，加總出每個「小組」整場下來的總得分——一場比賽
// 的分數，會算給組成那一隊的每一個小組（同一個小組不同輪次可能跟不同的
// 小組併隊，但小組本身的身分是穩定的，所以用小組來累計，不是用臨時併出
// 來的隊伍）。沒填分數的比賽不計入。
export function computeGroupScores(rounds) {
  const totals = {};
  rounds.forEach((round) => {
    round.matches.forEach((m) => {
      if (typeof m.scoreA === 'number') {
        m.teamA.groupIds.forEach((gid) => { totals[gid] = (totals[gid] || 0) + m.scoreA; });
      }
      if (typeof m.scoreB === 'number') {
        m.teamB.groupIds.forEach((gid) => { totals[gid] = (totals[gid] || 0) + m.scoreB; });
      }
    });
  });
  return totals;
}

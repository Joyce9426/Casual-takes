// ---------- Core business calculations ----------
// All money values are treated as plain numbers (TWD, no decimals expected but not enforced).

const DEFAULT_SEASON_PASS_FEE = 230;

// Each session has its own manually-set "season-pass default fee" — this is the flat amount
// every attending season-pass member owes for THAT session (replaces the old cost-sharing
// formula). Lives on the session so it can be adjusted per occurrence.
export function seasonPassFeeOf(session) {
  const v = Number(session?.seasonPassFeePerSession);
  return Number.isFinite(v) ? v : DEFAULT_SEASON_PASS_FEE;
}

// The season-level baseline for "what a full session of AC should cost each
// season-pass member" — used to work out how much to refund when a specific
// session's actual AC cost came in under that baseline (AC not used, or only
// partially used). Lives on the season (not the session) since it represents
// the normal/expected rate, not any one occurrence's actual cost.
//
// Deliberately defaults to 0 (no AC refund calculated at all) rather than the
// UI's pre-filled 45 — a season saved before this feature existed has no
// opinion on this baseline, and silently assuming 45 would retroactively
// change settlement numbers for seasons already in progress or finished. The
// baseline only takes effect once a season is actually saved with a value
// (new seasons default to 45 in the form; existing ones start at 0 until
// someone visits 季度設定 and sets it).
export function acFeeBaselineOf(season) {
  const v = Number(season?.acFeePerPersonBaseline);
  return Number.isFinite(v) ? v : 0;
}

// Round a per-person cost share up to the nearest multiple of 5 (44 -> 45, 48 -> 50, 45 -> 45).
export function roundUpToNearest5(x) {
  return Math.ceil(x / 5) * 5;
}

export function sessionTotalExpense(session) {
  return (Number(session.venueCost) || 0) + (Number(session.acCost) || 0) + (Number(session.otherCost) || 0);
}

// A casual (臨打) / waitlist (候補) roster row counts as paid once a payment method has been
// set — "－" means unpaid.
export function isRosterPaid(row) {
  return Boolean(row.paymentMethod);
}

// Builds a { memberId: true } lookup of season passes that are actually paid
// at the season level — used by computeSessionStats to tell "this member's
// flat season-pass fee is already covered by their prepayment" apart from
// "this member never prepaid, so only counts if they paid THIS session".
export function buildSeasonPassPaidMap(seasonPasses) {
  const map = {};
  seasonPasses.forEach((sp) => { if (sp.paymentStatus === '已繳') map[sp.memberId] = true; });
  return map;
}

// F8 — session-level stats. rosters = all SessionRoster rows for this session.
// Season-pass members are treated as attending (出席) by default — only an explicit 請假
// row excludes them. Their flat per-session fee counts as "season-pass income" for this
// session's stats, and folds into both surplus figures.
// Waitlist (候補) rows are financially identical to casual (臨打) rows — same fee/payment
// handling — they're just grouped separately in the UI.
// seasonPassPaidByMemberId: from buildSeasonPassPaidMap() — tells us which season-pass
// members actually prepaid the season fee (vs. relying on a per-session payment instead).
export function computeSessionStats(session, rosters, seasonPassPaidByMemberId = {}) {
  const casualRows = rosters.filter((r) => r.sourceType === 'casual');
  const waitlistRows = rosters.filter((r) => r.sourceType === 'waitlist');
  const seasonPassLeave = rosters.filter((r) => r.sourceType === 'seasonPass' && r.attendance === '請假');
  const seasonPassRows = rosters.filter((r) => r.sourceType === 'seasonPass');
  const seasonPassAttendingRows = seasonPassRows.filter((r) => r.attendance !== '請假');
  const seasonPassAttendingCount = seasonPassAttendingRows.length;
  // A season-pass member who hasn't prepaid the season fee can instead pay for
  // just this one session — recorded exactly like a casual payment (a fee
  // amount + a payment method on their roster row). These rows are still
  // "season pass" for attendance/roster-grouping purposes, but their money
  // needs to show up in this session's payment totals same as 臨打 does.
  const seasonPassPerSessionPaidRows = seasonPassRows.filter((r) => r.paymentMethod && r.attendance !== '請假');

  // Point 9: 候補 (waitlist) money is excluded from all financial stats — only 臨打 (casual) counts.
  const receivable = casualRows.reduce((sum, r) => sum + (Number(r.feeAmount) || 0), 0);
  const received = casualRows.filter(isRosterPaid).reduce((sum, r) => sum + (Number(r.feeAmount) || 0), 0);
  const expense = sessionTotalExpense(session);
  const seasonPassFee = seasonPassFeeOf(session);
  // Point 5: 季打已收 only counts a member if they're actually paid — either
  // their season pass is prepaid (flat rate), or (for those who never
  // prepaid) they specifically paid for THIS session. An attending-but-
  // unpaid season-pass member contributes $0 here, not the flat rate.
  const seasonPassIncome = seasonPassAttendingRows.reduce((sum, r) => {
    if (seasonPassPaidByMemberId[r.memberId]) return sum + seasonPassFee;
    if (r.paymentMethod) return sum + (Number(r.feeAmount) || 0);
    return sum;
  }, 0);

  const byMethod = {};
  casualRows.filter(isRosterPaid).forEach((r) => {
    const key = r.paymentMethod;
    byMethod[key] = (byMethod[key] || 0) + (Number(r.feeAmount) || 0);
  });
  seasonPassPerSessionPaidRows.forEach((r) => {
    const key = r.paymentMethod;
    byMethod[key] = (byMethod[key] || 0) + (Number(r.feeAmount) || 0);
  });
  const totalCollected = Object.values(byMethod).reduce((sum, v) => sum + v, 0);

  return {
    receivable,
    received,
    expense,
    seasonPassIncome,
    receivableSurplus: receivable + seasonPassIncome - expense,
    receivedSurplus: received + seasonPassIncome - expense,
    byMethod,
    totalCollected,
    attendeeCount: seasonPassAttendingCount + casualRows.length,
    seasonPassAttendingCount,
    seasonPassLeaveCount: seasonPassLeave.length,
    casualCount: casualRows.length,
    waitlistCount: waitlistRows.length,
  };
}

// Point (季打名單 tab "總計" card): counts ONLY actual season-level prepayments
// (paymentStatus === '已繳'), by payment method. Deliberately separate from
// computeSeasonStats' broader byMethod, which also folds in casual/per-session
// money — this card is specifically "how much season-pass prepayment have we
// collected", so a member who never prepaid but paid for one session ad-hoc
// must NOT show up here at all.
export function computeSeasonPassPrepaidByMethod(seasonPasses) {
  const byMethod = {};
  let total = 0;
  seasonPasses.forEach((sp) => {
    if (sp.paymentStatus !== '已繳') return;
    const prepaid = Number(sp.prepaidAmount) || 0;
    const key = sp.paymentMethod || '未指定';
    byMethod[key] = (byMethod[key] || 0) + prepaid;
    total += prepaid;
  });
  return { byMethod, total };
}

// F9 — season pass settlement for one member across every session in the season.
// Season-pass members default to 出席 (attending) for every session — a session with no
// SessionRoster row at all for this member is treated exactly like an explicit 出席 row.
// Only an explicit 請假 row reduces what they owe for that session (due = 0).
// rosterRowsBySessionId: { [sessionId]: SessionRoster row } — only rows for THIS member.
// season is optional for backward compatibility (older call sites that don't
// pass it simply get acRefund=0 everywhere, same as before this feature existed).
export function computeSeasonPassSettlement(seasonPass, sessions, rosterRowsBySessionId, season) {
  const acBaseline = acFeeBaselineOf(season);
  const rows = sessions.map((session) => {
    const roster = rosterRowsBySessionId[session.id];
    const attendance = roster ? roster.attendance : '出席';
    const fee = seasonPassFeeOf(session);
    // AC adjustment only applies to sessions actually attended — a 請假
    // session's due is already 0 (the whole flat fee, AC portion included,
    // is refunded through the leave mechanism), so adjusting AC again there
    // would double count it.
    let acActualPerPerson = null;
    let acRefund = 0;
    let acExtraCharge = 0;
    let acUsage = null; // 'none' | 'partial' | 'over' | 'even' — only set when attended and a baseline exists
    if (attendance !== '請假' && acBaseline > 0) {
      const divisor = session.seasonPassDivisor > 0 ? session.seasonPassDivisor : 18;
      acActualPerPerson = roundUpToNearest5((Number(session.acCost) || 0) / divisor);
      const acDiff = acBaseline - acActualPerPerson; // positive => refund owed, negative => extra owed
      if (acDiff > 0) {
        acRefund = acDiff;
        acUsage = acActualPerPerson === 0 ? 'none' : 'partial';
      } else if (acDiff < 0) {
        acExtraCharge = -acDiff;
        acUsage = 'over';
      } else {
        acUsage = 'even';
      }
    }
    // acRefund reduces what's due; acExtraCharge (AC cost came in ABOVE the
    // baseline) adds to it — both fold into the same settlement diff so the
    // overall refund/makeup total stays correct either way.
    const due = attendance === '請假' ? 0 : Math.max(0, fee - acRefund + acExtraCharge);
    return { sessionId: session.id, date: session.date, attendance, fee, acActualPerPerson, acRefund, acExtraCharge, acUsage, due };
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const actualTotalDue = rows.reduce((sum, r) => sum + r.due, 0);
  // Point (settlement/attendance-detail 0 when unpaid): the stored prepaidAmount
  // only counts if the season pass is actually marked 已繳 — if payment status
  // later gets switched back to 未繳, every place that shows "預繳金額" (this
  // settlement's prepaidAmount, the 本季出席詳情 modal, etc.) must revert to 0
  // rather than keep showing a number nobody actually paid.
  const prepaid = seasonPass.paymentStatus === '已繳' ? (Number(seasonPass.prepaidAmount) || 0) : 0;
  const diff = prepaid - actualTotalDue; // positive => refund, negative => makeup owed
  // Split refund rows by usage type for display purposes (a message can list
  // "完全未使用" and "部分使用" separately rather than lumping them together).
  const acNoneRows = rows.filter((r) => r.acUsage === 'none');
  const acPartialRows = rows.filter((r) => r.acUsage === 'partial');
  const acRefundRows = rows.filter((r) => r.acRefund > 0);
  const acExtraChargeRows = rows.filter((r) => r.acExtraCharge > 0);

  return {
    rows,
    actualTotalDue,
    prepaidAmount: prepaid,
    refundAmount: diff > 0 ? diff : 0,
    makeupAmount: diff < 0 ? -diff : 0,
    isMakeup: diff < 0,
    acRefundRows,
    acRefundTotal: acRefundRows.reduce((sum, r) => sum + r.acRefund, 0),
    acNoneRows,
    acNoneTotal: acNoneRows.reduce((sum, r) => sum + r.acRefund, 0),
    acPartialRows,
    acPartialTotal: acPartialRows.reduce((sum, r) => sum + r.acRefund, 0),
    acExtraChargeRows,
    acExtraChargeTotal: acExtraChargeRows.reduce((sum, r) => sum + r.acExtraCharge, 0),
  };
}

// F8 — season-level aggregate stats.
// sessions: all sessions in season; sessionStatsById: map sessionId -> computeSessionStats result
// seasonPasses: all SeasonPass rows for the season, each with .settlement attached
export function computeSeasonStats(sessions, sessionStatsById, seasonPasses) {
  let sessionsReceivable = 0, sessionsReceived = 0, sessionsExpense = 0;
  const byMethod = {};

  sessions.forEach((s) => {
    const st = sessionStatsById[s.id];
    if (!st) return;
    sessionsReceivable += st.receivable;
    sessionsReceived += st.received;
    sessionsExpense += st.expense;
    Object.entries(st.byMethod).forEach(([k, v]) => { byMethod[k] = (byMethod[k] || 0) + v; });
  });

  let seasonPassPrepaidTotal = 0;
  let seasonPassPaidTotal = 0;
  let refundTotal = 0;

  seasonPasses.forEach((sp) => {
    const prepaid = Number(sp.prepaidAmount) || 0;
    seasonPassPrepaidTotal += prepaid;
    if (sp.paymentStatus === '已繳') {
      seasonPassPaidTotal += prepaid;
      const key = sp.paymentMethod || '未指定';
      byMethod[key] = (byMethod[key] || 0) + prepaid;
    }
    if (sp.settlement) refundTotal += sp.settlement.refundAmount - sp.settlement.makeupAmount;
  });

  const receivable = sessionsReceivable + seasonPassPrepaidTotal;
  const received = sessionsReceived + seasonPassPaidTotal;

  return {
    receivable,
    received,
    expense: sessionsExpense,
    refundTotal,
    receivableSurplus: receivable - sessionsExpense - refundTotal,
    receivedSurplus: received - sessionsExpense - refundTotal,
    byMethod,
  };
}

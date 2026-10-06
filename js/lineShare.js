// ---------------------------------------------------------------------------
// Builds the roster Flex Message using the custom card design (numbered
// badge rows, pink/blue 女/男 two-column layout, a grouped-by-3 候補 card,
// and a Total footer). Only the parts that actually vary per session are
// computed here — date/time/venue, the name lists, and the counts. Every
// other property (colors, paddings, corner radii, layout) is a fixed
// template and intentionally left untouched.
// ---------------------------------------------------------------------------

import { fmtMoney } from './utils.js';

const COLOR_HEADER_BG = '#4A90E2';
const COLOR_FEMALE = '#E24A8E';
const COLOR_FEMALE_ROW_BG = '#E24A8E11';
const COLOR_MALE = '#4A90E2';
const COLOR_MALE_ROW_BG = '#4A90E211';
const COLOR_WAITLIST_LABEL = '#9D9D9D';
const COLOR_WAITLIST_ROW_BG = '#F0F0F0';
const COLOR_WAITLIST_INDEX = '#6C6C6C';

// "2026/7/19" — year/month/day with NO leading zero on month or day.
function formatDateNoLeadingZero(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// One numbered row inside the 女/男 columns, e.g. "01  龍"
function personRow(index, name, color, rowBg) {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: pad2(index), size: 'xxs', color, flex: 0, weight: 'bold', gravity: 'bottom' },
      { type: 'text', text: name, size: 'sm', color: '#555555', align: 'start', flex: 0, margin: 'sm' },
    ],
    backgroundColor: rowBg,
    cornerRadius: '4px',
    paddingAll: '8px',
  };
}

// One 女 or 男 column (label + stacked numbered rows).
function genderColumn(label, color, rowBg, names, extraProps) {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: label, weight: 'bold', color, size: 'md' },
      {
        type: 'box',
        layout: 'vertical',
        margin: 'md',
        spacing: 'sm',
        contents: names.map((name, i) => personRow(i + 1, name, color, rowBg)),
      },
    ],
    width: '50%',
    paddingAll: '10px',
    paddingTop: '20px',
    ...extraProps,
  };
}

// One waitlist entry card, e.g. "01 / 小林" — three of these sit side by side per row.
function waitlistEntry(index, name) {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: pad2(index), size: '8px', color: COLOR_WAITLIST_INDEX, flex: 0, weight: 'bold', gravity: 'bottom' },
      { type: 'text', text: name, size: '11px', color: '#555555', align: 'start', flex: 0, margin: 'sm', gravity: 'bottom' },
    ],
    backgroundColor: COLOR_WAITLIST_ROW_BG,
    cornerRadius: '4px',
    paddingAll: '8px',
    spacing: 'none',
    width: '32.2%',
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildRosterFlexMessage(season, session, rosters, seasonPasses, membersById) {
  const dateLabel = formatDateNoLeadingZero(session.date);

  // Same "attending" logic used in the app's own roster tab: a season-pass
  // member counts as attending unless explicitly marked 請假.
  const leaveMemberIds = new Set(
    rosters.filter((r) => r.sourceType === 'seasonPass' && r.attendance === '請假').map((r) => r.memberId)
  );
  const seasonPassAttendingIds = seasonPasses.map((sp) => sp.memberId).filter((id) => !leaveMemberIds.has(id));
  const casualRows = rosters.filter((r) => r.sourceType === 'casual');
  const waitlistRows = rosters.filter((r) => r.sourceType === 'waitlist');

  const attendingMembers = [
    ...seasonPassAttendingIds.map((id) => membersById[id]),
    ...casualRows.map((r) => membersById[r.memberId]),
  ].filter(Boolean);
  const femaleNames = attendingMembers.filter((m) => m.gender === '女').map((m) => m.name);
  const maleNames = attendingMembers.filter((m) => m.gender === '男').map((m) => m.name);
  const waitlistNames = waitlistRows.map((r) => membersById[r.memberId]).filter(Boolean).map((m) => m.name);

  const waitlistRowsBoxes = chunk(waitlistNames, 3).map((group, rowIdx) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: group.map((name, i) => waitlistEntry(rowIdx * 3 + i + 1, name)),
  }));

  return {
    type: 'flex',
    altText: `${dateLabel} 名單`,
    contents: {
      type: 'bubble',
      size: 'deca',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '0px',
        contents: [
          // Header
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: dateLabel, weight: 'bold', size: 'xl', color: '#ffffff' },
              { type: 'text', text: `${session.timeSlot || ''} ${session.venue || ''}`.trim(), size: 'sm', color: '#ffffff90', margin: 'md' },
            ],
            backgroundColor: COLOR_HEADER_BG,
            paddingAll: '22px',
            paddingTop: '18px',
            paddingBottom: '16px',
          },
          // 女 / 男 two-column roster
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              genderColumn('女', COLOR_FEMALE, COLOR_FEMALE_ROW_BG, femaleNames, { paddingEnd: '2px' }),
              genderColumn('男', COLOR_MALE, COLOR_MALE_ROW_BG, maleNames, {}),
            ],
          },
          // 候補
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '候補', weight: 'bold', size: 'xs', margin: 'md', color: COLOR_WAITLIST_LABEL },
              { type: 'box', layout: 'vertical', margin: 'sm', spacing: 'sm', contents: waitlistRowsBoxes },
            ],
            cornerRadius: 'xl',
            margin: 'none',
            backgroundColor: '#ffffff',
            paddingAll: '10px',
            paddingTop: '10px',
          },
          // Total footer
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'Total', size: 'xs', color: '#aaaaaa', flex: 0 },
                  { type: 'text', text: `${femaleNames.length} 女 ${maleNames.length} 男 (候補 ${waitlistNames.length} 人)`, color: '#9D9D9D', size: 'xs', align: 'end' },
                ],
              },
            ],
            paddingAll: '15px',
            backgroundColor: '#4A90E208',
            cornerRadius: '4px',
            margin: 'xl',
          },
        ],
      },
    },
  };
}

// Builds a Flex Message summarizing every season-pass member's refund/makeup
// settlement for the whole season (point 11).
const SETTLEMENT_ROW_BG_A = '#E6F2FF';
const SETTLEMENT_ROW_BG_B = '#FFFFFF';

// One member row inside a settlement column: name (clickable postback, underlined blue) +
// amount (right-aligned). Alternates row background for readability.
function settlementMemberRow(name, memberId, amountText, index) {
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: index % 2 === 0 ? SETTLEMENT_ROW_BG_A : SETTLEMENT_ROW_BG_B,
    paddingAll: 'md',
    contents: [
      {
        type: 'text', text: name, size: 'sm', flex: 2, weight: 'bold', color: '#1E90FF', decoration: 'underline',
        action: { type: 'postback', label: 'refund_detail', data: `refund_detail:${memberId}` },
      },
      { type: 'text', text: amountText, size: 'sm', flex: 2, align: 'end' },
    ],
  };
}

// One column: header row (姓名 / 退費) + separator + the striped member rows.
function settlementColumn(rows, headerNameFlex, headerAmountFlex) {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '姓名', weight: 'bold', size: 'sm', flex: headerNameFlex },
          { type: 'text', text: '退費', weight: 'bold', size: 'sm', flex: headerAmountFlex, align: 'end' },
        ],
      },
      { type: 'separator', margin: 'sm' },
      {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: rows.map((r, i) => settlementMemberRow(r.name, r.memberId, r.amountText, i)),
      },
    ],
  };
}

// Builds the season-pass settlement Flex Message using the custom two-column card design:
// blue header "成員退費金額", members split across two columns, each row striped and the
// name a clickable (postback) underlined link. Refunds show as a plain amount; anyone who
// still owes a top-up shows a "+" prefix so it isn't mistaken for a refund.
export function buildSettlementFlexMessage(season, settlements, membersById) {
  const rows = settlements.map(({ seasonPass, settlement }) => {
    const member = membersById[seasonPass.memberId];
    let amountText;
    if (settlement.isMakeup) amountText = `+$${fmtMoney(settlement.makeupAmount)}`;
    else if (settlement.refundAmount > 0) amountText = `$${fmtMoney(settlement.refundAmount)}`;
    else amountText = '$0';
    return { name: member?.name || '', memberId: seasonPass.memberId, gender: member?.gender || '', amountText };
  });

  // Point: split into columns by gender (女 left, 男 right) rather than an even head-count split.
  const col1Rows = rows.filter((r) => r.gender === '女');
  const col2Rows = rows.filter((r) => r.gender === '男');

  const bodyContents = rows.length
    ? [
        ...(col1Rows.length ? [settlementColumn(col1Rows, 2, 3)] : []),
        ...(col2Rows.length ? [settlementColumn(col2Rows, 2, 4)] : []),
      ]
    : [{ type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '本季尚無季打名單', size: 'sm', color: '#8A9790' }] }];

  return {
    type: 'flex',
    altText: `${season.name} 成員退費金額`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '成員退費金額', weight: 'bold', size: 'lg', color: '#ffffff', align: 'center' },
        ],
        backgroundColor: '#1E90FF',
      },
      body: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: bodyContents,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Builds the season-pass refund-detail Flex Message for ONE member: the
// 總退費金額 on top, then two card-style sections — 請假 (date + refunded
// flat fee) and 冷氣 (date + usage status tag + refund/extra charge, one row
// per session in date order). A section with no rows is omitted entirely.
// settlement is whatever computeSeasonPassSettlement() returned for this
// member (rows already sorted by date and carrying acUsage/acRefund/acExtraCharge).
// ---------------------------------------------------------------------------
const COLOR_REFUND_HEADER_BG = '#0F6E56';
const COLOR_REFUND_TEXT = '#1F6F54';
const COLOR_REFUND_SECTION_BG = '#F3F8F5';
const COLOR_REFUND_SECTION_LINE = '#DCE8E1';
const COLOR_REFUND_PRIMARY_TEXT = '#16211C';
const COLOR_REFUND_MUTED_TEXT = '#8A9790';
const COLOR_EXTRA_CHARGE_BG = '#FBE6E4';
const COLOR_EXTRA_CHARGE_TEXT = '#B3261E';

// 冷氣狀態標籤：acUsage → 文字 / 底色 / 字色。'even'（實際費用剛好等於基準）
// 沒有退費也沒有補繳，不列出。
const AC_USAGE_TAGS = {
  none: { label: '無', bg: '#E1F5EE', color: '#085041' },
  partial: { label: '部分使用', bg: '#FAEEDA', color: '#633806' },
  over: { label: '需補繳', bg: COLOR_EXTRA_CHARGE_BG, color: COLOR_EXTRA_CHARGE_TEXT },
};

// "7/12" — month/day with no leading zero, no year, no weekday (space is tight).
function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
}

// Signed money text: refunds as "$80", extra charges as "−$30".
function refundMoneyText(amount) {
  return `${amount < 0 ? '−' : ''}$${fmtMoney(Math.abs(amount))}`;
}

function refundSectionHeader(title, countText, total) {
  return {
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    contents: [
      { type: 'text', text: title, size: 'md', weight: 'bold', color: COLOR_REFUND_PRIMARY_TEXT, flex: 0 },
      { type: 'text', text: countText, size: 'xxs', color: COLOR_REFUND_MUTED_TEXT, margin: 'sm', flex: 1, gravity: 'center' },
      { type: 'text', text: refundMoneyText(total), size: 'md', weight: 'bold', color: total < 0 ? COLOR_EXTRA_CHARGE_TEXT : COLOR_REFUND_TEXT, align: 'end', flex: 0 },
    ],
  };
}

// Column captions under a section header — columns: [{ text, flex, align? }].
function refundColumnCaptions(columns) {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: columns.map((c) => ({ type: 'text', text: c.text, size: 'xxs', color: COLOR_REFUND_MUTED_TEXT, flex: c.flex, ...(c.align ? { align: c.align } : {}) })),
  };
}

function refundSection(contents) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: COLOR_REFUND_SECTION_BG,
    cornerRadius: '10px',
    paddingAll: '12px',
    spacing: 'sm',
    contents,
  };
}

function acUsageTag(tag) {
  return {
    type: 'box',
    layout: 'horizontal',
    flex: 3,
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        backgroundColor: tag.bg,
        cornerRadius: '4px',
        paddingStart: '6px',
        paddingEnd: '6px',
        paddingTop: '2px',
        paddingBottom: '2px',
        contents: [{ type: 'text', text: tag.label, size: 'xxs', color: tag.color }],
      },
    ],
  };
}

function buildLeaveSection(leaveRows) {
  const total = leaveRows.reduce((sum, r) => sum + r.fee, 0);
  return refundSection([
    refundSectionHeader('請假', `${leaveRows.length} 次`, total),
    { type: 'separator', color: COLOR_REFUND_SECTION_LINE },
    refundColumnCaptions([{ text: '日期', flex: 3 }, { text: '退費', flex: 2, align: 'end' }]),
    ...leaveRows.map((r) => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: formatShortDate(r.date), size: 'sm', color: COLOR_REFUND_PRIMARY_TEXT, flex: 3 },
        { type: 'text', text: refundMoneyText(r.fee), size: 'sm', color: COLOR_REFUND_TEXT, align: 'end', flex: 2 },
      ],
    })),
  ]);
}

function buildAcSection(acRows) {
  const amountOf = (r) => r.acRefund - r.acExtraCharge;
  const total = acRows.reduce((sum, r) => sum + amountOf(r), 0);
  return refundSection([
    refundSectionHeader('冷氣', `${acRows.length} 場`, total),
    { type: 'separator', color: COLOR_REFUND_SECTION_LINE },
    refundColumnCaptions([{ text: '日期', flex: 2 }, { text: '狀態', flex: 3 }, { text: '退費', flex: 2, align: 'end' }]),
    ...acRows.map((r) => {
      const amount = amountOf(r);
      const danger = amount < 0;
      return {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        contents: [
          { type: 'text', text: formatShortDate(r.date), size: 'sm', color: danger ? COLOR_EXTRA_CHARGE_TEXT : COLOR_REFUND_PRIMARY_TEXT, flex: 2 },
          acUsageTag(AC_USAGE_TAGS[r.acUsage]),
          { type: 'text', text: refundMoneyText(amount), size: 'sm', color: danger ? COLOR_EXTRA_CHARGE_TEXT : COLOR_REFUND_TEXT, align: 'end', flex: 2 },
        ],
      };
    }),
  ]);
}

export function buildRefundDetailFlexMessage(season, member, settlement) {
  const leaveRows = settlement.rows.filter((r) => r.attendance === '請假');
  const acRows = settlement.rows.filter((r) => AC_USAGE_TAGS[r.acUsage]);

  const bodyContents = [
    {
      type: 'box',
      layout: 'vertical',
      alignItems: 'center',
      paddingTop: '4px',
      paddingBottom: '6px',
      contents: [
        { type: 'text', text: '總退費金額', size: 'xs', color: COLOR_REFUND_MUTED_TEXT },
        { type: 'text', text: refundMoneyText(settlement.refundAmount - settlement.makeupAmount), size: 'xxl', weight: 'bold', color: COLOR_REFUND_TEXT, margin: 'xs' },
      ],
    },
  ];
  if (leaveRows.length) bodyContents.push(buildLeaveSection(leaveRows));
  if (acRows.length) bodyContents.push(buildAcSection(acRows));
  if (!leaveRows.length && !acRows.length) {
    bodyContents.push({ type: 'text', text: '本季沒有退費或補繳項目', size: 'sm', color: COLOR_REFUND_MUTED_TEXT, align: 'center' });
  }

  const subtitle = [member?.name, season?.name].filter(Boolean).join(' · ');
  return {
    type: 'flex',
    altText: `${member?.name || ''} 季打退費詳情`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '季打退費詳情', weight: 'bold', size: 'lg', color: '#ffffff' },
          { type: 'text', text: subtitle || ' ', size: 'sm', color: '#D7E8DF', margin: 'xs' },
        ],
        backgroundColor: COLOR_REFUND_HEADER_BG,
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        spacing: 'md',
        contents: bodyContents,
      },
    },
  };
}

// Sends one or more LINE message objects through the Cloudflare Worker relay.
// Throws with a readable message on failure so callers can toast it.
export async function sendToLineRelay({ relayUrl, apiKey, groupId, messages }) {
  if (!relayUrl) throw new Error('尚未設定 LINE 發送用的 Worker 網址');
  if (!groupId) throw new Error('尚未選擇要發送的聊天室');

  let res;
  try {
    res = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey || '' },
      body: JSON.stringify({ to: groupId, messages }),
    });
  } catch (err) {
    throw new Error('無法連線到 Worker，請確認網址是否正確，以及裝置是否有網路連線');
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (e) { /* ignore */ }
    throw new Error(`發送失敗（${res.status}）${detail ? '：' + detail : ''}`);
  }
}

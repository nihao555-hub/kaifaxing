import { db, save, logActivity } from './store.js';

// 公开 RFQ / 采购数据源（只走官方开放接口，不爬私人邮箱）
//  1. USASpending.gov — 美国联邦已授标合同，免 Key
//  2. 世界银行采购公告 — 公开 IFB/RFB，免 Key
// SAM.gov 招标需要免费 api_key，阿里国际站 RFQ 需要卖家开放平台，这里只作说明

const STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago', KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
};

const POWER_TOOL_NAICS = ['333991', '332216', '423710', '444140'];

async function postJson(url, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'OutreachAI/1.0' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'OutreachAI/1.0' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export async function searchUsaspending({ keyword = 'power tools', limit = 20 } = {}) {
  const data = await postJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      naics_codes: { require: POWER_TOOL_NAICS },
      time_period: [{ start_date: '2023-01-01', end_date: new Date().toISOString().slice(0, 10) }],
    },
    fields: [
      'Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date',
      'NAICS Code', 'NAICS Description', 'Place of Performance State Code', 'Recipient UEI',
    ],
    limit,
    page: 1,
    sort: 'Award Amount',
    order: 'desc',
  });

  const rows = data.results || [];
  const out = [];
  for (const row of rows) {
    const gid = row.generated_internal_id;
    let detail = {};
    try {
      if (gid) detail = await getJson(`https://api.usaspending.gov/api/v2/awards/${gid}/`, 12000);
    } catch { /* 详情失败仍保留列表字段 */ }
    const rec = detail.recipient || {};
    const loc = rec.location || detail.place_of_performance || {};
    const state = loc.state_code || row['Place of Performance State Code'] || '';
    const city = loc.city_name || '';
    const naics = detail.naics_hierarchy?.base_code || row['NAICS Code'] || '';
    const naicsName = detail.naics_hierarchy?.base_name || row['NAICS Description'] || '电动工具/五金';
    out.push({
      id: `usa_${row.internal_id || gid}`,
      source: 'USASpending.gov',
      sourceType: 'us_federal_award',
      title: detail.description || row['Award ID'],
      company: row['Recipient Name'],
      name: rec.recipient_name || row['Recipient Name'],
      titleRole: 'Procurement / Federal Contract',
      email: '', // 该源不公开个人邮箱，入库后需补官方采购邮箱再发送
      country: '美国',
      timezone: STATE_TZ[state] || 'America/New_York',
      industry: naicsName,
      city,
      state,
      amount: row['Award Amount'],
      agency: row['Awarding Agency'],
      awardId: row['Award ID'],
      url: gid ? `https://www.usaspending.gov/award/${gid}` : 'https://www.usaspending.gov',
      painPoints: [
        `近期获得美国联邦合同 ${row['Award ID'] || ''}（${money(row['Award Amount'])}，甲方 ${row['Awarding Agency'] || ''}）`,
        city || state ? `履约地 ${[city, state].filter(Boolean).join(', ')}` : '',
        `品类 ${naicsName}${naics ? ` / NAICS ${naics}` : ''}`,
        '公开数据未提供个人邮箱，导入后请补对方公司采购邮箱再让 Agent 发送',
      ].filter(Boolean).join('；'),
    });
  }
  return out;
}

export async function searchWorldBank({ keyword = 'power tools', limit = 10 } = {}) {
  const q = encodeURIComponent(keyword);
  const data = await getJson(
    `https://search.worldbank.org/api/v2/procnotices?format=json&rows=${limit}&os=0&qterm=${q}&srt=noticedate&order=desc`,
    12000
  );
  return (data.procnotices || []).map((n) => ({
    id: `wb_${n.id}`,
    source: 'World Bank',
    sourceType: 'world_bank_notice',
    title: n.bid_description || n.project_name,
    company: n.project_name || n.project_ctry_name,
    name: n.project_name || n.id,
    titleRole: n.procurement_method_name || n.notice_type,
    email: n.contact_email || '',
    country: n.project_ctry_name || '',
    timezone: 'UTC',
    industry: n.procurement_group || 'Procurement',
    url: n.id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}` : '',
    painPoints: `世界银行采购公告 ${n.notice_type || ''}：${n.bid_description || ''}（${n.noticedate || ''}）`,
  }));
}

export const RFQ_CATALOG = [
  {
    key: 'usaspending',
    name: 'USASpending.gov',
    region: '美国',
    auth: '无需 Key',
    ready: true,
    note: '美国联邦已授标合同。能拿到真实公司、地点、金额、NAICS，一般不带个人邮箱。',
  },
  {
    key: 'worldbank',
    name: '世界银行采购公告',
    region: '全球',
    auth: '无需 Key',
    ready: true,
    note: '公开 IFB/RFB/授标公告，偶有联系邮箱。',
  },
  {
    key: 'samgov',
    name: 'SAM.gov Contract Opportunities',
    region: '美国',
    auth: '免费 api_key',
    ready: false,
    note: '美国联邦正在招标的 RFQ/RFP。到 sam.gov 申请 Public API Key 后可接入。',
  },
  {
    key: 'alibaba',
    name: '阿里国际站 RFQ',
    region: '全球买家',
    auth: '卖家开放平台',
    ready: false,
    note: '官方 alibaba.icbu.rfq.search，需国际站卖家账号，不爬取页面。',
  },
];

export async function searchRfq({ source = 'usaspending', keyword, limit } = {}) {
  if (source === 'worldbank') return searchWorldBank({ keyword, limit });
  return searchUsaspending({ keyword, limit });
}

export function importRfqItems(items = []) {
  const created = [];
  for (const it of items) {
    const exists = db.customers.some(
      (c) => (it.awardId && c.awardId === it.awardId) || (it.url && c.sourceUrl === it.url)
    );
    if (exists) continue;
    const customer = {
      id: `rfq${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: it.name || it.company || 'Unknown buyer',
      company: it.company || '',
      title: it.titleRole || 'Buyer',
      email: it.email || '',
      country: it.country || '',
      timezone: it.timezone || 'America/New_York',
      industry: it.industry || '',
      painPoints: it.painPoints || it.title || '',
      status: 'uncontacted',
      lastActivity: new Date().toISOString().slice(0, 10),
      source: it.source,
      sourceUrl: it.url,
      awardId: it.awardId || '',
      agentPhase: it.email ? null : 'need_email',
    };
    db.customers.unshift(customer);
    created.push(customer);
    logActivity({
      customerId: customer.id,
      action: 'RFQ 入库',
      detail: `来自 ${it.source}：${customer.company}。${
        customer.email ? '已有公开联系邮箱，Agent 将自动处理' : '公开源未提供邮箱，请补上对方公司采购邮箱后再发送'
      }`,
    });
  }
  save();
  return created;
}

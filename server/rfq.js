import { db, save, logActivity } from './store.js';
import { config } from './config.js';
import { alibabaReady, searchAlibaba } from './alibaba.js';
import { searchAlibabaPublic, crawlAlibabaPublic, alibabaCrawlProgress, ALIBABA_PUBLIC_FIELDS, PUBLIC_SINCE_DEFAULT } from './publicRfq.js';
import { searchGoldSupplier, searchTradeIndia } from './b2bPublic.js';
import { parseAlibabaExportRow } from './researchPath.js';
import { normalizePaidExportRow } from './paidSources.js';

// 聚合公开 RFQ / 采购数据源：一次请求并行打多个官方接口，结果归一化后合并。
// 只走开放 API，不爬私人邮箱。某个源失败不影响其他源。

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

const ISO3_COUNTRY = {
  USA: '美国', GBR: '英国', DEU: '德国', FRA: '法国', ITA: '意大利', ESP: '西班牙',
  NLD: '荷兰', BEL: '比利时', POL: '波兰', SWE: '瑞典', AUT: '奥地利', IRL: '爱尔兰',
  CZE: '捷克', PRT: '葡萄牙', ROU: '罗马尼亚', HUN: '匈牙利', GRC: '希腊', HRV: '克罗地亚',
  DNK: '丹麦', FIN: '芬兰', NOR: '挪威', CHE: '瑞士',
};

const ISO3_TZ = {
  USA: 'America/New_York', GBR: 'Europe/London', DEU: 'Europe/Berlin', FRA: 'Europe/Paris',
  ITA: 'Europe/Rome', ESP: 'Europe/Madrid', NLD: 'Europe/Amsterdam', BEL: 'Europe/Brussels',
  POL: 'Europe/Warsaw', SWE: 'Europe/Stockholm', AUT: 'Europe/Vienna', IRL: 'Europe/Dublin',
};

const POWER_TOOL_NAICS = ['333991', '332216', '423710', '444140'];

function samKey() {
  return process.env.SAM_API_KEY || config.samApiKey || '';
}

async function postJson(url, body, timeoutMs = 18000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'OutreachAI/1.0' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text().then((s) => s.slice(0, 160))}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OutreachAI/1.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function money(n, currency = 'USD') {
  const v = Number(n);
  if (!Number.isFinite(v) || !v) return '';
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${symbol}${Math.round(v).toLocaleString('en-US')}`;
}

function pickLang(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj[0] || '';
  return obj.eng?.[0] || obj.ENG?.[0] || obj.en?.[0] || Object.values(obj).flat?.()?.[0] || Object.values(obj)[0] || '';
}

const COUNTRY_TZ = {
  美国: 'America/New_York', 英国: 'Europe/London', 德国: 'Europe/Berlin', 法国: 'Europe/Paris',
  意大利: 'Europe/Rome', 西班牙: 'Europe/Madrid', 荷兰: 'Europe/Amsterdam', 比利时: 'Europe/Brussels',
  波兰: 'Europe/Warsaw', 瑞典: 'Europe/Stockholm', 奥地利: 'Europe/Vienna', 爱尔兰: 'Europe/Dublin',
  加拿大: 'America/Toronto', 澳大利亚: 'Australia/Sydney', 日本: 'Asia/Tokyo', 韩国: 'Asia/Seoul',
  印度: 'Asia/Kolkata', 巴西: 'America/Sao_Paulo', 墨西哥: 'America/Mexico_City', 阿联酋: 'Asia/Dubai',
  沙特: 'Asia/Riyadh', 南非: 'Africa/Johannesburg', 新加坡: 'Asia/Singapore', 马来西亚: 'Asia/Kuala_Lumpur',
  USA: 'America/New_York', UK: 'Europe/London', Germany: 'Europe/Berlin', France: 'Europe/Paris',
  China: 'Asia/Shanghai', 中国: 'Asia/Shanghai',
};

function guessTimezone(country, fallback = 'UTC') {
  if (!country) return fallback;
  return COUNTRY_TZ[country] || COUNTRY_TZ[String(country).trim()] || fallback;
}

function lead({ id, source, sourceType, kind, title, company, name, titleRole, email, country, timezone, industry, city, state, amount, currency, url, painPoints, awardId }) {
  return {
    id, source, sourceType,
    kind: kind || 'government',
    title: title || '',
    company: company || name || '',
    name: name || company || 'Unknown buyer',
    titleRole: titleRole || 'Buyer',
    email: email || '',
    country: country || '',
    timezone: timezone || guessTimezone(country),
    industry: industry || '',
    city: city || '',
    state: state || '',
    amount: amount || 0,
    currency: currency || '',
    url: url || '',
    awardId: awardId || '',
    painPoints: painPoints || title || '',
  };
}

export async function searchUsaspending({ limit = 12, since, broad = false } = {}) {
  const filters = {
    award_type_codes: ['A', 'B', 'C', 'D'],
    time_period: [{ start_date: since || '2023-01-01', end_date: new Date().toISOString().slice(0, 10) }],
  };
  if (!broad) filters.naics_codes = { require: POWER_TOOL_NAICS };
  const data = await postJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    filters,
    fields: [
      'Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date',
      'NAICS Description', 'Place of Performance State Code',
    ],
    limit,
    page: 1,
    sort: 'Award Amount',
    order: 'desc',
  });
  return (data.results || []).map((row) => {
    const gid = row.generated_internal_id;
    const state = row['Place of Performance State Code'] || '';
    return lead({
      id: `usa_${row.internal_id || gid}`,
      source: 'USASpending.gov',
      sourceType: 'us_federal_award',
      title: row['Award ID'],
      company: row['Recipient Name'],
      name: row['Recipient Name'],
      titleRole: 'Federal contract recipient',
      country: '美国',
      timezone: STATE_TZ[state] || 'America/New_York',
      industry: row['NAICS Description'] || '电动工具/五金',
      state,
      amount: row['Award Amount'],
      currency: 'USD',
      awardId: row['Award ID'],
      url: gid ? `https://www.usaspending.gov/award/${gid}` : 'https://www.usaspending.gov',
      painPoints: `美国联邦合同 ${row['Award ID'] || ''}（${money(row['Award Amount'])}，甲方 ${row['Awarding Agency'] || ''}，${state}）。公开源无个人邮箱，补采购邮箱后再发送。`,
    });
  });
}

export async function searchWorldBank({ keyword = 'power tools', limit = 10, since } = {}) {
  const q = encodeURIComponent(keyword || 'procurement');
  const data = await getJson(
    `https://search.worldbank.org/api/v2/procnotices?format=json&rows=${limit}&os=0&qterm=${q}&srt=noticedate&order=desc`,
    12000
  );
  const from = since ? new Date(since).getTime() : 0;
  return (data.procnotices || []).filter((n) => {
    if (!from || !n.noticedate) return true;
    return new Date(n.noticedate).getTime() >= from;
  }).map((n) => lead({
    id: `wb_${n.id}`,
    source: 'World Bank',
    sourceType: 'world_bank_notice',
    title: n.bid_description || n.project_name,
    company: n.project_name || n.project_ctry_name,
    name: n.project_name || n.id,
    titleRole: n.procurement_method_name || n.notice_type,
    email: n.contact_email || '',
    country: n.project_ctry_name || '',
    industry: n.procurement_group || 'Procurement',
    url: n.id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}` : '',
    painPoints: `世界银行 ${n.notice_type || ''}：${n.bid_description || ''}（${n.noticedate || ''}）`,
  }));
}

export async function searchUk({ keyword = 'power tools', limit = 12, since } = {}) {
  const searchCriteria = { statuses: ['Open'] };
  if (keyword) searchCriteria.keyword = keyword;
  if (since) searchCriteria.publishedFrom = since;
  const data = await postJson('https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json', {
    searchCriteria,
    size: limit,
  });
  return (data.noticeList || []).map((row) => {
    const it = row.item || {};
    return lead({
      id: `uk_${it.id}`,
      source: 'UK Contracts Finder',
      sourceType: 'uk_notice',
      title: it.title,
      company: it.organisationName,
      name: it.organisationName,
      titleRole: it.noticeType || 'Buyer',
      country: '英国',
      timezone: 'Europe/London',
      industry: it.cpvDescription || 'Tools & hardware',
      amount: it.valueHigh || it.valueLow,
      currency: 'GBP',
      url: it.id ? `https://www.contractsfinder.service.gov.uk/Notice/${it.id}` : '',
      painPoints: `英国公开招标 ${it.noticeType || ''}：${(it.description || it.title || '').replace(/<[^>]+>/g, ' ').slice(0, 220)} 截止 ${it.deadlineDate || '未公布'}`,
    });
  });
}

export async function searchTed({ keyword = 'tools', limit = 10, since } = {}) {
  const q = String(keyword || '').replace(/"/g, '');
  const pd = since ? `PD>=${String(since).replace(/-/g, '')}` : '';
  const parts = [
    q ? `FT~"${q}"` : '',
    q ? 'classification-cpv=44000000' : '',
    pd,
    'SORT BY publication-date DESC',
  ].filter(Boolean);
  const data = await postJson('https://api.ted.europa.eu/v3/notices/search', {
    query: parts.join(' AND ').replace(' AND SORT', ' SORT'),
    fields: ['publication-number', 'notice-title', 'buyer-name', 'buyer-country', 'classification-cpv'],
    limit,
    scope: 'ACTIVE',
    paginationMode: 'ITERATION',
  });
  return (data.notices || []).map((n) => {
    const num = n['publication-number'];
    const iso = Array.isArray(n['buyer-country']) ? n['buyer-country'][0] : n['buyer-country'] || '';
    return lead({
      id: `ted_${num}`,
      source: 'TED Europa',
      sourceType: 'eu_ted',
      title: pickLang(n['notice-title']),
      company: pickLang(n['buyer-name']),
      name: pickLang(n['buyer-name']) || num,
      titleRole: 'EU contracting authority',
      country: ISO3_COUNTRY[iso] || iso,
      timezone: ISO3_TZ[iso] || 'Europe/Brussels',
      industry: 'Construction materials / tools',
      url: num ? `https://ted.europa.eu/en/notice/-/detail/${num}` : '',
      awardId: num,
      painPoints: `欧盟 TED 招标 ${num}：${pickLang(n['notice-title'])}`,
    });
  });
}

export async function searchSam({ keyword = 'power tools', limit = 10, since } = {}) {
  const key = samKey();
  if (!key) throw new Error('未配置 SAM_API_KEY，请到 sam.gov 申请免费 Public API Key');
  const postedFrom = since ? new Date(since) : new Date(Date.now() - 30 * 86400000);
  const postedTo = new Date();
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  const qs = new URLSearchParams({
    api_key: key,
    limit: String(limit),
    offset: '0',
    postedFrom: fmt(postedFrom),
    postedTo: fmt(postedTo),
    title: keyword,
    ptype: 'o,k,p,r',
  });
  const data = await getJson(`https://api.sam.gov/opportunities/v2/search?${qs}`, 18000);
  return (data.opportunitiesData || data.opportunities || []).map((n) => lead({
    id: `sam_${n.noticeId || n.solicitationNumber}`,
    source: 'SAM.gov',
    sourceType: 'us_opportunity',
    title: n.title,
    company: n.fullParentPathName || n.department || n.organizationName,
    name: n.pointOfContact?.[0]?.fullName || n.fullParentPathName || n.title,
    titleRole: n.pointOfContact?.[0]?.title || n.type || 'Contracting',
    email: n.pointOfContact?.[0]?.email || n.pointOfContact?.[0]?.emailAddress || '',
    country: '美国',
    timezone: 'America/New_York',
    industry: n.naicsCode || 'Federal opportunity',
    url: n.uiLink || (n.noticeId ? `https://sam.gov/opp/${n.noticeId}/view` : ''),
    awardId: n.solicitationNumber,
    painPoints: `SAM.gov ${n.type || 'Opportunity'}：${n.title || ''}，回应截止 ${n.responseDeadLine || '未公布'}`,
  }));
}

const ADAPTERS = {
  usaspending: { search: searchUsaspending, name: 'USASpending.gov', kind: 'government' },
  worldbank: { search: searchWorldBank, name: 'World Bank', kind: 'government' },
  uk: { search: searchUk, name: 'UK Contracts Finder', kind: 'government' },
  ted: { search: searchTed, name: 'TED Europa', kind: 'government' },
  samgov: { search: searchSam, name: 'SAM.gov', kind: 'government' },
  alibaba: { search: searchAlibaba, name: '阿里国际站官方 API', kind: 'commercial' },
  alibaba_public: {
    search: async (opts) => (await searchAlibabaPublic(opts)).items,
    name: '阿里国际站公开 RFQ',
    kind: 'commercial',
  },
  goldsupplier: { search: searchGoldSupplier, name: 'GoldSupplier 公开询盘', kind: 'commercial' },
  tradeindia: { search: searchTradeIndia, name: 'TradeIndia 公开买盘', kind: 'commercial' },
};

export function listSources() {
  return [
    {
      key: 'all',
      name: '全部已接通源',
      kind: 'aggregate',
      region: '全球',
      auth: '已就绪源并行',
      ready: true,
      note: '并行拉取已接通的政府招标源 + 阿里公开询盘列表（免登录卡片）。官方阿里 API 配了 Key 也会带上。',
    },
    {
      key: 'usaspending',
      name: 'USASpending.gov',
      kind: 'government',
      region: '美国',
      auth: '无需 Key',
      ready: true,
      note: '美国联邦已授标合同。真实公司、州、金额、NAICS。一般无个人邮箱。',
    },
    {
      key: 'uk',
      name: 'UK Contracts Finder',
      kind: 'government',
      region: '英国',
      auth: '无需 Key',
      ready: true,
      note: '英国公开招标/预采购公告，含采购机构和预算。',
    },
    {
      key: 'ted',
      name: 'TED Europa',
      kind: 'government',
      region: '欧盟',
      auth: '无需 Key',
      ready: true,
      note: '欧盟官方招标日报，按 CPV 五金/工具类检索。',
    },
    {
      key: 'worldbank',
      name: '世界银行采购公告',
      kind: 'government',
      region: '全球',
      auth: '无需 Key',
      ready: true,
      note: '公开 IFB/RFB/授标，偶有联系邮箱。',
    },
    {
      key: 'samgov',
      name: 'SAM.gov',
      kind: 'government',
      region: '美国',
      auth: '免费 api_key',
      ready: Boolean(samKey()),
      note: samKey()
        ? '已配置 SAM_API_KEY，聚合时会一并拉取正在招标的 RFQ/RFP。'
        : '到 sam.gov 申请 Public API Key，写入环境变量 SAM_API_KEY 后自动加入聚合。',
    },
    {
      key: 'alibaba_public',
      name: '阿里国际站公开 RFQ',
      kind: 'commercial',
      region: '全球买家',
      auth: '免登录列表页',
      ready: true,
      note: `公开询盘卡片：标题、买家显示名、国家、数量、发布时间。无邮箱。默认从 ${PUBLIC_SINCE_DEFAULT} 起，限速翻页。`,
    },
    {
      key: 'goldsupplier',
      name: 'GoldSupplier 公开询盘',
      kind: 'commercial',
      region: '全球买家',
      auth: '免登录列表页',
      ready: true,
      note: 'goldsupplier.com 公开 Buying Requests。有发布时间和国家，无邮箱。',
    },
    {
      key: 'tradeindia',
      name: 'TradeIndia 公开买盘',
      kind: 'commercial',
      region: '印度/全球',
      auth: '免登录首页',
      ready: true,
      note: 'TradeLeads/buy 首页公开约十几条。更多要登录，不绕过。',
    },
    {
      key: 'alibaba',
      name: '阿里国际站官方 API',
      kind: 'commercial',
      region: '全球买家',
      auth: '卖家开放平台',
      ready: alibabaReady(),
      note: alibabaReady()
        ? '已配置官方 app_key / session。搜索列表未必带公司名；详情/邮箱通常要报价权益。不会回填已入库的公开昵称卡。'
        : '可选卖家应用。未实跑证实能返回法定公司名。公开列表已可先用；昵称卡请在抽屉补主体。',
    },
    {
      key: 'ingest',
      name: '商业/付费聚合导入',
      kind: 'commercial',
      region: '全球',
      auth: 'JSON / webhook',
      ready: true,
      note: '没有合法免费的「全球所有商业 RFQ」单一 API。TendersOnTime、dgMarket、中国制造网导出等，用 POST /api/rfq/ingest 灌进来。',
    },
  ];
}

function readyKeys(kind) {
  const keys = ['usaspending', 'uk', 'ted', 'worldbank', 'alibaba_public', 'goldsupplier', 'tradeindia'];
  if (samKey()) keys.push('samgov');
  if (alibabaReady()) keys.push('alibaba');
  if (kind === 'government') return keys.filter((k) => ADAPTERS[k]?.kind === 'government');
  if (kind === 'commercial') return keys.filter((k) => ADAPTERS[k]?.kind === 'commercial');
  return keys;
}

export async function searchRfq({ source = 'all', keyword = 'power tools', limit = 10, since = PUBLIC_SINCE_DEFAULT } = {}) {
  if (source === 'ingest') {
    return { items: [], reports: [{ key: 'ingest', name: '商业/付费聚合导入', ok: true, count: 0, error: '请用 JSON 导入，不要走搜索' }] };
  }
  const keys = source === 'all' || source === 'government' || source === 'commercial'
    ? readyKeys(source === 'all' ? undefined : source)
    : [source];
  const per = source === 'all' ? Math.max(6, Math.min(12, limit)) : limit;
  const settled = await Promise.allSettled(
    keys.map(async (key) => {
      const ad = ADAPTERS[key];
      if (!ad) throw new Error(`未知数据源 ${key}`);
      const items = await ad.search({ keyword, limit: per, since });
      return { key, name: ad.name, items };
    })
  );

  const items = [];
  const reports = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      items.push(...r.value.items);
      reports.push({ key, name: r.value.name, ok: true, count: r.value.items.length });
    } else {
      reports.push({ key, name: ADAPTERS[key]?.name || key, ok: false, count: 0, error: String(r.reason?.message || r.reason) });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = `${(it.company || '').toLowerCase()}|${it.awardId || it.url || it.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }
  return { items: unique, reports };
}

function ownInbox(email) {
  return email && String(email).toLowerCase() === String(config.smtp.user).toLowerCase();
}

function alreadyImported(it) {
  const email = String(it.email || '').toLowerCase();
  return db.customers.some((c) => {
    if (it.awardId && c.awardId === it.awardId) return true;
    if (it.url && c.sourceUrl === it.url) return true;
    if (email && String(c.email || '').toLowerCase() === email && (c.company || '') === (it.company || '')) return true;
    return false;
  });
}

export function importRfqItems(items = [], { quiet = false, silent = false, persist = true } = {}) {
  const created = [];
  for (const it of items) {
    if (ownInbox(it.email)) continue;
    if (alreadyImported(it)) continue;
    const customer = {
      id: `rfq${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: it.name || it.company || 'Unknown buyer',
      company: it.company || '',
      title: it.titleRole || 'Buyer',
      email: it.email || '',
      country: it.country || '',
      timezone: it.timezone || guessTimezone(it.country, 'America/New_York'),
      industry: it.industry || '',
      painPoints: it.painPoints || it.title || '',
      status: 'uncontacted',
      lastActivity: new Date().toISOString().slice(0, 10),
      ingestedAt: new Date().toISOString(),
      source: it.source,
      sourceUrl: it.url,
      awardId: it.awardId || '',
      agentPhase: it.email ? null : 'need_email',
      imageUrl: it.imageUrl || '',
      haveAnnexes: Boolean(it.haveAnnexes),
      identitySource: it.identitySource || '',
      postedAt: it.postedAt || it.publicCard?.postedAt || '',
      publicCard: it.publicCard || null,
    };
    db.customers.unshift(customer);
    created.push(customer);
    if (!quiet && !silent) {
      logActivity({
        customerId: customer.id,
        action: 'RFQ 入库',
        detail: `来自 ${it.source}：${customer.company}。${
          customer.email ? '已有公开联系邮箱，Agent 将自动处理' : '公开源未提供邮箱，请补上对方公司采购邮箱后再发送'
        }`,
      });
    }
  }
  if (quiet && !silent && created.length) {
    const bySource = {};
    for (const c of created) bySource[c.source || '未知'] = (bySource[c.source || '未知'] || 0) + 1;
    logActivity({
      action: 'RFQ 批量入库',
      detail: `新入库 ${created.length} 条：${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join('，')}`,
    });
  }
  if (persist) save();
  return created;
}

export async function crawlAllAndImport({
  since = PUBLIC_SINCE_DEFAULT,
  alibabaPages = 100,
  govLimit = 80,
  doImport = true,
  sources,
  fanout = true,
} = {}) {
  const want = Array.isArray(sources) && sources.length ? new Set(sources) : null;
  const add = (key, run) => (!want || want.has(key) ? run : null);
  const reports = [];
  const buckets = await Promise.allSettled([
    add('alibaba_public', crawlAlibabaPublic({
      keyword: '',
      since,
      maxPages: alibabaPages,
      fanout,
      onBatch: async (batch) => {
        if (!doImport) return;
        const added = importRfqItems(batch, { quiet: true, silent: true, persist: false });
        alibabaCrawlProgress.created = (alibabaCrawlProgress.created || 0) + added.length;
        if ((alibabaCrawlProgress.created || 0) % 80 < added.length) save();
        if ((alibabaCrawlProgress.created || 0) % 400 < added.length) {
          logActivity({
            action: '阿里公开列表',
            detail: `已入库 ${alibabaCrawlProgress.created} 条（${alibabaCrawlProgress.slice || ''} 第 ${alibabaCrawlProgress.page} 页）`,
          });
        }
      },
    }).then((r) => ({
      key: 'alibaba_public',
      name: '阿里国际站公开 RFQ',
      items: doImport ? [] : r.items,
      extra: { pages: r.pages, totalItems: r.totalItems, kept: r.items.length, created: alibabaCrawlProgress.created || 0 },
    }))),
    add('usaspending', searchUsaspending({ limit: govLimit, since, broad: true })
      .then((items) => ({ key: 'usaspending', name: 'USASpending.gov', items }))),
    add('uk', searchUk({ keyword: '', limit: govLimit, since })
      .then((items) => ({ key: 'uk', name: 'UK Contracts Finder', items }))),
    add('ted', searchTed({ keyword: '', limit: Math.min(govLimit, 100), since })
      .then((items) => ({ key: 'ted', name: 'TED Europa', items }))),
    add('worldbank', searchWorldBank({ keyword: '', limit: govLimit, since })
      .then((items) => ({ key: 'worldbank', name: 'World Bank', items }))),
    add('goldsupplier', searchGoldSupplier({ since, maxPages: 12 })
      .then((items) => ({ key: 'goldsupplier', name: 'GoldSupplier 公开询盘', items }))),
    add('tradeindia', searchTradeIndia({ since })
      .then((items) => ({ key: 'tradeindia', name: 'TradeIndia 公开买盘', items }))),
  ].filter(Boolean));

  const items = [];
  for (const r of buckets) {
    if (r.status === 'fulfilled') {
      items.push(...r.value.items);
      reports.push({
        key: r.value.key,
        name: r.value.name,
        ok: true,
        count: r.value.extra?.kept ?? r.value.items.length,
        ...(r.value.extra || {}),
      });
    } else {
      reports.push({ key: 'unknown', name: 'source', ok: false, count: 0, error: String(r.reason?.message || r.reason) });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = `${(it.source || '').toLowerCase()}|${it.awardId || it.url || it.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }
  const created = doImport ? importRfqItems(unique, { quiet: true }) : [];
  const aliCreated = Number(alibabaCrawlProgress.created || 0);
  return {
    since,
    items: unique,
    reports,
    createdCount: created.length + aliCreated,
    created,
  };
}

function firstText(row, keys) {
  for (const k of keys) {
    if (row?.[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return '';
}

export function normalizeIngestItem(raw, sourceName = '商业导入') {
  const row = raw && typeof raw === 'object' ? raw : {};
  const ali = parseAlibabaExportRow(row);
  const paid = normalizePaidExportRow(row);
  const company = ali.company || paid.company || firstText(row, ['company', 'companyName', 'organisation', 'organization', 'buyer', 'org']);
  const name = ali.name || paid.name || firstText(row, ['name', 'contact', 'contactName', 'buyerName']) || company || 'Unknown buyer';
  const email = ali.email || paid.email || firstText(row, ['email', 'contactEmail', 'buyerEmail']);
  const country = ali.country || paid.country || firstText(row, ['country', 'countryName', 'nation']);
  const title = ali.title || paid.title || firstText(row, ['title', 'subject', 'rfqTitle']);
  const pain = ali.painPoints || paid.painPoints || firstText(row, ['painPoints', 'description', 'summary', 'requirement']) || title;
  const url = ali.url || paid.url || firstText(row, ['url', 'link', 'sourceUrl', 'href']);
  return lead({
    id: ali.awardId || firstText(row, ['id', 'rfqId', 'awardId']) || `ingest_${cryptoRandom()}`,
    source: firstText(row, ['source']) || sourceName,
    sourceType: 'commercial_ingest',
    kind: 'commercial',
    title,
    company: company || name,
    name,
    titleRole: firstText(row, ['titleRole', 'role', 'jobTitle']) || 'Buyer',
    email,
    country,
    timezone: firstText(row, ['timezone', 'tz']) || guessTimezone(country, 'UTC'),
    industry: firstText(row, ['industry', 'category']),
    url,
    awardId: ali.awardId || firstText(row, ['awardId', 'rfqId', 'id']),
    amount: Number(row.amount || row.value || 0) || 0,
    currency: firstText(row, ['currency']),
    painPoints: pain,
  });
}

function cryptoRandom() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseIngestPayload(body = {}) {
  const sourceName = body.source || body.provider || '商业导入';
  let rows = [];
  if (Array.isArray(body)) rows = body;
  else if (Array.isArray(body.items)) rows = body.items;
  else if (Array.isArray(body.leads)) rows = body.leads;
  else if (body.company || body.email || body.name) rows = [body];
  return rows.map((row) => normalizeIngestItem(row, sourceName));
}

export function ingestCommercial(body = {}) {
  const items = parseIngestPayload(body);
  return { items, created: importRfqItems(items) };
}

export { crawlAlibabaPublic, ALIBABA_PUBLIC_FIELDS, PUBLIC_SINCE_DEFAULT };
export const RFQ_CATALOG = listSources();

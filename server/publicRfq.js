// 只拉免登录就能看到的公开询盘列表，不登录、不绕验证码、不收集隐藏邮箱。
import { extractCompanyHintFromText } from './rfqHints.js';

export const PUBLIC_SINCE_DEFAULT = '2026-07-01';

export const ALIBABA_PUBLIC_FIELDS = [
  'rfqId', 'enrRfqId', 'subject', 'description', 'buyerName', 'country', 'countrySimple',
  'quantity', 'quantityUnit', 'quantityValue', 'quantityValueUnit',
  'openTimeStr', 'postedAt', 'expirationTime', 'url', 'imageUrl',
  'haveAnnexes', 'hasQuoEquity', 'rfqStarLevel', 'rfqLevel', 'buyerLevel',
  'orderValue', 'orderValueUnit', 'formPurposeCountry', 'formPurposeCountryName',
  'quoteLeftCount', 'quoteExtraCount', 'qualityScore',
];

const LIST_URL = 'https://sourcing.alibaba.com/rfq/rfq_search_list.htm';
const PAGE_SIZE = 20;
const GAP_MS = 1100;

function decodeAli(s) {
  return String(s || '')
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é')
    .replace(/&oacute;/g, 'ó')
    .replace(/\s+/g, ' ')
    .trim();
}

function strField(block, name) {
  const m = block.match(new RegExp(`${name}:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)')`));
  return decodeAli(m?.[1] ?? m?.[2] ?? '');
}

function numField(block, name) {
  const m = block.match(new RegExp(`${name}:\\s*(?:parseInt\\("(\\d+)"|'(\\d+)'|(\\d+))`));
  return Number(m?.[1] || m?.[2] || m?.[3] || 0);
}

function boolField(block, name) {
  const m = block.match(new RegExp(`${name}:\\s*(true|false)`));
  return m?.[1] === 'true';
}

export function parseOpenTime(str, now = new Date()) {
  const s = String(str || '').toLowerCase();
  if (!s) return null;
  if (/just now|刚刚/.test(s)) return now;
  const iso = s.match(/(\d{4}-\d{2}-\d{2})(?:[ t](\d{2}:\d{2}(?::\d{2})?))?/);
  if (iso) {
    const d = new Date(iso[2] ? `${iso[1]}T${iso[2]}Z` : `${iso[1]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const m = s.match(/(\d+)\s*(minute|hour|day|week|min|hr)/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit.startsWith('min') ? n * 60e3
    : unit.startsWith('hour') || unit === 'hr' ? n * 3600e3
      : unit.startsWith('week') ? n * 7 * 86400e3
        : n * 86400e3;
  return new Date(now.getTime() - ms);
}

export function extractAlibabaPublicBlocks(html) {
  const marker = 'window.PAGE_DATA["index"].data.push(';
  return String(html || '').split(marker).slice(1).map((chunk) => {
    const end = chunk.indexOf('});');
    return end >= 0 ? chunk.slice(0, end) : chunk.slice(0, 5000);
  });
}

export function parseAlibabaPublicHtml(html) {
  const items = [];
  for (const block of extractAlibabaPublicBlocks(html)) {
    const rfqId = strField(block, 'rfqId') || strField(block, 'id');
    const subject = strField(block, 'subject');
    if (!rfqId && !subject) continue;
    const openTimeStr = strField(block, 'openTimeStr');
    const postedAt = parseOpenTime(openTimeStr);
    const url = strField(block, 'url');
    items.push({
      rfqId,
      enrRfqId: strField(block, 'enrRfqId'),
      subject,
      description: strField(block, 'description'),
      buyerName: strField(block, 'buyerName'),
      country: strField(block, 'country'),
      countrySimple: strField(block, 'countrySimple'),
      quantity: strField(block, 'quantity') || String(numField(block, 'quantity') || ''),
      quantityUnit: strField(block, 'quantityUnit'),
      quantityValue: strField(block, 'quantityValue'),
      quantityValueUnit: strField(block, 'quantityValueUnit'),
      openTimeStr,
      postedAt: postedAt ? postedAt.toISOString() : '',
      expirationTime: strField(block, 'expirationTime'),
      url: url.startsWith('//') ? `https:${url}` : url,
      imageUrl: strField(block, 'imageUrl'),
      haveAnnexes: boolField(block, 'haveAnnexes'),
      hasQuoEquity: boolField(block, 'hasQuoEquity'),
      rfqStarLevel: numField(block, 'rfqStarLevel'),
      rfqLevel: strField(block, 'rfqLevel') || String(numField(block, 'rfqLevel') || ''),
      buyerLevel: strField(block, 'buyerLevel') || String(numField(block, 'buyerLevel') || ''),
      orderValue: strField(block, 'orderValue'),
      orderValueUnit: strField(block, 'orderValueUnit'),
      formPurposeCountry: strField(block, 'formPurposeCountry'),
      formPurposeCountryName: strField(block, 'formPurposeCountryName'),
      quoteLeftCount: numField(block, 'quoteLeftCount'),
      quoteExtraCount: numField(block, 'quoteExtraCount'),
      qualityScore: strField(block, 'qualityScore') || String(numField(block, 'qualityScore') || ''),
    });
  }
  const totalItems = Number((html.match(/pageView\.totalItems = '(\d+)'/) || [])[1] || items.length);
  const currentPage = Number((html.match(/pageView\.currentPage = '(\d+)'/) || [])[1] || 1);
  const totalPages = Number((html.match(/pageView\.totalPages = '(\d+)'/) || [])[1] || 1);
  const categoryIds = [...new Set([...String(html).matchAll(/categoryIds=(\d+)/g)].map((m) => m[1]))];
  const countries = [...String(html).matchAll(/"count":(\d+),"item":"([A-Z]{2})"/g)]
    .map((m) => ({ code: m[2], count: Number(m[1]) }))
    .sort((a, b) => b.count - a.count);
  return { items, totalItems, currentPage, totalPages, categoryIds, countries };
}

export function toLead(row) {
  const qty = [row.quantity, row.quantityUnit].filter(Boolean).join(' ');
  const when = row.openTimeStr || row.postedAt || '';
  const hint = extractCompanyHintFromText(row.description);
  const extras = [
    row.haveAnnexes ? '列表标记有附件（附件在登录墙后，不下载）' : '',
    row.imageUrl ? '列表有公开缩略图' : '',
    hint ? `正文写到公司 ${hint}` : '',
  ].filter(Boolean).join('；');
  return {
    id: `alipub_${row.rfqId || row.subject}`,
    source: '阿里国际站公开 RFQ',
    sourceType: 'alibaba_public_list',
    kind: 'commercial',
    title: row.subject,
    company: hint || row.buyerName || row.subject || 'Alibaba buyer',
    name: row.buyerName || 'Alibaba buyer',
    titleRole: 'Buyer',
    email: '',
    country: row.country || row.countrySimple || '',
    timezone: '',
    industry: 'B2B RFQ',
    url: row.url || (row.rfqId ? `https://sourcing.alibaba.com/rfq_detail.htm?rfqId=${row.rfqId}` : ''),
    awardId: String(row.rfqId || ''),
    amount: Number(row.quantity) || 0,
    postedAt: row.postedAt,
    imageUrl: row.imageUrl || '',
    haveAnnexes: Boolean(row.haveAnnexes),
    identitySource: hint ? 'rfq_text' : '',
    postedAt: row.postedAt || '',
    publicCard: { ...row },
    painPoints: `公开询盘：${row.subject || ''}${qty ? `，数量 ${qty}` : ''}${row.country ? `，${row.country}` : ''}${when ? `，发布 ${when}` : ''}。${(row.description || '').slice(0, 400)} 列表页无邮箱。${extras}`,
  };
}

function sinceMs(since) {
  const d = new Date(since || PUBLIC_SINCE_DEFAULT);
  return Number.isNaN(d.getTime()) ? new Date(`${PUBLIC_SINCE_DEFAULT}T00:00:00Z`).getTime() : d.getTime();
}

function keepSince(row, since) {
  if (!row.postedAt) return true;
  return new Date(row.postedAt).getTime() >= sinceMs(since);
}

async function fetchListPage({ keyword = '', page = 1, categoryIds = '', country = '', openTime = '', timeoutMs = 20000 } = {}) {
  const qs = new URLSearchParams({ recently: 'Y', page: String(page) });
  if (keyword) qs.set('searchText', keyword);
  if (categoryIds) qs.set('categoryIds', String(categoryIds));
  if (country) qs.set('country', country);
  if (openTime) qs.set('openTime', openTime);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${LIST_URL}?${qs}`, {
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; OutreachAI/1.0; public RFQ list)',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`阿里公开列表 ${res.status}`);
    return parseAlibabaPublicHtml(await res.text());
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function searchAlibabaPublic({
  keyword = 'power tools',
  limit = 40,
  since = PUBLIC_SINCE_DEFAULT,
  maxPages,
} = {}) {
  const pages = Math.max(1, Math.min(maxPages || Math.ceil(limit / PAGE_SIZE) || 2, 100));
  const seen = new Set();
  const items = [];
  let totalItems = 0;
  let totalPages = 1;
  for (let page = 1; page <= pages; page++) {
    if (page > 1) await sleep(GAP_MS);
    const data = await fetchListPage({ keyword, page });
    totalItems = data.totalItems;
    totalPages = data.totalPages;
    for (const row of data.items) {
      if (!keepSince(row, since)) continue;
      const key = row.rfqId || row.url || row.subject;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(toLead(row));
      if (items.length >= limit) {
        return { items, reportsMeta: { pages: page, totalItems, totalPages } };
      }
    }
    if (page >= data.totalPages) break;
  }
  return { items, reportsMeta: { pages, totalItems, totalPages } };
}

export const alibabaCrawlProgress = {
  pagesFetched: 0, kept: 0, created: 0, country: '', category: '', page: 0, slice: '',
};

export async function crawlAlibabaPublic({
  keyword = '',
  since = PUBLIC_SINCE_DEFAULT,
  maxPages = 100,
  fanout = true,
  onProgress,
  onBatch,
} = {}) {
  const cap = Math.max(1, Math.min(Number(maxPages) || 100, 100));
  alibabaCrawlProgress.created = alibabaCrawlProgress.created || 0;
  const seen = new Set();
  const items = [];
  let totalItems = 0;
  let pagesFetched = 0;
  const pageBudget = fanout ? 9000 : cap + 2;

  async function ingestPage(opts) {
    if (pagesFetched >= pageBudget) return { items: [], old: 0, totalPages: 1, totalItems: 0, exhausted: true };
    if (pagesFetched) await sleep(GAP_MS);
    const data = await fetchListPage(opts);
    pagesFetched += 1;
    totalItems = Math.max(totalItems, data.totalItems || 0);
    let old = 0;
    const fresh = [];
    for (const row of data.items) {
      if (!keepSince(row, since)) {
        old += 1;
        continue;
      }
      const key = row.rfqId || row.url || row.subject;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const lead = toLead(row);
      items.push(lead);
      fresh.push(lead);
    }
    const snap = {
      pagesFetched,
      kept: items.length,
      country: opts.country || '',
      category: opts.categoryIds || '',
      page: opts.page,
      slice: [opts.country, opts.categoryIds].filter(Boolean).join('/') || 'all',
    };
    Object.assign(alibabaCrawlProgress, snap);
    onProgress?.(snap);
    if (fresh.length && onBatch) await onBatch(fresh, snap);
    return { ...data, old };
  }

  async function crawlSlice(base, labelPages = cap) {
    const first = await ingestPage({ ...base, page: 1 });
    if (first.exhausted) return first;
    const pages = Math.min(labelPages, first.totalPages || labelPages);
    for (let page = 2; page <= pages; page++) {
      const data = await ingestPage({ ...base, page });
      if (data.exhausted) break;
      if (data.items.length && data.old === data.items.length) break;
      if (page >= (data.totalPages || 1)) break;
    }
    return first;
  }

  const first = await crawlSlice({ keyword });

  if (fanout && !keyword) {
    const countries = (first.countries || [])
      .filter((c) => c.count >= 40)
      .slice(0, 80);
    for (const { code, count } of countries) {
      const slice = await crawlSlice({ page: 1, country: code });
      const needCats = count > cap * PAGE_SIZE && (slice.old || 0) === 0;
      if (!needCats) continue;
      const cats = (slice.categoryIds || []).slice(0, 16);
      for (const cat of cats) {
        await crawlSlice({ country: code, categoryIds: cat });
      }
    }
  }

  return { items, pages: pagesFetched, totalItems, totalPages: first.totalPages, since, keyword };
}

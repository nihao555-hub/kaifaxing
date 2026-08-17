// 只拉免登录就能看到的公开询盘列表，不登录、不绕验证码、不收集隐藏邮箱。
import { extractCompanyHintFromText } from './rfqHints.js';
import { compactPublicCard } from './dataPersistence.js';

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
const GAP_MS = 80;
const CRAWL_CONCURRENCY = 12;

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
  return { items, totalItems, currentPage, totalPages, categoryIds, countries, categories: parseCategoryCatalog(html) };
}

export function parseCategoryCatalog(html) {
  const out = [];
  const seen = new Set();
  const re = /categoryIds=(\d+)&[^"]*"[^>]*>([^<]{2,80})</g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const id = m[1];
    const name = decodeAli(m[2]).replace(/\s+/g, ' ').trim();
    if (!id || !name || seen.has(id) || name.length > 60) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

export function postedDateOf(row) {
  const iso = String(row?.postedAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = parseOpenTime(row?.openTimeStr || '');
  return parsed ? parsed.toISOString().slice(0, 10) : '';
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
    postedDate: postedDateOf(row),
    categoryId: row.categoryId || '',
    categoryName: row.categoryName || '',
    product: row.subject || '',
    publicCard: compactPublicCard(row),
    painPoints: `公开询盘：${row.subject || ''}${qty ? `，数量 ${qty}` : ''}${row.country ? `，${row.country}` : ''}${when ? `，发布 ${when}` : ''}${row.categoryName ? `，品类 ${row.categoryName}` : ''}。${(row.description || '').slice(0, 400)} 列表页无邮箱。${extras}`,
  };
}

function sinceMs(since) {
  const d = new Date(since || PUBLIC_SINCE_DEFAULT);
  return Number.isNaN(d.getTime()) ? new Date(`${PUBLIC_SINCE_DEFAULT}T00:00:00Z`).getTime() : d.getTime();
}

function keepSince(row, since) {
  if (!since || since === 'all' || since === '*') return true;
  if (!row.postedAt) return true;
  return new Date(row.postedAt).getTime() >= sinceMs(since);
}

let crawlAbort = false;
export function requestCrawlAbort() {
  crawlAbort = true;
}
export function resetCrawlAbort() {
  crawlAbort = false;
}

async function fetchListPage({
  keyword = '', page = 1, categoryIds = '', country = '', openTime = '',
  silver = false, copper = false, timeoutMs = 20000,
} = {}) {
  const qs = new URLSearchParams({ recently: 'Y', page: String(page) });
  if (keyword) qs.set('searchText', keyword);
  if (categoryIds) qs.set('categoryIds', String(categoryIds));
  if (country) qs.set('country', country);
  if (openTime) qs.set('openTime', openTime);
  if (silver) qs.set('silverRfq', 'Y');
  if (copper) qs.set('copperRfq', 'Y');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(400 * attempt);
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
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`阿里公开列表 ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`阿里公开列表 ${res.status}`);
      return parseAlibabaPublicHtml(await res.text());
    } catch (err) {
      lastErr = err;
      if (String(err.message || err).includes('阿里公开列表 4') && !/429/.test(err.message)) throw err;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('阿里公开列表失败');
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
  workers: CRAWL_CONCURRENCY, etaMinutes: null,
};

async function runPool(tasks, n = CRAWL_CONCURRENCY) {
  const q = tasks.slice();
  await Promise.all(Array.from({ length: Math.min(n, q.length || 1) }, async () => {
    while (q.length && !crawlAbort) {
      const job = q.shift();
      if (!job) break;
      try {
        await job();
      } catch {
        /* skip a dead page/slice and keep the pool moving */
      }
    }
  }));
}

export async function crawlAlibabaPublic({
  keyword = '',
  since = PUBLIC_SINCE_DEFAULT,
  maxPages = 100,
  fanout = true,
  onProgress,
  onBatch,
  seedIds = [],
} = {}) {
  const cap = Math.max(1, Math.min(Number(maxPages) || 100, 100));
  resetCrawlAbort();
  alibabaCrawlProgress.created = alibabaCrawlProgress.created || 0;
  const seen = new Set((seedIds || []).map(String).filter(Boolean));
  const items = [];
  let kept = 0;
  let totalItems = 0;
  let pagesFetched = 0;
  let startedAt = Date.now();
  const pageBudget = fanout ? 16000 : cap + 2;
  const categoryById = new Map();

  function snapOf(opts) {
    const elapsed = Math.max(1, Date.now() - startedAt);
    const rate = pagesFetched / elapsed;
    const remaining = Math.max(0, pageBudget - pagesFetched);
    return {
      pagesFetched,
      kept,
      created: alibabaCrawlProgress.created || 0,
      country: opts.country || '',
      category: opts.categoryName || opts.categoryIds || '',
      page: opts.page,
      workers: CRAWL_CONCURRENCY,
      etaMinutes: rate > 0 ? Math.round((remaining / rate) / 60000) : null,
      slice: [opts.country, opts.categoryName || opts.categoryIds, opts.silver ? 'silver' : '', opts.copper ? 'copper' : '']
        .filter(Boolean).join('/') || 'all',
    };
  }

  async function ingestPage(opts) {
    if (crawlAbort || pagesFetched >= pageBudget) {
      return { items: [], old: 0, totalPages: 1, totalItems: 0, exhausted: true, aborted: crawlAbort };
    }
    let data;
    try {
      data = await fetchListPage(opts);
    } catch {
      return { items: [], old: 0, totalPages: 1, totalItems: 0, exhausted: false };
    }
    pagesFetched += 1;
    totalItems = Math.max(totalItems, data.totalItems || 0);
    for (const cat of data.categories || []) categoryById.set(cat.id, cat.name);
    let old = 0;
    const fresh = [];
    for (const row of data.items) {
      if (opts.categoryIds) {
        row.categoryId = String(opts.categoryIds);
        row.categoryName = opts.categoryName || categoryById.get(row.categoryId) || '';
      }
      if (!keepSince(row, since)) {
        old += 1;
        continue;
      }
      const key = row.rfqId || row.url || row.subject;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const lead = toLead(row);
      kept += 1;
      if (!onBatch) items.push(lead);
      fresh.push(lead);
    }
    const snap = snapOf(opts);
    Object.assign(alibabaCrawlProgress, snap);
    onProgress?.(snap);
    if (fresh.length && onBatch) await onBatch(fresh, snap);
    return { ...data, old };
  }

  async function crawlSlice(base) {
    const first = await ingestPage({ ...base, page: 1 });
    if (first.exhausted) return first;
    const pages = Math.min(cap, first.totalPages || 1);
    if (pages <= 1) return first;
    const rest = [];
    for (let page = 2; page <= pages; page++) {
      rest.push(() => ingestPage({ ...base, page }));
    }
    await runPool(rest, CRAWL_CONCURRENCY);
    return first;
  }

  async function crawlDeep(base) {
    const first = await crawlSlice(base);
    if (first.exhausted || first.aborted) return first;
    if ((first.totalItems || 0) <= cap * PAGE_SIZE) return first;
    if (!base.silver && !base.copper) {
      await runPool([
        () => crawlSlice({ ...base, silver: true }),
        () => crawlSlice({ ...base, copper: true }),
      ], 2);
    }
    return first;
  }

  const first = await ingestPage({ keyword, page: 1 });
  for (const cat of first.categories || []) categoryById.set(cat.id, cat.name);

  if (fanout && !keyword) {
    const catalog = first.categories?.length ? first.categories : [...categoryById].map(([id, name]) => ({ id, name }));
    const countries = (first.countries || []).filter((c) => c.count >= 1);
    const jobs = [];
    for (const { code, count } of countries) {
      if (count <= cap * PAGE_SIZE) {
        jobs.push(() => crawlSlice({ country: code }));
        continue;
      }
      for (const cat of catalog) {
        jobs.push(() => crawlDeep({ country: code, categoryIds: cat.id, categoryName: cat.name }));
      }
    }
    await runPool(jobs, CRAWL_CONCURRENCY);
  } else if ((first.totalPages || 1) > 1) {
    const pages = Math.min(cap, first.totalPages || 1);
    const rest = [];
    for (let page = 2; page <= pages; page++) rest.push(() => ingestPage({ keyword, page }));
    await runPool(rest, CRAWL_CONCURRENCY);
  }

  return {
    items: onBatch ? [] : items,
    pages: pagesFetched,
    totalItems,
    totalPages: first.totalPages,
    kept,
    since,
    keyword,
    aborted: crawlAbort,
  };
}

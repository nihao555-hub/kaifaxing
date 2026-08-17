// 免登录公开询盘列表。不绕 Cloudflare、不登录、不收集隐藏邮箱。

import { PUBLIC_SINCE_DEFAULT } from './publicRfq.js';

const GAP_MS = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; OutreachAI/1.0; public buy-lead list)',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    const html = await res.text();
    if (/just a moment|attention required|cf-ray|cloudflare/i.test(html) && html.length < 20000) {
      throw new Error('被 Cloudflare 拦截，已跳过（不绕过）');
    }
    return html;
  } finally {
    clearTimeout(t);
  }
}

function strip(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function sinceMs(since) {
  const d = new Date(since || PUBLIC_SINCE_DEFAULT);
  return Number.isNaN(d.getTime()) ? new Date(`${PUBLIC_SINCE_DEFAULT}T00:00:00Z`).getTime() : d.getTime();
}

function keepSince(iso, since) {
  if (!iso) return true;
  return new Date(iso).getTime() >= sinceMs(since);
}

function leadFrom({ id, source, sourceType, title, name, country, url, postedAt, description }) {
  return {
    id,
    source,
    sourceType,
    kind: 'commercial',
    title: title || '',
    company: name || title || 'Buyer',
    name: name || title || 'Buyer',
    titleRole: 'Buyer',
    email: '',
    country: country || '',
    timezone: '',
    industry: 'B2B RFQ',
    url,
    awardId: id.replace(/^[a-z]+_/, ''),
    amount: 0,
    postedAt: postedAt || '',
    painPoints: `公开询盘：${title || ''}${country ? `，${country}` : ''}${postedAt ? `，发布 ${postedAt.slice(0, 10)}` : ''}。${(description || '').slice(0, 180)} 列表页无邮箱。`,
  };
}

export function parseGoldSupplier(html) {
  const items = [];
  const blocks = String(html || '').split('class="inquiry-item"').slice(1);
  for (const block of blocks) {
    const um = block.match(/href="(https:\/\/www\.goldsupplier\.com\/[^"]+\/inquiry_(\d+)\.html)"/);
    if (!um) continue;
    const title = strip((block.match(/inquiry-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '')
      .replace(/\s*NEW\s*$/i, '').trim();
    const description = strip((block.match(/class="[^"]*details[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '');
    const country = strip((block.match(/<span class="text-neutral-3">([^<]+)<\/span>/) || [])[1] || '');
    const posted = strip((block.match(/Posted at:\s*([^<]+)/) || [])[1] || '');
    const postedAt = posted ? new Date(posted.replace(' ', 'T')).toISOString() : '';
    items.push({
      rfqId: um[2],
      title,
      description,
      country,
      postedAt,
      url: um[1],
    });
  }
  return items;
}

export async function searchGoldSupplier({ since = PUBLIC_SINCE_DEFAULT, maxPages = 12 } = {}) {
  const seen = new Set();
  const items = [];
  const pages = Math.max(1, Math.min(Number(maxPages) || 12, 20));
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await sleep(GAP_MS);
    const html = await fetchHtml(`https://www.goldsupplier.com/search/inquiry_top.html?p=${p}`);
    const rows = parseGoldSupplier(html);
    if (!rows.length) break;
    let older = 0;
    for (const row of rows) {
      if (!keepSince(row.postedAt, since)) {
        older += 1;
        continue;
      }
      if (seen.has(row.rfqId)) continue;
      seen.add(row.rfqId);
      items.push(leadFrom({
        id: `gold_${row.rfqId}`,
        source: 'GoldSupplier 公开询盘',
        sourceType: 'goldsupplier_public',
        title: row.title,
        name: row.country ? `${row.country} buyer` : row.title,
        country: row.country,
        url: row.url,
        postedAt: row.postedAt,
        description: row.description,
      }));
    }
    if (older === rows.length) break;
  }
  return items;
}

export function parseTradeIndia(html) {
  const items = [];
  const blocks = String(html || '').split('class="blBuyLeadsBox"').slice(1);
  for (const block of blocks) {
    const um = block.match(/href="(\/buyoffer\/(\d+)\/[^"]+)"/);
    if (!um) continue;
    const title = strip((block.match(/class="blTitle">\s*([^<]+)/) || [])[1] || '');
    const country = strip((block.match(/class="blCountry">[\s\S]*?<\/svg>\s*([^<]+)/) || block.match(/alt="map">\s*([^<]+)/) || [])[1] || '');
    const posted = strip((block.match(/class="blDate">([^<]+)/) || [])[1] || '');
    const looking = strip((block.match(/class="blLookingName">([^<]+)/) || [])[1] || '');
    const postedAt = posted ? new Date(posted).toISOString() : '';
    items.push({
      rfqId: um[2],
      title: title || looking,
      country,
      postedAt,
      url: `https://www.tradeindia.com${um[1]}`,
      description: looking ? `Buyer is looking for ${looking}` : '',
    });
  }
  return items;
}

export async function searchTradeIndia({ since = PUBLIC_SINCE_DEFAULT } = {}) {
  const html = await fetchHtml('https://www.tradeindia.com/TradeLeads/buy/');
  return parseTradeIndia(html)
    .filter((row) => keepSince(row.postedAt, since))
    .map((row) => leadFrom({
      id: `ti_${row.rfqId}`,
      source: 'TradeIndia 公开买盘',
      sourceType: 'tradeindia_public',
      title: row.title,
      name: row.country ? `${row.country} buyer` : row.title,
      country: row.country,
      url: row.url,
      postedAt: row.postedAt,
      description: row.description,
    }));
}

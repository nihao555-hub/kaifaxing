// 真正调用 GitHub 高星项目，而不是只抄它们的接口。
// 只用于公司主体 / 官网公开页，不接 theHarvester、Sherlock、holehe。
import * as cheerio from 'cheerio';
import { getDomain } from 'tldts';
import { findPhoneNumbersInText, parsePhoneNumberFromString } from 'libphonenumber-js';
import WBK, { simplify } from 'wikibase-sdk';
import Fuse from 'fuse.js';
import { whoisDomain } from 'whoiser';

export const GITHUB_TOOLS = [
  { id: 'cheerio', name: 'cheerio', repo: 'https://github.com/cheeriojs/cheerio', use: '解析官网 HTML、搜索结果页、mailto、联系页链接' },
  { id: 'search-dorks', name: '外贸搜索公式', repo: 'https://github.com/cheeriojs/cheerio', use: '法定名 + contact/procurement/info@ 公开搜索，解析官网和联系页' },
  { id: 'google-cse', name: 'Google Custom Search', repo: 'https://github.com/googleapis/google-api-nodejs-client', use: '官方 Custom Search JSON API，不抓谷歌 HTML、不绕验证码' },
  { id: 'serper', name: 'serper.dev', repo: 'https://github.com/serper-dev', use: '可选的谷歌 SERP JSON；CSE 没开通时用同一套外贸公式' },
  { id: 'tldts', name: 'tldts', repo: 'https://github.com/remusao/tldts', use: 'Public Suffix 域名核验' },
  { id: 'libphonenumber-js', name: 'libphonenumber-js', repo: 'https://github.com/catamphetamine/libphonenumber-js', use: '国际电话解析（Google libphonenumber）' },
  { id: 'wikibase-sdk', name: 'wikibase-sdk', repo: 'https://github.com/maxlath/wikibase-sdk', use: 'Wikidata 实体查询' },
  { id: 'fuse', name: 'Fuse.js', repo: 'https://github.com/krisk/Fuse', use: '主体名称模糊排序' },
  { id: 'whoiser', name: 'whoiser', repo: 'https://github.com/LayeredStudio/whoiser', use: '域名 WHOIS' },
  { id: 'waybackurls', name: 'waybackurls', repo: 'https://github.com/tomnomnom/waybackurls', use: 'Internet Archive CDX 找历史联系页' },
  { id: 'subfinder', name: 'subfinder', repo: 'https://github.com/projectdiscovery/subfinder', use: 'crt.sh 证书透明日志找同域主机' },
];

const UA = 'OutreachAI/1.0 (public due-diligence; +https://github.com/nihao555-hub/kaifaxing)';
const wbk = WBK({
  instance: 'https://www.wikidata.org',
  sparqlEndpoint: 'https://query.wikidata.org/sparql',
});

export function registrableDomain(host) {
  const raw = String(host || '').trim();
  if (!raw) return '';
  const domain = getDomain(raw.includes('://') ? raw : `https://${raw}`, { allowPrivateDomains: true });
  return (domain || String(host).replace(/^www\./i, '')).toLowerCase();
}

export function isAssetUrl(url) {
  return /\.(css|js|mjs|map|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|ico|mp4|webm)(\?|#|$)/i.test(String(url || ''));
}

export function loadPage(html) {
  return cheerio.load(String(html || ''), { xml: false });
}

export function pageTitle(html) {
  const $ = loadPage(html);
  return $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function pageText(html) {
  const $ = loadPage(html);
  $('script, style, noscript, svg, iframe').remove();
  return $('body').text() || $.root().text();
}

export function pageMeta(html) {
  const $ = loadPage(html);
  const og = (name) => $(`meta[property="og:${name}"]`).attr('content')
    || $(`meta[name="og:${name}"]`).attr('content')
    || '';
  return {
    title: og('title') || pageTitle(html),
    description: og('description') || $('meta[name="description"]').attr('content') || '',
    siteName: og('site_name') || '',
  };
}

export function mailtoFromHtml(html) {
  const $ = loadPage(html);
  const out = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    const email = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    if (email) out.push(email);
  });
  return out;
}

export function telFromHtml(html) {
  const $ = loadPage(html);
  const out = [];
  $('a[href^="tel:"]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    try {
      out.push(decodeURIComponent(href.replace(/^tel:/i, '')).trim());
    } catch {
      out.push(href.replace(/^tel:/i, '').trim());
    }
  });
  return out;
}

export function contactHrefs(html, pageUrl) {
  const $ = loadPage(html);
  const hrefs = [];
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (!/contact|kontakt|impressum|imprint|about|legal|enquiry|privacy|kontaktieren|contacto/i.test(href)) return;
    if (isAssetUrl(href)) return;
    try {
      const next = new URL(href, pageUrl);
      if (!/^https?:$/.test(next.protocol)) return;
      if (registrableDomain(new URL(pageUrl).hostname) !== registrableDomain(next.hostname)) return;
      if (isAssetUrl(next.pathname)) return;
      hrefs.push(next.toString());
    } catch { /* skip */ }
  });
  return [...new Set(hrefs)].slice(0, 12);
}

export function parsePhones(text, html = '') {
  const set = new Set();
  const add = (raw, country) => {
    const parsed = parsePhoneNumberFromString(String(raw || ''), country);
    if (parsed?.isValid()) {
      set.add(parsed.formatInternational());
      return;
    }
    const compact = String(raw || '').replace(/[^\d+]/g, '');
    if (compact.replace(/\D/g, '').length >= 8) set.add(String(raw).replace(/[()\s.-]+/g, ' ').trim());
  };
  for (const raw of telFromHtml(html)) add(raw);
  try {
    for (const hit of findPhoneNumbersInText(String(text || ''), 'US')) {
      if (hit.number?.isValid()) set.add(hit.number.formatInternational());
    }
  } catch { /* ignore */ }
  return [...set].slice(0, 8);
}

export function wikidataSearchUrl(query) {
  return wbk.searchEntities({ search: query, language: 'en', limit: 5, type: 'item' });
}

export function wikidataEntitiesUrl(ids) {
  const list = [...new Set(ids)].filter(Boolean).slice(0, 8);
  if (!list.length) return '';
  return wbk.getEntities({ ids: list, languages: ['en'] });
}

export function simplifyEntity(entity) {
  if (!entity) return null;
  try {
    return simplify.entity(entity, { timeConverter: 'simple-day', keepRichValues: false });
  } catch {
    return null;
  }
}

export function fuseRank(query, items, getLabel) {
  const list = items.map((hit, index) => ({ hit, label: String(getLabel(hit) || ''), index }));
  if (!list.length) return [];
  const fuse = new Fuse(list, {
    keys: ['label'],
    threshold: 0.34,
    includeScore: true,
    ignoreLocation: true,
  });
  return fuse.search(String(query || '')).map((row) => ({
    hit: row.item.hit,
    label: row.item.label,
    fuse: 1 - (row.score || 1),
  }));
}

async function getJson(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function waybackContactUrls(website) {
  let host = '';
  try { host = new URL(website.includes('://') ? website : `https://${website}`).hostname; } catch { return []; }
  const domain = registrableDomain(host);
  if (!domain) return [];
  const data = await getJson(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`${domain}/*`)}&output=json&fl=original&collapse=urlkey&filter=original:.*(contact|kontakt|impressum|imprint|about).*&limit=40`,
    10000
  );
  if (!Array.isArray(data) || data.length < 2) return [];
  const out = [];
  for (const row of data.slice(1)) {
    const original = String(row?.[0] || row || '');
    if (!original || isAssetUrl(original)) continue;
    try {
      const u = new URL(original);
      if (registrableDomain(u.hostname) !== domain) continue;
      if (!/contact|kontakt|impressum|imprint|about/i.test(u.pathname)) continue;
      out.push(`${u.protocol}//${u.host}${u.pathname}`);
    } catch { /* skip */ }
  }
  return [...new Set(out)].slice(0, 8);
}

export async function crtshHosts(website) {
  let host = '';
  try { host = new URL(website.includes('://') ? website : `https://${website}`).hostname; } catch { return []; }
  const domain = registrableDomain(host);
  if (!domain) return [];
  const data = await getJson(`https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`, 10000);
  if (!Array.isArray(data)) return [];
  const hosts = new Set();
  for (const row of data.slice(0, 80)) {
    for (const name of String(row.name_value || '').split('\n')) {
      const h = name.trim().toLowerCase().replace(/^\*\./, '');
      if (!h || h.includes(' ') || isAssetUrl(h)) continue;
      if (registrableDomain(h) !== domain) continue;
      hosts.add(h);
    }
  }
  const preferred = [...hosts].filter((h) => /^(www|contact|info|mail|enquiry|enquiries)\./.test(h) || h === domain);
  return (preferred.length ? preferred : [...hosts]).slice(0, 6);
}

export async function whoisFacts(website) {
  const domain = registrableDomain(website);
  if (!domain) return null;
  try {
    const data = await whoisDomain(domain, { timeout: 7000 });
    const first = data && typeof data === 'object' ? Object.values(data)[0] : null;
    const rec = first && typeof first === 'object' ? first : data;
    if (!rec || typeof rec !== 'object') return null;
    const created = rec.CreatedDate || rec.CreationDate || rec.created || rec['Creation Date'] || '';
    const registrar = rec.Registrar || rec.registrar || rec['Registrar Name'] || '';
    const org = rec.RegistrantOrganization || rec['Registrant Organization'] || rec.Org || '';
    return {
      domain,
      created: String(created).slice(0, 10),
      registrar: String(registrar || '').slice(0, 80),
      org: String(org || '').slice(0, 80),
    };
  } catch {
    return null;
  }
}

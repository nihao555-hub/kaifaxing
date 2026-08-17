import * as cheerio from 'cheerio';
import { config, googleCseReady, serperReady } from './config.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const EMAIL_RE = /[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,24}/g;

const LEGAL_STOP = new Set([
  'limited', 'ltd', 'inc', 'incorporated', 'llc', 'gmbh', 'mbh', 'sarl', 'plc', 'corp',
  'corporation', 'company', 'the', 'and', 'of', 'for', 'und',
]);

/** 单独出现时不能当公司证据：地名、河名、通用机构词 */
const WEAK_TOKENS = new Set([
  'tyne', 'wear', 'coast', 'city', 'county', 'group', 'services', 'international', 'national',
  'united', 'general', 'first', 'east', 'west', 'north', 'south', 'river', 'trust', 'college',
  'university', 'school', 'hospital', 'council', 'department', 'ministry', 'authority',
  'london', 'washington', 'crescent', 'federal', 'security', 'prime', 'webcam',
  'lawrence', 'fermi', 'magellan', 'consortium', 'association',
]);

export function quotedName(company) {
  return `"${String(company || '').replace(/"/g, '').trim()}"`;
}

export function companyTokens(company) {
  return String(company || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !LEGAL_STOP.has(t));
}

export function hostFromWebsite(website) {
  try {
    const raw = String(website || '').trim();
    if (!raw) return '';
    const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function sameSiteHost(url, siteHost) {
  const host = hostFromWebsite(url);
  const site = String(siteHost || '').replace(/^www\./i, '').toLowerCase();
  if (!host || !site) return false;
  return host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`);
}

/** 询盘国家 → 公开站点后缀。用来收窄官网/Impressum，不是猜私人邮箱。 */
const COUNTRY_TLD = {
  'united kingdom': 'uk', uk: 'uk', gb: 'uk', 英国: 'uk',
  'united states': 'us', usa: 'us', us: 'us', 美国: 'us',
  germany: 'de', de: 'de', 德国: 'de',
  france: 'fr', fr: 'fr', 法国: 'fr',
  netherlands: 'nl', nl: 'nl', 荷兰: 'nl',
  india: 'in', in: 'in', 印度: 'in',
  'united arab emirates': 'ae', uae: 'ae', ae: 'ae', 阿联酋: 'ae',
  chile: 'cl', cl: 'cl', 智利: 'cl',
  philippines: 'ph', ph: 'ph', 菲律宾: 'ph',
  turkey: 'tr', tr: 'tr', 土耳其: 'tr',
  pakistan: 'pk', pk: 'pk', 巴基斯坦: 'pk',
  australia: 'au', au: 'au', 澳大利亚: 'au',
  jamaica: 'jm', jm: 'jm',
  spain: 'es', es: 'es', 西班牙: 'es',
  italy: 'it', it: 'it', 意大利: 'it',
  poland: 'pl', pl: 'pl', 波兰: 'pl',
  austria: 'at', at: 'at', 奥地利: 'at',
  finland: 'fi', fi: 'fi', 芬兰: 'fi',
  'czech republic': 'cz', czech: 'cz', cze: 'cz', 捷克: 'cz',
  portugal: 'pt', pt: 'pt', 葡萄牙: 'pt',
  belgium: 'be', be: 'be', 比利时: 'be',
  sweden: 'se', se: 'se', 瑞典: 'se',
  norway: 'no', no: 'no', 挪威: 'no',
  denmark: 'dk', dk: 'dk', 丹麦: 'dk',
  switzerland: 'ch', ch: 'ch', 瑞士: 'ch',
  canada: 'ca', ca: 'ca', 加拿大: 'ca',
  mexico: 'mx', mx: 'mx', 墨西哥: 'mx',
  brazil: 'br', br: 'br', 巴西: 'br',
  'south africa': 'za', za: 'za', 南非: 'za',
  singapore: 'sg', sg: 'sg', 新加坡: 'sg',
  malaysia: 'my', my: 'my', 马来西亚: 'my',
  indonesia: 'id', id: 'id', 印尼: 'id',
  thailand: 'th', th: 'th', 泰国: 'th',
  vietnam: 'vn', vn: 'vn', 越南: 'vn',
  japan: 'jp', jp: 'jp', 日本: 'jp',
  'south korea': 'kr', korea: 'kr', kr: 'kr', 韩国: 'kr',
  'saudi arabia': 'sa', saudi: 'sa', sa: 'sa', 沙特: 'sa',
  egypt: 'eg', eg: 'eg', 埃及: 'eg',
  ireland: 'ie', ie: 'ie', 爱尔兰: 'ie',
  'new zealand': 'nz', nz: 'nz',
};

export function countryTld(country) {
  const key = String(country || '').trim().toLowerCase();
  if (!key) return '';
  if (COUNTRY_TLD[key]) return COUNTRY_TLD[key];
  const hit = Object.keys(COUNTRY_TLD).find((k) => key.includes(k) && k.length >= 4);
  return hit ? COUNTRY_TLD[hit] : '';
}

const COUNTRY_ALIASES = {
  ae: ['UAE', 'Dubai', '"Abu Dhabi"', '"United Arab Emirates"'],
  uk: ['UK', 'Britain', '"United Kingdom"'],
  us: ['USA', '"United States"'],
  de: ['Germany', 'Deutschland'],
  fr: ['France'],
  nl: ['Netherlands', 'Holland'],
  in: ['India'],
  cl: ['Chile', 'Santiago'],
  ph: ['Philippines', 'Manila'],
  tr: ['Turkey', 'Türkiye', 'Istanbul'],
  pk: ['Pakistan', 'Karachi', 'Lahore'],
  au: ['Australia'],
  es: ['Spain'],
  it: ['Italy'],
  pl: ['Poland'],
  at: ['Austria'],
  fi: ['Finland'],
  cz: ['Czech'],
  pt: ['Portugal'],
  be: ['Belgium'],
  se: ['Sweden'],
  no: ['Norway'],
  dk: ['Denmark'],
  ch: ['Switzerland'],
  ca: ['Canada'],
  mx: ['Mexico'],
  br: ['Brazil'],
  za: ['"South Africa"'],
  sg: ['Singapore'],
  my: ['Malaysia'],
  id: ['Indonesia'],
  th: ['Thailand'],
  vn: ['Vietnam'],
  jp: ['Japan'],
  kr: ['Korea'],
  sa: ['"Saudi Arabia"', 'Riyadh'],
  eg: ['Egypt'],
  ie: ['Ireland'],
  nz: ['"New Zealand"'],
};

export function countrySearchTerms(country) {
  const tld = countryTld(country);
  const aliases = COUNTRY_ALIASES[tld] || [];
  const raw = String(country || '').replace(/"/g, '').trim();
  const extra = raw && raw.length >= 3 && !aliases.some((a) => a.replace(/"/g, '').toLowerCase() === raw.toLowerCase())
    ? [`"${raw}"`]
    : [];
  return [...new Set([...aliases, ...extra])];
}

export function countryOrClause(country) {
  const terms = countrySearchTerms(country);
  if (!terms.length) return '';
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

const PRODUCT_STOP = new Set([
  'piece', 'pieces', 'quantity', 'hello', 'looking', 'need', 'public', 'rfq', 'alibaba',
  'buyer', 'please', 'thank', 'thanks', 'quote', 'quotation', 'inquiry', 'enquiry',
  'days', 'ago', 'before', 'released', 'posted', 'country', 'unit', 'units',
  'hope', 'well', 'dear', 'sir', 'madam', 'kindly', 'wanted', 'want',
]);

export function rfqProductTerms(text, { max = 3 } = {}) {
  const raw = String(text || '')
    .replace(/公开询盘：/g, ' ')
    .replace(/列表页无邮箱[\s\S]*$/g, ' ')
    .replace(/数量[^，,]*/g, ' ');
  const words = raw
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !PRODUCT_STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, max);
}

export function hostFitsCountry(url, country) {
  const tld = countryTld(country);
  const host = hostFromWebsite(url);
  if (!host || !country) return false;
  if (tld && (host === tld || host.endsWith(`.${tld}`) || host.endsWith(`.co.${tld}`) || host.endsWith(`.com.${tld}`))) {
    return true;
  }
  const aliases = countrySearchTerms(country).map((s) => s.replace(/"/g, '').toLowerCase().replace(/\s+/g, ''));
  return aliases.some((a) => a.length >= 3 && host.includes(a));
}

export function searchLabel(company) {
  return String(company || '')
    .replace(/\b(l\.?l\.?c\.?|limited|ltd\.?|inc\.?|incorporated|gmbh|pvt|pty|s\.?p\.?a\.?|s\.?a\.?)\b/gi, ' ')
    .replace(/[(),.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DACH = new Set(['de', 'at', 'ch']);

/** 给谷歌/Serper 用的短公式。不搜 "info@"——索引里几乎没有这个字面量。 */
export function researchDorks(company, { website, country, product } = {}) {
  const q = quotedName(searchLabel(company) || company);
  if (q.length < 5) return [];
  const host = hostFromWebsite(website);
  const tld = countryTld(country);
  const place = countryOrClause(country);
  const products = Array.isArray(product)
    ? product.filter(Boolean).slice(0, 3)
    : rfqProductTerms(product);
  const productClause = products.length ? `(${products.map((p) => `"${String(p).replace(/"/g, '')}"`).join(' OR ')})` : '';
  const impressum = DACH.has(tld) ? ' OR impressum OR kontakt' : '';
  const out = [];
  if (host) {
    out.push(`site:${host} (contact OR "contact us" OR "get in touch" OR email${impressum})`);
    out.push(`site:${host} (inurl:contact OR inurl:about${DACH.has(tld) ? ' OR inurl:impressum' : ''})`);
    out.push(place ? `${q} ${place} (official OR website OR contact)` : `${q} (official website OR contact)`);
  } else {
    out.push(place ? `${q} ${place} (official website OR homepage OR contact)` : `${q} (official website OR homepage OR contact)`);
    if (place) out.push(`${q} ${place} (contact OR email)`);
    if (tld) out.push(`${q} site:.${tld} (contact OR website)`);
    if (productClause && place) out.push(`${q} ${place} ${productClause} (contact OR email)`);
    if (!place) out.push(`${q} (contact OR "contact us" OR email)`);
  }
  return [...new Set(out)];
}

export function searchPageUrl(engine, query) {
  const q = encodeURIComponent(query);
  if (engine === 'bing') return `https://www.bing.com/search?q=${q}&setlang=en-US`;
  if (engine === 'ddg') return `https://duckduckgo.com/?q=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

/** 给抽屉「用谷歌打开」：服务器抓不了谷歌时，人在浏览器里跑同一套公式 */
export function buildSearchLinks({ company, country, website, product } = {}) {
  return researchDorks(company, { country, website, product }).slice(0, 5).map((query) => ({
    query,
    google: searchPageUrl('google', query),
    bing: searchPageUrl('bing', query),
  }));
}

function tryDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function tryBase64Url(val) {
  const candidates = [val, String(val || '').replace(/^a1/i, '')];
  for (const v of candidates) {
    try {
      const decoded = Buffer.from(v, 'base64').toString('utf8');
      const m = decoded.match(/https?:\/\/[^\s"'<>\\]+/i);
      if (m) return m[0].replace(/[.,;)]+$/, '');
    } catch {
      /* ignore */
    }
  }
  return '';
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&');
}

export function decodeBingUrl(raw) {
  if (!raw) return '';
  let s = decodeEntities(raw);
  s = tryDecode(s);

  const uddg = s.match(/[?&]uddg=([^&]+)/i);
  if (uddg) {
    const out = tryDecode(uddg[1]);
    if (/^https?:\/\//i.test(out)) return out;
  }

  const u = s.match(/[?&]u=([^&]+)/i);
  if (u) {
    const val = tryDecode(u[1]);
    if (/^https?:\/\//i.test(val) && !/bing\.com\/ck\//i.test(val)) return val;
    const fromB64 = tryBase64Url(val);
    if (fromB64) return fromB64;
  }

  if (s.startsWith('//') && !/bing\.com\/ck\//i.test(s)) {
    s = `https:${s}`;
  }

  if (/^https?:\/\//i.test(s) && !/bing\.com\/ck\//i.test(s) && !/google\.[^/]+\/url\?/i.test(s) && !/duckduckgo\.com\/l\/\?/i.test(s)) {
    return s;
  }

  const gq = s.match(/\/url\?q=([^&]+)/i);
  if (gq) {
    const out = tryDecode(gq[1]);
    if (/^https?:\/\//i.test(out)) return out;
  }

  return '';
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return '';
  }
}

export function isJunkSearchHost(host) {
  return /(?:^|\.)(bing|microsoft|msn|google|gstatic|duckduckgo|brave|yahoo|yandex|baidu|facebook|fbcdn|linkedin|twitter|x\.com|instagram|youtube|pinterest|tiktok|reddit|quora|imdb|nytimes|wordle|github|nasa\.gov|space\.com|devpost|pitchbook|play\.google|alibaba|1688|made-in-china|globalsources|tradeindia|indiamart|xvideos|pornhub|xhamster|xnxx|onlyfans)\./i.test(
    `.${host}.`
  );
}

function isEncyclopediaHost(host) {
  return /wikipedia|wiktionary|britannica|definitions\.net|wikiwand|fandom\.com/i.test(host);
}

export function isUsefulResearchUrl(url, company) {
  const n = normalizeUrl(url);
  if (!n || !/^https?:\/\//i.test(n)) return false;
  let host = '';
  try {
    host = new URL(n).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (isJunkSearchHost(host)) return false;
  if (/\.(css|js|mjs|png|jpe?g|gif|svg|webp|woff2?|ico)(\?|$)/i.test(n)) return false;
  if (isEncyclopediaHost(host)) {
    const words = companyTokens(company).filter((w) => w.length > 3);
    const hits = words.filter((w) => n.toLowerCase().includes(w));
    return hits.length >= 2 || (hits.length === 1 && hits[0].length >= 6 && !WEAK_TOKENS.has(hits[0]));
  }
  return true;
}

export function scoreResearchUrl(url) {
  const u = String(url).toLowerCase();
  let s = 1;
  if (/contact|impressum|kontakt|procurement|purchasing|tender|rfq|enquiry|inquiry/i.test(u)) s += 4;
  if (/about|official|company|profile/i.test(u)) s += 2;
  if (/\.pdf(\?|$)/i.test(u)) s += 1;
  try {
    const p = new URL(url);
    if (p.pathname === '/' || p.pathname === '') s += 2;
  } catch {
    /* ignore */
  }
  return s;
}

export function resultRelevant(item, company) {
  const tokens = companyTokens(company);
  if (!tokens.length) return false;
  const title = String(item.title || '').toLowerCase();
  const desc = String(item.desc || item.description || '').toLowerCase();
  let host = '';
  try {
    host = new URL(item.url || item.link || '').hostname.toLowerCase();
  } catch {
    host = '';
  }
  const blob = `${title} ${host} ${desc}`;
  if (/wordle|udo kier|severance|quasar\b/i.test(blob)) return false;

  const inTitle = tokens.filter((t) => title.includes(t));
  const inHost = tokens.filter((t) => host.includes(t));
  const strongTitle = inTitle.filter((t) => !WEAK_TOKENS.has(t));
  const strongHost = inHost.filter((t) => !WEAK_TOKENS.has(t));
  if (strongHost.length && (strongTitle.length || inTitle.length)) return true;
  if (strongTitle.length >= 1 && inTitle.length >= 2) return true;
  if (inTitle.length >= 2) return true;
  if (inHost.length >= 2) return true;
  if (tokens.some((t) => t.length >= 6 && !WEAK_TOKENS.has(t) && (title.includes(t) || host.includes(t)))) return true;
  return false;
}

function citeToUrl(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  t = t.split(/[›»|]/)[0].trim();
  t = t.replace(/\s+/g, '');
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return `https://${t.split('/')[0]}`;
  return '';
}

export function emailsInQuery(query) {
  return [...new Set((String(query || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
}

export function addressFromSnippets(texts = []) {
  const blob = (texts || []).join('\n').replace(/\s+/g, ' ');
  const patterns = [
    /NO\.?\s*[A-Z0-9]+[,\s]+[A-Za-z0-9 .,'\/-]{8,90}P\.?O\.?\s*Box[:\s]*\d+[,\s-]+[A-Za-z .'-]{2,40}(?:UAE|United Arab Emirates)/i,
    /(?:Location[:.\s]+)?((?:NO\.?\s*)?[A-Z0-9]+[,\s]+[A-Za-z0-9 .,'\/-]{12,90}(?:P\.?O\.?\s*Box[:\s]*\d+)[,\s-]+[A-Za-z .'-]{2,40})/i,
    /((?:P\.?O\.?\s*Box[:\s]*\d+)[,\s-]+[A-Za-z .'-]{3,40}(?:Dubai|UAE|United Arab Emirates))/i,
    /([A-Za-z0-9 .,'-]{8,80}(?:Street|St|Road|Rd|Building|Bldg|Avenue|Ave)[A-Za-z0-9 .,'-]{0,60}(?:,\s*)?(?:Dubai|London|Berlin|Paris|Amsterdam|Singapore)[^.]{0,28})/i,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (!m) continue;
    const value = String(m[1] || m[0] || '')
      .replace(/^Location[:.\s]+/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[.;]+$/, '')
      .trim();
    if (value.length >= 16 && value.length <= 180) return value;
  }
  return '';
}

export function hoursFromSnippets(texts = []) {
  const blob = (texts || []).join('\n');
  const m = blob.match(/(?:Monday|Mon)\s*[-–to]+\s*(?:Saturday|Friday|Sunday|Sun)[:\s]*\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)\s*[-–to]+\s*\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

export function emailsFromSnippets(texts, { query = '' } = {}) {
  const ignore = new Set(emailsInQuery(query));
  const found = [];
  const seen = new Set();
  for (const text of texts || []) {
    for (const raw of String(text || '').match(EMAIL_RE) || []) {
      const email = raw.toLowerCase();
      if (seen.has(email) || ignore.has(email)) continue;
      seen.add(email);
      found.push(email);
    }
  }
  return found;
}

function acceptItem(url, company, item, { siteHost, country } = {}) {
  const n = normalizeUrl(url);
  if (!n || !isUsefulResearchUrl(n, company)) return '';
  if (siteHost && sameSiteHost(n, siteHost)) return n;
  if (country && hostFitsCountry(n, country)) {
    const host = hostFromWebsite(n);
    const tokens = companyTokens(company);
    if (tokens.some((t) => t.length >= 3 && host.includes(t))) return n;
  }
  if (item && (item.title || item.desc) && !resultRelevant({ ...item, url: n }, company)) return '';
  if (!item?.title && !item?.desc) {
    const tokens = companyTokens(company);
    let host = '';
    try { host = new URL(n).hostname.toLowerCase(); } catch { return ''; }
    const strong = tokens.filter((t) => t.length >= 4 && !WEAK_TOKENS.has(t) && host.includes(t));
    const weak = tokens.filter((t) => n.toLowerCase().includes(t));
    if (!strong.length && weak.length < 2) return '';
  }
  return n;
}

export function parseBingRss(xml, company, { siteHost, query, country } = {}) {
  const items = [];
  const urls = [];
  const seen = new Set();
  const snippetTexts = [];
  const blocks = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = decodeEntities((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const link = decodeEntities((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const desc = decodeEntities((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').trim();
    snippetTexts.push(title, desc);
    const n = acceptItem(link, company, { title, desc }, { siteHost, country });
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title, desc });
  }
  return { urls, items, snippetEmails: emailsFromSnippets(snippetTexts, { query }) };
}

export function parseSearchHtml(html, company, { siteHost, query, country } = {}) {
  const $ = cheerio.load(html || '');
  const urls = [];
  const items = [];
  const seen = new Set();
  const snippetTexts = [];

  const push = (raw, meta = {}) => {
    const decoded = decodeBingUrl(raw) || String(raw || '').trim();
    const n = acceptItem(decoded, company, meta, { siteHost, country });
    if (!n || seen.has(n)) return;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title: meta.title || '', desc: meta.desc || '' });
  };

  $('.result, .web-result, .links_main').each((_, el) => {
    const title = $(el).find('a.result__a, a.result-link').first().text().replace(/\s+/g, ' ').trim();
    const desc = $(el).find('.result__snippet, .result-snippet').first().text().replace(/\s+/g, ' ').trim();
    snippetTexts.push(title, desc);
    push($(el).find('a.result__a, a.result-link').attr('href') || '', { title, desc });
  });

  $('li.b_algo').each((_, el) => {
    const title = $(el).find('h2').first().text().replace(/\s+/g, ' ').trim();
    const desc = $(el).find('.b_caption p, p').first().text().replace(/\s+/g, ' ').trim();
    snippetTexts.push(title, desc);
    const href = $(el).find('h2 a').attr('href') || '';
    const cite = citeToUrl($(el).find('cite').first().text());
    push(href, { title, desc });
    push(cite, { title, desc });
  });

  $('cite').each((_, el) => {
    const title = $(el).closest('li').find('h2').first().text().replace(/\s+/g, ' ').trim();
    push(citeToUrl($(el).text()), { title });
  });

  $('a[href]').each((_, el) => {
    const title = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 160);
    push($(el).attr('href') || '', { title });
    push($(el).attr('data-url') || '', { title });
  });

  $('p, .b_caption, .result__snippet').each((_, el) => {
    if ($(el).closest('form, nav, header').length) return;
    snippetTexts.push($(el).text().replace(/\s+/g, ' ').trim());
  });

  return { urls, items, snippetEmails: emailsFromSnippets(snippetTexts, { query }) };
}

async function fetchSearch(url, accept = 'text/html,application/xhtml+xml,application/rss+xml') {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: accept,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  const html = res.ok ? await res.text() : '';
  return { html, status: res.status };
}

export async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US`;
  return fetchSearch(url);
}

export async function searchBingRss(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=en-US`;
  return fetchSearch(url, 'application/rss+xml, application/xml, text/xml');
}

export async function searchGoogle(query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gbv=1&hl=en&num=10`;
  return fetchSearch(url);
}

export async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  return fetchSearch(url);
}

export function searchEngineLabel(engine) {
  if (engine === 'google-cse' || engine === 'google') return '谷歌官方 API';
  if (engine === 'serper') return 'Serper（谷歌结果）';
  if (engine === 'ddg') return 'DuckDuckGo';
  if (engine === 'bing') return '必应';
  return '公开搜索';
}

export function parseGoogleCse(json, company, { siteHost, query, country } = {}) {
  const items = [];
  const urls = [];
  const seen = new Set();
  const snippetTexts = [];
  for (const raw of json?.items || []) {
    const title = String(raw.title || '').trim();
    const desc = String(raw.snippet || raw.htmlSnippet || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    snippetTexts.push(title, desc);
    const n = acceptItem(raw.link, company, { title, desc }, { siteHost, country });
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title, desc });
  }
  return { urls, items, snippetEmails: emailsFromSnippets(snippetTexts, { query }) };
}

export function parseSerper(json, company, { siteHost, query, country } = {}) {
  const items = [];
  const urls = [];
  const seen = new Set();
  const snippetTexts = [];
  for (const raw of json?.organic || []) {
    const title = String(raw.title || '').trim();
    const desc = String(raw.snippet || '').replace(/\s+/g, ' ').trim();
    snippetTexts.push(title, desc);
    const n = acceptItem(raw.link, company, { title, desc }, { siteHost, country });
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title, desc });
  }
  return { urls, items, snippetEmails: emailsFromSnippets(snippetTexts, { query }) };
}

function googleApiError(json, status) {
  return json?.error?.message || json?.message || `HTTP ${status}`;
}

export async function searchGoogleCse(query) {
  if (!googleCseReady()) return { ok: false, status: 0, error: '未配置 GOOGLE_API_KEY / GOOGLE_CSE_ID', json: null };
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', config.google.apiKey);
  url.searchParams.set('cx', config.google.cseId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: googleApiError(json, res.status), json };
  return { ok: true, status: res.status, error: '', json };
}

let serperDisabled = '';

export function serperBlockedReason() {
  return serperDisabled;
}

export async function searchSerper(query) {
  if (serperDisabled) return { ok: false, status: 400, error: serperDisabled, json: null };
  if (!serperReady()) return { ok: false, status: 0, error: '未配置 SERPER_API_KEY', json: null };
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.google.serperKey,
    },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = googleApiError(json, res.status);
    if (/credit|quota|limit/i.test(error)) serperDisabled = error;
    return { ok: false, status: res.status, error, json };
  }
  return { ok: true, status: res.status, error: '', json };
}

function isBlockedSearchPage(html) {
  if (!html || html.length < 400) return true;
  return /enablejs|enable javascript|unusual traffic|captcha|detected unusual/i.test(html)
    && !/<cite|\/url\?q=|result__a|<item>/i.test(html);
}

export function pickOfficialSite(urls, company, items = [], { country } = {}) {
  const tokens = companyTokens(company);
  const meta = new Map(items.map((it) => [normalizeUrl(it.url), it]));
  const placeWords = countrySearchTerms(country).map((s) => s.replace(/"/g, '').toLowerCase());
  const ranked = urls
    .map((u) => {
      let s = 0;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname;
        const it = meta.get(normalizeUrl(u)) || { title: '', desc: '' };
        const title = String(it.title || '').toLowerCase();
        const desc = String(it.desc || '').toLowerCase();
        const strongHost = tokens.filter((t) => !WEAK_TOKENS.has(t) && host.includes(t));
        const titleHits = tokens.filter((t) => title.includes(t));
        if (strongHost.length) s += 8;
        if (titleHits.length >= 2) s += 5;
        if (titleHits.some((t) => !WEAK_TOKENS.has(t))) s += 3;
        if (path === '/' || path === '') s += 3;
        else if (/contact|about|impressum|official/i.test(path)) s += 2;
        if (/\.edu$|\.ac\.|gov|go\.\w+$/i.test(host)) s += 1;
        if (hostFitsCountry(u, country)) s += 8;
        if (placeWords.some((w) => w.length >= 3 && (title.includes(w) || desc.includes(w) || host.includes(w.replace(/\s+/g, ''))))) s += 4;
        if (isEncyclopediaHost(host)) s -= 10;
        const shortBrand = tokens.filter((t) => t.length <= 4 && !WEAK_TOKENS.has(t));
        if (country && shortBrand.length && !hostFitsCountry(u, country)
          && !placeWords.some((w) => w.length >= 3 && (title.includes(w) || desc.includes(w)))) {
          s = 0;
        }
        if (!resultRelevant({ url: u, title: it.title, desc: it.desc }, company) && !strongHost.length) s = 0;
      } catch {
        /* ignore */
      }
      return { u, s };
    })
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.s >= 8 ? ranked[0].u : '';
}

function mergeParsed(into, extra) {
  const seen = new Set(into.urls);
  for (const u of extra.urls || []) {
    if (seen.has(u)) continue;
    seen.add(u);
    into.urls.push(u);
  }
  into.items.push(...(extra.items || []));
  into.snippetEmails.push(...(extra.snippetEmails || []));
}

async function searchOfficialGoogle(query, company, { siteHost, country } = {}) {
  if (googleCseReady()) {
    const cse = await searchGoogleCse(query);
    if (cse.ok) {
      return { engine: 'google-cse', parsed: parseGoogleCse(cse.json, company, { siteHost, query, country }), error: '' };
    }
    return { engine: '', parsed: { urls: [], items: [], snippetEmails: [] }, error: `谷歌官方 API ${cse.status}：${String(cse.error || '').slice(0, 80)}` };
  }
  if (serperReady()) {
    const serper = await searchSerper(query);
    if (serper.ok) {
      return { engine: 'serper', parsed: parseSerper(serper.json, company, { siteHost, query, country }), error: '' };
    }
    return { engine: '', parsed: { urls: [], items: [], snippetEmails: [] }, error: `Serper ${serper.status}：${String(serper.error || '').slice(0, 80)}` };
  }
  return { engine: '', parsed: { urls: [], items: [], snippetEmails: [] }, error: '' };
}

export async function searchCompanyPages(company, { maxQueries = 4, website, country, product } = {}) {
  const officialReady = googleCseReady() || serperReady();
  const queries = researchDorks(company, { website, country, product }).slice(0, officialReady ? Math.min(maxQueries, 4) : maxQueries);
  const siteHost = hostFromWebsite(website);
  const urls = [];
  const items = [];
  const snippetEmails = [];
  const seen = new Set();
  const notes = [];
  let engine = '';

  for (const query of queries) {
    const parsed = { urls: [], items: [], snippetEmails: [] };
    const wantHtml = /@|email|intitle:contact|site:/i.test(query);
    const preferGoogle = Boolean(country) && !siteHost && /UAE|Dubai|website OR contact|site:\./i.test(query);
    let triedDdg = false;
    const tryDdg = async () => {
      if (triedDdg) return;
      triedDdg = true;
      const ddg = await searchDuckDuckGo(query);
      if (ddg.status === 200 && ddg.html && !isBlockedSearchPage(ddg.html)) {
        mergeParsed(parsed, parseSearchHtml(ddg.html, company, { siteHost, query, country }));
        if (parsed.urls.length) engine = engine || 'ddg';
      }
    };
    try {
      if (officialReady) {
        const official = await searchOfficialGoogle(query, company, { siteHost, country });
        if (official.error && !notes.includes(official.error)) notes.push(official.error);
        mergeParsed(parsed, official.parsed);
        if (official.engine && (official.parsed.urls.length || official.parsed.snippetEmails.length)) {
          engine = engine || official.engine;
        }
      }

      if (!parsed.urls.length && !officialReady && preferGoogle) {
        const google = await searchGoogle(query);
        if (google.status === 200 && google.html && !isBlockedSearchPage(google.html)) {
          mergeParsed(parsed, parseSearchHtml(google.html, company, { siteHost, query, country }));
          if (parsed.urls.length) engine = engine || 'google';
        } else {
          notes.push('谷歌结果页被 JS/验证码挡住，已改用 DuckDuckGo / 必应公开结果');
          await tryDdg();
        }
      }

      if (!parsed.urls.length) {
        const rss = await searchBingRss(query);
        if (rss.status === 200 && rss.html && /<item>/i.test(rss.html)) {
          mergeParsed(parsed, parseBingRss(rss.html, company, { siteHost, query, country }));
          if (parsed.urls.length) engine = engine || 'bing';
        }

        if (wantHtml || !parsed.urls.length) {
          const bing = await searchBing(query);
          if (bing.status === 200 && bing.html && !isBlockedSearchPage(bing.html)) {
            mergeParsed(parsed, parseSearchHtml(bing.html, company, { siteHost, query, country }));
            if (parsed.urls.length) engine = engine || 'bing';
          } else if (bing.status && bing.status !== 200) {
            notes.push(`必应 ${bing.status}：${query.slice(0, 40)}`);
          }
        }
      }

      if (!officialReady && !preferGoogle && !parsed.urls.length && !parsed.snippetEmails.length) {
        const google = await searchGoogle(query);
        if (google.status === 200 && google.html && !isBlockedSearchPage(google.html)) {
          mergeParsed(parsed, parseSearchHtml(google.html, company, { siteHost, query, country }));
          if (parsed.urls.length) engine = engine || 'google';
        } else {
          notes.push('谷歌结果页被 JS/验证码挡住，已改用 DuckDuckGo / 必应公开结果');
          await tryDdg();
        }
      }

      if (!parsed.urls.length) await tryDdg();

      for (const u of parsed.urls) {
        if (seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      items.push(...(parsed.items || []));
      snippetEmails.push(...parsed.snippetEmails);
      if (parsed.urls.length) {
        notes.push(`${searchEngineLabel(engine)}公式命中 ${parsed.urls.length} 页：${query.slice(0, 52)}`);
      } else {
        notes.push(`公式无相关页：${query.slice(0, 48)}`);
      }
    } catch (e) {
      notes.push(`搜索失败：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, officialReady ? 400 : 800));
  }

  urls.sort((a, b) => scoreResearchUrl(b) - scoreResearchUrl(a));
  const officialGuess = pickOfficialSite(urls, company, items, { country });
  const intelTexts = items.flatMap((it) => [it.title, it.desc]);

  return {
    queries,
    links: buildSearchLinks({ company, country, website, product }),
    urls: urls.slice(0, 20),
    items: items.slice(0, 20),
    snippetEmails: [...new Set(snippetEmails)],
    snippetAddress: addressFromSnippets(intelTexts),
    snippetHours: hoursFromSnippets(intelTexts),
    officialGuess,
    engine,
    googleReady: officialReady,
    notes,
  };
}

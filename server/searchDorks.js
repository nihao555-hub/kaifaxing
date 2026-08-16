import * as cheerio from 'cheerio';

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

/** 外贸找联系方式的搜索公式：site:域名 + 角色邮箱 + 联系页 + PDF信头，不是扒私人邮箱 */
export function researchDorks(company, { website, country } = {}) {
  const q = quotedName(company);
  if (q.length < 5) return [];
  const host = hostFromWebsite(website);
  const tld = countryTld(country);
  const out = [];
  if (host) {
    out.push(`site:${host} (contact OR "contact us" OR impressum OR kontakt OR "info@" OR "sales@" OR "procurement@")`);
    out.push(`${q} ("@${host}" OR "info@" OR "sales@") site:${host}`);
    out.push(`site:${host} (inurl:impressum OR inurl:privacy OR inurl:legal OR "privacy policy")`);
    out.push(`${q} (contact OR "info@" OR procurement) filetype:pdf`);
  } else {
    out.push(`${q} (contact OR "contact us" OR impressum OR kontakt OR procurement OR purchasing)`);
    out.push(`${q} (info@ OR sales@ OR procurement@ OR purchasing@ OR enquiry@ OR inquiry@ OR contact@)`);
    if (tld) out.push(`${q} site:.${tld} (contact OR impressum OR "info@" OR inurl:contact)`);
    out.push(`${q} (contact OR "info@" OR procurement OR impressum) filetype:pdf`);
    out.push(`${q} (intitle:contact OR intitle:impressum OR "email us" OR "e-mail")`);
  }
  return out;
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

  if (/^https?:\/\//i.test(s) && !/bing\.com\/ck\//i.test(s) && !/google\.[^/]+\/url\?/i.test(s)) {
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

function acceptItem(url, company, item, { siteHost } = {}) {
  const n = normalizeUrl(url);
  if (!n || !isUsefulResearchUrl(n, company)) return '';
  if (siteHost && sameSiteHost(n, siteHost)) return n;
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

export function parseBingRss(xml, company, { siteHost, query } = {}) {
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
    const n = acceptItem(link, company, { title, desc }, { siteHost });
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title, desc });
  }
  return { urls, items, snippetEmails: emailsFromSnippets(snippetTexts, { query }) };
}

export function parseSearchHtml(html, company, { siteHost, query } = {}) {
  const $ = cheerio.load(html || '');
  const urls = [];
  const items = [];
  const seen = new Set();
  const snippetTexts = [];

  const push = (raw, meta = {}) => {
    const decoded = decodeBingUrl(raw) || String(raw || '').trim();
    const n = acceptItem(decoded, company, meta, { siteHost });
    if (!n || seen.has(n)) return;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title: meta.title || '', desc: meta.desc || '' });
  };

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

function isBlockedSearchPage(html) {
  if (!html || html.length < 400) return true;
  return /enablejs|enable javascript|unusual traffic|captcha|detected unusual/i.test(html)
    && !/<cite|\/url\?q=|result__a|<item>/i.test(html);
}

export function pickOfficialSite(urls, company, items = []) {
  const tokens = companyTokens(company);
  const meta = new Map(items.map((it) => [normalizeUrl(it.url), it]));
  const ranked = urls
    .map((u) => {
      let s = 0;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname;
        const it = meta.get(normalizeUrl(u)) || { title: '', desc: '' };
        const title = String(it.title || '').toLowerCase();
        const strongHost = tokens.filter((t) => !WEAK_TOKENS.has(t) && host.includes(t));
        const titleHits = tokens.filter((t) => title.includes(t));
        if (strongHost.length) s += 8;
        if (titleHits.length >= 2) s += 5;
        if (titleHits.some((t) => !WEAK_TOKENS.has(t))) s += 3;
        if (path === '/' || path === '') s += 3;
        else if (/contact|about|impressum|official/i.test(path)) s += 2;
        if (/\.edu$|\.ac\.|gov|go\.\w+$/i.test(host)) s += 1;
        if (isEncyclopediaHost(host)) s -= 10;
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

export async function searchCompanyPages(company, { maxQueries = 4, website, country } = {}) {
  const queries = researchDorks(company, { website, country }).slice(0, maxQueries);
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
    try {
      const rss = await searchBingRss(query);
      if (rss.status === 200 && rss.html && /<item>/i.test(rss.html)) {
        mergeParsed(parsed, parseBingRss(rss.html, company, { siteHost, query }));
        if (parsed.urls.length) engine = engine || 'bing';
      }

      if (wantHtml || !parsed.urls.length) {
        const bing = await searchBing(query);
        if (bing.status === 200 && bing.html && !isBlockedSearchPage(bing.html)) {
          mergeParsed(parsed, parseSearchHtml(bing.html, company, { siteHost, query }));
          if (parsed.urls.length) engine = engine || 'bing';
        } else if (bing.status && bing.status !== 200) {
          notes.push(`必应 ${bing.status}：${query.slice(0, 40)}`);
        }
      }

      if (!parsed.urls.length && !parsed.snippetEmails.length) {
        const google = await searchGoogle(query);
        if (google.status === 200 && google.html && !isBlockedSearchPage(google.html)) {
          mergeParsed(parsed, parseSearchHtml(google.html, company, { siteHost, query }));
          if (parsed.urls.length) engine = engine || 'google';
        } else if (google.html && isBlockedSearchPage(google.html)) {
          notes.push('谷歌结果页被 JS/验证码挡住，已改用必应公开结果');
        }
      }

      for (const u of parsed.urls) {
        if (seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
      }
      items.push(...(parsed.items || []));
      snippetEmails.push(...parsed.snippetEmails);
      if (parsed.urls.length) {
        notes.push(`${engine === 'google' ? '谷歌' : '必应'}公式命中 ${parsed.urls.length} 页：${query.slice(0, 52)}`);
      } else {
        notes.push(`公式无相关页：${query.slice(0, 48)}`);
      }
    } catch (e) {
      notes.push(`搜索失败：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  urls.sort((a, b) => scoreResearchUrl(b) - scoreResearchUrl(a));
  const officialGuess = pickOfficialSite(urls, company, items);

  return {
    queries,
    urls: urls.slice(0, 20),
    items: items.slice(0, 20),
    snippetEmails: [...new Set(snippetEmails)],
    officialGuess,
    engine,
    notes,
  };
}

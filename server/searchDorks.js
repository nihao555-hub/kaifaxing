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

/** 外贸背调常用公式：找官网、联系页、采购页，不是扒私人邮箱 */
export function researchDorks(company) {
  const q = quotedName(company);
  if (q.length < 5) return [];
  return [
    `${q} (contact OR "contact us" OR procurement OR purchasing OR impressum)`,
    `${q} (info@ OR procurement@ OR purchasing@ OR sales@)`,
    `${q} (official OR website OR "about us" OR homepage)`,
  ];
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
  return /(?:^|\.)(bing|microsoft|msn|google|gstatic|duckduckgo|brave|yahoo|yandex|baidu|facebook|fbcdn|linkedin|twitter|x\.com|instagram|youtube|pinterest|tiktok|reddit|quora|imdb|nytimes|wordle|github|nasa\.gov|space\.com|devpost|pitchbook|play\.google|xvideos|pornhub|xhamster|xnxx|onlyfans)\./i.test(
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

function acceptItem(url, company, item) {
  const n = normalizeUrl(url);
  if (!n || !isUsefulResearchUrl(n, company)) return '';
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

export function parseBingRss(xml, company) {
  const items = [];
  const urls = [];
  const seen = new Set();
  const blocks = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = decodeEntities((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const link = decodeEntities((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const desc = decodeEntities((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').trim();
    const n = acceptItem(link, company, { title, desc });
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title, desc });
  }
  const snippetEmails = [...new Set((String(xml || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
  return { urls, items, snippetEmails };
}

export function parseSearchHtml(html, company) {
  const $ = cheerio.load(html || '');
  const urls = [];
  const items = [];
  const seen = new Set();

  const push = (raw, meta = {}) => {
    const decoded = decodeBingUrl(raw) || String(raw || '').trim();
    const n = acceptItem(decoded, company, meta);
    if (!n || seen.has(n)) return;
    seen.add(n);
    urls.push(n);
    items.push({ url: n, title: meta.title || '', desc: meta.desc || '' });
  };

  $('li.b_algo').each((_, el) => {
    const title = $(el).find('h2').first().text().replace(/\s+/g, ' ').trim();
    const desc = $(el).find('.b_caption p, p').first().text().replace(/\s+/g, ' ').trim();
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

  const snippetEmails = [...new Set((String(html || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
  return { urls, items, snippetEmails };
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

export async function searchCompanyPages(company, { maxQueries = 2 } = {}) {
  const queries = researchDorks(company).slice(0, maxQueries);
  const urls = [];
  const items = [];
  const snippetEmails = [];
  const seen = new Set();
  const notes = [];
  let engine = '';

  for (const query of queries) {
    let parsed = { urls: [], items: [], snippetEmails: [] };
    try {
      const rss = await searchBingRss(query);
      if (rss.status === 200 && rss.html && /<item>/i.test(rss.html)) {
        parsed = parseBingRss(rss.html, company);
        if (parsed.urls.length) engine = engine || 'bing';
      }

      if (!parsed.urls.length) {
        const bing = await searchBing(query);
        if (bing.status === 200 && bing.html && !isBlockedSearchPage(bing.html)) {
          parsed = parseSearchHtml(bing.html, company);
          if (parsed.urls.length) engine = engine || 'bing';
        } else if (bing.status && bing.status !== 200) {
          notes.push(`必应 ${bing.status}：${query.slice(0, 40)}`);
        }
      }

      if (!parsed.urls.length) {
        const google = await searchGoogle(query);
        if (google.status === 200 && google.html && !isBlockedSearchPage(google.html)) {
          parsed = parseSearchHtml(google.html, company);
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

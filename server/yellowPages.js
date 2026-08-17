/** 公开企业黄页。只查有法定名的主体，不搜买家昵称，不把名录站当成官网。 */
import * as cheerio from 'cheerio';

const LOCAL = {
  de: [
    { host: 'gelbeseiten.de', name: 'Gelbe Seiten' },
    { host: 'northdata.de', name: 'North Data' },
  ],
  at: [{ host: 'herold.at', name: 'Herold' }],
  ch: [{ host: 'local.ch', name: 'local.ch' }],
  fr: [{ host: 'pagesjaunes.fr', name: 'PagesJaunes' }],
  uk: [{ host: 'yell.com', name: 'Yell' }],
  gb: [{ host: 'yell.com', name: 'Yell' }],
  us: [{ host: 'yellowpages.com', name: 'Yellow Pages' }],
  ca: [{ host: 'yellowpages.ca', name: 'Yellow Pages' }],
  au: [{ host: 'yellowpages.com.au', name: 'Yellow Pages' }],
  ie: [{ host: 'goldenpages.ie', name: 'Golden Pages' }],
  nl: [{ host: 'detelefoongids.nl', name: 'De Telefoongids' }],
  be: [{ host: 'goudengids.be', name: 'Gouden Gids' }],
  es: [{ host: 'paginasamarillas.es', name: 'Páginas Amarillas' }],
  it: [{ host: 'paginegialle.it', name: 'PagineGialle' }],
  pl: [{ host: 'pkt.pl', name: 'Panorama Firm' }],
  cz: [{ host: 'zlatestranky.cz', name: 'Zlaté stránky' }],
  fi: [{ host: 'finder.fi', name: 'Finder' }],
  se: [{ host: 'eniro.se', name: 'Eniro' }],
  no: [{ host: 'gulesider.no', name: 'Gule Sider' }],
  dk: [{ host: 'degulesider.dk', name: 'De Gule Sider' }],
  pt: [{ host: 'pai.pt', name: 'Páginas Amarelas' }],
  ae: [{ host: 'yellowpages.ae', name: 'Yellow Pages UAE' }],
  in: [{ host: 'justdial.com', name: 'Justdial' }],
  sg: [{ host: 'yellowpages.com.sg', name: 'Yellow Pages' }],
  my: [{ host: 'yellowpages.com.my', name: 'Yellow Pages' }],
  za: [{ host: 'brabys.com', name: 'Brabys' }],
  mx: [{ host: 'seccionamarilla.com.mx', name: 'Sección Amarilla' }],
  br: [{ host: 'guiamais.com.br', name: 'GuiaMais' }],
  jp: [{ host: 'itp.ne.jp', name: 'iタウンページ' }],
};

const COUNTRY_TO_TLD = {
  germany: 'de', deutschland: 'de', 德国: 'de',
  austria: 'at', österreich: 'at', 奥地利: 'at',
  switzerland: 'ch', 瑞士: 'ch',
  france: 'fr', 法国: 'fr',
  'united kingdom': 'uk', britain: 'uk', 英国: 'uk',
  'united states': 'us', usa: 'us', 美国: 'us',
  canada: 'ca', 加拿大: 'ca',
  australia: 'au', 澳大利亚: 'au',
  ireland: 'ie', 爱尔兰: 'ie',
  netherlands: 'nl', holland: 'nl', 荷兰: 'nl',
  belgium: 'be', 比利时: 'be',
  spain: 'es', 西班牙: 'es',
  italy: 'it', 意大利: 'it',
  poland: 'pl', 波兰: 'pl',
  'czech republic': 'cz', czechia: 'cz', 捷克: 'cz',
  finland: 'fi', 芬兰: 'fi',
  sweden: 'se', 瑞典: 'se',
  norway: 'no', 挪威: 'no',
  denmark: 'dk', 丹麦: 'dk',
  portugal: 'pt', 葡萄牙: 'pt',
  'united arab emirates': 'ae', uae: 'ae', 阿联酋: 'ae',
  india: 'in', 印度: 'in',
  singapore: 'sg', 新加坡: 'sg',
  malaysia: 'my', 马来西亚: 'my',
  'south africa': 'za', 南非: 'za',
  mexico: 'mx', 墨西哥: 'mx',
  brazil: 'br', 巴西: 'br',
  japan: 'jp', 日本: 'jp',
};

const GLOBAL = [
  { host: 'europages.com', name: 'Europages' },
  { host: 'europages.co.uk', name: 'Europages' },
];

const EXTRA_DIRECTORY_HOSTS = [
  '11880.com',
  'dasoertliche.de',
  'webvalid.de',
  'unternehmen24.info',
  'online-handelsregister.de',
  'handelsregister.de',
  'unternehmensregister.de',
  'bundesanzeiger.de',
  'northdata.com',
  'northdata.de',
  'firmenwissen.de',
  'dnb.com',
  'bloomberg.com',
  'opencorporates.com',
  'kompass.com',
  'moneyhouse.ch',
  'creditsafe.com',
  'peoplecheck.de',
];

const SOCIAL_OR_JUNK = /(?:^|\.)(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|wikipedia|google|apple|microsoft|bing)\./i;
const EMAIL_RE = /[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,24}/g;

const ALL_HOSTS = [
  ...Object.values(LOCAL).flat(),
  ...GLOBAL,
  ...EXTRA_DIRECTORY_HOSTS.map((host) => ({ host, name: host })),
];

const HOST_SET = new Set(ALL_HOSTS.map((d) => d.host.replace(/^www\./, '')));

export function directoryTld(country) {
  const key = String(country || '').trim().toLowerCase();
  if (!key) return '';
  if (LOCAL[key]) return key;
  if (COUNTRY_TO_TLD[key]) return COUNTRY_TO_TLD[key];
  const hit = Object.keys(COUNTRY_TO_TLD).find((k) => key.includes(k) && k.length >= 4);
  return hit ? COUNTRY_TO_TLD[hit] : '';
}

export function yellowPagesForCountry(country) {
  const tld = directoryTld(country);
  const local = tld ? (LOCAL[tld] || []) : [];
  const seen = new Set();
  const out = [];
  for (const row of [...local, ...GLOBAL]) {
    const host = String(row.host || '').replace(/^www\./, '').toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push({ ...row, host });
  }
  return out;
}

export function isDirectoryHost(urlOrHost) {
  const raw = String(urlOrHost || '').trim().toLowerCase();
  if (!raw) return false;
  let host = raw;
  try {
    host = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    host = raw.replace(/^www\./, '').split('/')[0];
  }
  host = host.replace(/^www\./, '');
  if (HOST_SET.has(host)) return true;
  for (const known of HOST_SET) {
    if (host === known || host.endsWith(`.${known}`)) return true;
  }
  return /yellowpages|gelbeseiten|pagesjaunes|paginegialle|paginasamarillas|gulesider|goudengids|zlatestranky|europages|11880\.com|yell\.com|justdial|northdata|webvalid|handelsregister|unternehmensregister|dnb\.com|opencorporates|firmenwissen/i.test(host);
}

export function yellowPagesDorks(company, country) {
  const name = `"${String(company || '').replace(/"/g, '').replace(/\b(l\.?l\.?c\.?|limited|ltd\.?|inc\.?|gmbh|mbh)\b/gi, ' ').replace(/\s+/g, ' ').trim()}"`;
  if (name.length < 5) return [];
  if (!directoryTld(country)) return [];
  const dirs = yellowPagesForCountry(country);
  const out = [];
  if (dirs[0]) out.push(`${name} site:${dirs[0].host}`);
  if (dirs[1] && dirs[1].host !== 'europages.com' && dirs[1].host !== 'europages.co.uk') {
    out.push(`${name} site:${dirs[1].host}`);
  } else {
    out.push(`${name} (europages OR "yellow pages" OR gelbeseiten OR "pages jaunes")`);
  }
  return [...new Set(out)];
}

function unwrapJsonLd(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(unwrapJsonLd);
  if (data['@graph']) return unwrapJsonLd(data['@graph']);
  return [data];
}

function jsonLdType(row) {
  const t = row?.['@type'];
  return Array.isArray(t) ? t.join(' ') : String(t || '');
}

function pushUnique(list, value) {
  const v = String(value || '').trim();
  if (!v || list.includes(v)) return;
  list.push(v);
}

function collectJsonLd(row, into) {
  if (!row || typeof row !== 'object') return;
  if (!/Organization|LocalBusiness|Place|Corporation|Government/i.test(jsonLdType(row) || 'Organization')) {
    if (row.url || row.email || row.telephone || row.address) {
      /* still take contact fields from typed-less blobs */
    } else return;
  }
  if (row.url) pushUnique(into.websites, row.url);
  if (row.email) {
    const emails = Array.isArray(row.email) ? row.email : [row.email];
    for (const e of emails) pushUnique(into.emails, String(e).replace(/^mailto:/i, '').toLowerCase());
  }
  if (row.telephone) {
    const phones = Array.isArray(row.telephone) ? row.telephone : [row.telephone];
    for (const p of phones) pushUnique(into.phones, p);
  }
  if (row.address && typeof row.address === 'object') {
    const line = [row.address.streetAddress, row.address.postalCode, row.address.addressLocality, row.address.addressCountry]
      .flat()
      .filter(Boolean)
      .join(', ');
    if (line.length >= 8) pushUnique(into.addresses, line);
  }
}

function plausibleListingEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9._+-]{0,48}@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e)) return false;
  if (/beispiel|example|placeholder|yourname|domainname|firma\.de|noreply|webmaster/i.test(e)) return false;
  if (/\d{3,}/.test(e.split('@')[0] || '')) return false;
  return true;
}

function looksLikeWebsiteLabel(text) {
  return /website|webseite|homepage|official|www\.|站点|官网|sitio|sito web|web site/i.test(String(text || ''));
}

export function parseDirectoryListing(html, { pageUrl = '' } = {}) {
  const $ = cheerio.load(String(html || ''));
  const websites = [];
  const emails = [];
  const phones = [];
  const addresses = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text() || '{}');
      for (const row of unwrapJsonLd(parsed)) collectJsonLd(row, { websites, emails, phones, addresses });
    } catch {
      /* ignore broken json-ld */
    }
  });

  $('[itemprop="url"], [itemprop="email"], [itemprop="telephone"]').each((_, el) => {
    const prop = String($(el).attr('itemprop') || '');
    const href = String($(el).attr('href') || '');
    const val = href || $(el).text();
    if (prop === 'url') pushUnique(websites, val);
    if (prop === 'email') pushUnique(emails, val.replace(/^mailto:/i, '').toLowerCase());
    if (prop === 'telephone') pushUnique(phones, val.replace(/^tel:/i, ''));
  });

  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    const label = `${$(el).text()} ${$(el).attr('title') || ''} ${$(el).attr('class') || ''}`;
    if (/^mailto:/i.test(href)) {
      pushUnique(emails, href.replace(/^mailto:/i, '').split('?')[0].toLowerCase());
      return;
    }
    if (/^tel:/i.test(href)) {
      pushUnique(phones, href.replace(/^tel:/i, ''));
      return;
    }
    if (!/^https?:\/\//i.test(href)) return;
    if (isDirectoryHost(href) || SOCIAL_OR_JUNK.test(href)) return;
    if (looksLikeWebsiteLabel(label) || /website|official-website|company-website/i.test(String($(el).attr('class') || ''))) {
      pushUnique(websites, href);
    }
  });

  for (const raw of String($.root().text() || '').match(EMAIL_RE) || []) {
    pushUnique(emails, raw.toLowerCase());
  }

  const website = websites.find((u) => !isDirectoryHost(u) && !SOCIAL_OR_JUNK.test(u)) || '';
  const mail = emails.filter((e) => {
    const domain = e.split('@')[1] || '';
    return plausibleListingEmail(e) && domain && !isDirectoryHost(domain) && !/gmail|yahoo|hotmail|outlook|icloud/i.test(domain);
  });

  let source = '黄页';
  try {
    const host = new URL(pageUrl || 'https://example.com').hostname.replace(/^www\./, '');
    const hit = ALL_HOSTS.find((d) => host === d.host || host.endsWith(`.${d.host}`));
    source = hit?.name || host || '黄页';
  } catch {
    /* ignore */
  }

  return {
    website,
    websites: websites.filter((u) => !isDirectoryHost(u)).slice(0, 4),
    emails: mail.slice(0, 6),
    phones: phones.slice(0, 6),
    address: addresses[0] || '',
    source,
    pageUrl,
  };
}

export function searchName(company) {
  return String(company || '')
    .replace(/\b(l\.?l\.?c\.?|limited|ltd\.?|inc\.?|incorporated|gmbh|mbh|s\.?a\.?|b\.?v\.?)\b/gi, ' ')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function directorySearchUrls(company, country) {
  const q = searchName(company);
  if (q.length < 3) return [];
  const enc = encodeURIComponent(q);
  const tld = directoryTld(country);
  const out = [];
  if (tld === 'de') {
    out.push(`https://www.gelbeseiten.de/suche/${enc}/bundesweit`);
    out.push(`https://www.northdata.de/?q=${enc}`);
  } else if (tld === 'fr') {
    out.push(`https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${enc}`);
  } else if (tld === 'uk' || tld === 'gb') {
    out.push(`https://www.yell.com/ucs/UcsSearchAction.do?keywords=${enc}`);
  } else if (tld === 'us') {
    out.push(`https://www.yellowpages.com/search?search_terms=${enc}`);
  } else if (tld === 'fi') {
    out.push(`https://www.finder.fi/search?what=${enc}`);
  } else if (tld === 'it') {
    out.push(`https://www.paginegialle.it/ricerca/${enc}`);
  } else if (tld === 'es') {
    out.push(`https://www.paginasamarillas.es/search?qc=${enc}`);
  } else if (tld === 'nl') {
    out.push(`https://www.detelefoongids.nl/zoek/${enc}`);
  } else if (tld === 'cz') {
    out.push(`https://www.zlatestranky.cz/hledani/${enc}`);
  } else if (tld === 'ae') {
    out.push(`https://www.yellowpages.ae/search?q=${enc}`);
  } else if (tld === 'in') {
    out.push(`https://www.justdial.com/${enc}`);
  }
  if (tld && !out.some((u) => /europages/i.test(u))) {
    out.push(`https://www.europages.co.uk/companies/csearch.html?q=${enc}`);
  }
  return [...new Set(out)].slice(0, 3);
}

const LISTING_PATH = /\/gsbiz\/[a-z0-9-]+|\/eintrag\/|\/fiche\/|\/biz\/|\/mip\/|\/yp\/[a-z0-9]|\/firma\/|\/company\/[^/?#]+|\/companies\/[^/?#]+/i;

export function listingLinksFromHtml(html, pageUrl = '') {
  const $ = cheerio.load(String(html || ''));
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /surveymonkey|consentmanager|facebook|instagram/i.test(href)) return;
    let abs = href;
    try {
      abs = new URL(href, pageUrl || 'https://example.com').toString();
    } catch {
      return;
    }
    if (!isDirectoryHost(abs)) return;
    let path = '';
    try { path = new URL(abs).pathname; } catch { return; }
    if (!LISTING_PATH.test(path) && !/\/gsbiz\//i.test(abs)) return;
    if (/\/suche\/|\/search|\/ricerca|\/hledani|\/csearch/i.test(path) && !/\/gsbiz\//i.test(path)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  });
  return out.slice(0, 8);
}

function listingMentionsCompany(html, company) {
  const tokens = String(company || '')
    .toLowerCase()
    .split(/[^a-z0-9äöüßáéíóúčďěňřšťž]+/i)
    .filter((t) => t.length >= 4);
  if (!tokens.length) return false;
  const text = String(html || '').toLowerCase().slice(0, 12000);
  const hits = tokens.filter((t) => text.includes(t));
  return hits.some((t) => t.length >= 6) || hits.length >= 2;
}

const DIR_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchDirectoryPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DIR_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch (err) {
    return { ok: false, status: 0, url, text: '', error: String(err.message || err) };
  }
}

/** Directly open national yellow-page search pages and read listing cards. */
export async function lookupYellowPages(company, country, { fetchPage = fetchDirectoryPage } = {}) {
  const out = {
    website: '',
    emails: [],
    phones: [],
    address: '',
    pages: [],
    source: '',
    pageUrl: '',
  };
  const listingUrls = [];
  for (const url of directorySearchUrls(company, country)) {
    const r = await fetchPage(url);
    if (!r.ok || !r.text) continue;
    listingUrls.push(...listingLinksFromHtml(r.text, r.url));
  }
  const unique = [...new Set(listingUrls)].slice(0, 3);
  for (const url of unique) {
    const r = await fetchPage(url);
    if (!r.ok || !r.text) continue;
    if (!listingMentionsCompany(r.text, company)) continue;
    const listing = parseDirectoryListing(r.text, { pageUrl: r.url });
    out.pages.push({ url: r.url, title: listing.source || url });
    if (listing.website && !out.website) out.website = listing.website;
    if (listing.address && !out.address) out.address = listing.address;
    if (listing.source && !out.source) {
      out.source = listing.source;
      out.pageUrl = r.url;
    }
    out.emails.push(...listing.emails);
    out.phones.push(...listing.phones);
  }
  out.emails = [...new Set(out.emails)].slice(0, 6);
  out.phones = [...new Set(out.phones)].slice(0, 8);
  return out;
}

import { parse as parseDomain } from 'tldts';
import { chat, parseJson } from './ai.js';
import { enrichOpenSources, fetchCompaniesHouseOfficers } from './openSources.js';
import {
  GITHUB_TOOLS,
  registrableDomain as tldtsDomain,
  isAssetUrl,
  pageTitle as cheerioTitle,
  pageText,
  pageMeta,
  mailtoFromHtml,
  contactHrefs,
  parsePhones,
  wikidataSearchUrl,
  wikidataEntitiesUrl,
  simplifyEntity,
  fuseRank,
  whoisFacts,
} from './githubTools.js';
import {
  searchCompanyPages,
  searchEngineLabel,
  scoreResearchUrl,
  hostFromWebsite,
  hostFitsCountry,
  countrySearchTerms,
  rfqProductTerms,
  buildSearchLinks,
  addressFromSnippets,
  hoursFromSnippets,
  countryTld,
} from './searchDorks.js';
import { gradeKyb, hasVerifiedEntity, hasProcurementTrace, isForwarderName, filterOutreachEmails, isOutreachEmail } from './kyb.js';
import {
  attachEmailEvidence,
  extractCompanySocials,
  extractLeadership,
  extractTenderPeople,
  companyNumberFromFacts,
  mergeOfficers,
  mergeSocials,
  buildIntel,
} from './intel.js';
import {
  rfqCorpus,
  extractRfqClues,
  classifyResearchPath,
  crosspostLinks,
  suggestCrosspostCompany,
} from './researchPath.js';
import { screenSanctions } from './sanctions.js';
import { findTradeTraces } from './tradeTraces.js';

const UA = 'OutreachAI/1.0 (public due-diligence; +https://github.com/nihao555-hub/kaifaxing)';

const LEGAL_SUFFIX_RE =
  /\b(limited|ltd\.?|inc\.?|incorporated|llc|l\.l\.c\.|gmbh|mbh|sarl|s\.a\.r\.l\.|plc|p\.l\.c\.|corp\.?|corporation|co\.|company|ag|s\.a\.|n\.v\.|b\.v\.|oy|ab|a\/s|s\.p\.a\.|s\.r\.l\.|pty|pvt|private|public|lp|llp|llc\.|m\.b\.h\.)\b/gi;

const INSTITUTION_RE =
  /\b(college|university|universities|hospital|hospitals|council|ministry|department|authority|agency|municipality|borough|county|city|trust|consortium|society|foundation|institute|school|police|nhs|government|kommune|gemeinde|stadt|amt|politechnika|polytechnic|universitet|universit[aä]t|universit[eé]|universiteit|universidad|universidade|hochschule|akademia|academy|nemocnice|krankenhaus|h[oô]pital|ospedale|szpital|ziekenhuis|fakultn[ií]|fakultet|facult[eé]|faculty)\b/i;

/** Official procurement buyer/awardee names are legal entities, not Alibaba nicknames. */
const OFFICIAL_ENTITY_SOURCE_RE = /TED Europa|UK Contracts Finder|USASpending|SAM\.gov/i;

const CONTACT_PATHS = [
  '/contact', '/contact-us', '/contactus', '/contacts', '/contact.html',
  '/about', '/about-us', '/about/contact',
  '/impressum', '/imprint', '/legal', '/legal-notice', '/legal.html',
  '/kontakt', '/kontaktieren', '/contacto', '/contatti',
  '/privacy', '/privacy-policy',
  '/enquiry', '/inquire',
];

const ROLE_SCORE = {
  procurement: 100,
  purchasing: 100,
  purchase: 95,
  buying: 90,
  buyer: 88,
  sourcing: 90,
  vendor: 80,
  tenders: 85,
  tender: 85,
  suppliers: 70,
  supplier: 70,
  export: 78,
  import: 78,
  trade: 72,
  trading: 72,
  sales: 70,
  sale: 65,
  enquiry: 82,
  inquiry: 82,
  enquiries: 82,
  inquiries: 82,
  info: 76,
  contact: 74,
  office: 70,
  hello: 50,
  mail: 42,
  press: 40,
  media: 36,
  marketing: 46,
  comms: 44,
  uk: 55,
};

const JUNK_LOCAL = new Set([
  'noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster', 'webmaster', 'abuse', 'security',
]);

const JUNK_DOMAIN = [
  'example.com', 'example.org', 'w3.org', 'schema.org', 'sentry.io', 'google.com', 'gstatic.com',
  'cloudflare.com', 'github.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'youtube.com',
  'gravatar.com', 'wordpress.org', 'jquery.com', 'cloudfront.net',
  'gmail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
  'qq.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sohu.com',
];

const EMAIL_RE = /[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,24}/g;

export function stripLegalSuffix(name) {
  return String(name || '')
    .replace(/\b(b\.v\.?|n\.v\.?|s\.a\.?|l\.l\.c\.?)\b/gi, ' ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[(),.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function significantTokens(name) {
  const stop = new Set(['the', 'and', 'of', 'for', 'und', 'der', 'die', 'das', 'van', 'de', 'la', 'le']);
  return stripLegalSuffix(name)
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

export function tokenOverlap(a, b) {
  const ta = new Set(significantTokens(a));
  const tb = new Set(significantTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.min(ta.size, tb.size);
}

export function isPersonLikeDisplayName(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (
    new RegExp(LEGAL_SUFFIX_RE.source, 'i').test(s)
    || /(?:^|[\s,])(?:b\.v\.?|n\.v\.?|s\.a\.?|l\.l\.c\.?|gmbh|ltd|llc|plc|inc)(?:$|[\s,])/i.test(s)
    || INSTITUTION_RE.test(s)
  ) return false;
  if (/@/.test(s)) return true;
  if (/[\u0400-\u04FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(s)) return true;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.some((w) => /^(company|group|trading|services|service|enterprise|industries|holdings|international|technologies|solutions|systems|equipment|supplies|healthcare|authority|designs?|agency)$/i.test(w))) {
    return false;
  }
  if (words.length === 1) return /^[\p{L}][\p{L}.'-]{2,24}$/u.test(words[0]);
  if (words.length > 4 || s.length > 42) return true;
  if (words.some((w) => w.replace(/\./g, '').length <= 2)) return true;
  if (words.every((w) => w.replace(/\./g, '').length <= 2)) return true;
  return words.length >= 2 && words.every((w) => /^[\p{L}][\p{L}.'-]{0,20}$/u.test(w));
}

const COMPACT_SKIP_KYB = {
  nickname: {
    grade: 'C',
    label: '停',
    nextAction: '只有个人昵称。向对方要法定全称和登记号后再查，不要猜私人邮箱。',
    needRegNo: true,
  },
  project: {
    grade: 'C',
    label: '停',
    nextAction: '世界银行条目是项目名，不是采购主体。补买方公司全称和登记号后再查。',
    needRegNo: true,
  },
};

/** Tiny C report for mass KYB. Full skippedLeadReport overflows JSON.stringify at 160k rows. */
export function compactSkippedReport(customer, reason = 'nickname') {
  const name = String(customer.company || customer.name || '').trim();
  const kyb = COMPACT_SKIP_KYB[reason] || COMPACT_SKIP_KYB.nickname;
  return {
    status: 'done',
    updatedAt: new Date().toISOString(),
    confidence: 'low',
    legalName: name,
    grade: 'C',
    needRegNo: true,
    canApplyEmail: false,
    brief: reason === 'project'
      ? `${name || '该条目'} 是项目/贷款标题，不是可核验买方公司。`
      : `${name || '该询盘'} 只有个人显示名，公开库核不到公司。`,
    nextAction: kyb.nextAction,
    kyb,
    path: { key: 'import', label: '需补主体', next: kyb.nextAction },
  };
}

export function skippedLeadReport(customer) {
  const company = String(customer.company || customer.name || '').trim();
  const kyb = gradeKyb({ personLike: true, legalName: company });
  return {
    status: 'done',
    updatedAt: new Date().toISOString(),
    confidence: 'low',
    legalName: company,
    website: '',
    emails: [],
    phones: [],
    address: '',
    facts: [customer.country && { label: '国家/地区', value: customer.country, source: '入库' }].filter(Boolean),
    sources: customer.sourceUrl ? [{ title: '原始询盘/公告', url: customer.sourceUrl }] : [],
    steps: [
      { key: 'entity', label: '主体核验', ok: false, detail: '只有个人显示名，公开库无法核到公司' },
      { key: 'website', label: '官网定位', ok: false, detail: '无线索，未猜测域名' },
      { key: 'contact', label: '公开联系方式', ok: false, detail: '不猜测私人邮箱，不从社交资料扒信' },
      { key: 'search', label: '搜索公式', ok: false, detail: '个人昵称不拿去撞搜索结果' },
    ],
    brief: `${company || '该询盘'} 只有个人显示名或产品句，公开库核不到公司，未跑谷歌公式。`,
    notes: [
      '符合要求的背调必须先有可核验主体，再查官网角色邮箱。',
      '公开卡只有昵称时：正文抽 Ltd、型号交叉检索同款询盘、或导入阿里后台报价后的公司名。不搜人名、不猜 Gmail。',
    ],
    kyb,
    grade: 'C',
    nextAction: kyb.nextAction,
    needRegNo: true,
    canApplyEmail: false,
    path: classifyResearchPath(customer, { personLike: true, clues: extractRfqClues(rfqCorpus(customer)) }),
  };
}

export function isPersonLikeLead(customer) {
  if (customer?.forceCompany || customer?.regNo) return false;
  if (OFFICIAL_ENTITY_SOURCE_RE.test(customer?.source || '')) return false;
  const company = String(customer?.company || '').trim();
  const name = String(customer?.name || '').trim();
  if (company) return isPersonLikeDisplayName(company);
  return isPersonLikeDisplayName(name);
}

export function applyLeadIdentity(customer, { company, legalName, regNo, website } = {}) {
  if (!customer) throw new Error('线索不存在');
  const name = String(company || legalName || '').trim();
  const registry = String(regNo || '').trim();
  const site = String(website || '').trim();
  if (!name) throw new Error('请填法定公司名。公开列表只有昵称，不能拿 Linda N 去撞谷歌');
  if (isPersonLikeDisplayName(name) && !registry && !site) {
    throw new Error('这个名字仍像个人昵称。请写成带 Ltd/LLC/GmbH 的法定全称，或同时提供登记号/官网');
  }
  customer.buyerAlias = customer.buyerAlias || customer.company || customer.name;
  customer.company = name;
  customer.legalName = String(legalName || name).trim();
  if (registry) customer.regNo = registry;
  if (site) customer.website = site;
  customer.forceCompany = true;
  customer.research = null;
  return customer;
}

export function registrableDomain(host) {
  return tldtsDomain(host);
}

export function isPlausibleEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const parts = e.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64) return false;
  if (JUNK_LOCAL.has(local)) return false;
  if (JUNK_DOMAIN.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf)$/i.test(local) || /\.(png|jpe?g|gif|webp|svg)$/i.test(domain)) return false;
  if (local.includes('cropped-') || local.includes('logo@') || local.startsWith('font-')) return false;
  if (/^(etunimi\.sukunimi|firstname\.lastname|vorname\.nachname|nombre\.apellido|name\.surname|xxx|yourname)$/i.test(local)) return false;
  if (domain === 'domainname.de' || domain.endsWith('.domainname.de')) return false;
  if (/\d{3,}/.test(local)) return false;
  if (!/^[a-z0-9][a-z0-9._+-]*$/.test(local)) return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,24}$/.test(domain)) return false;
  const parsed = parseDomain(domain, { allowPrivateDomains: true });
  if (!parsed?.domain || !parsed.publicSuffix || parsed.isIcann === false) return false;
  if (parsed.hostname && parsed.hostname !== domain) return false;
  return true;
}

export function emailBelongsToCompany(email, websiteHost, company) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  if (!domain) return false;
  if (COLLISION_HOST_RE.test(domain)) return false;
  if (websiteHost) {
    const site = registrableDomain(websiteHost);
    const mail = registrableDomain(domain);
    return Boolean(site && mail && (mail === site || domain.endsWith(`.${site}`)));
  }
  const first = significantTokens(company).find((t) => t.length >= 4 && !WEAK_NAME_TOKENS.has(t));
  return Boolean(first && domain.includes(first));
}

export function hostLooksLikeCompany(urlOrHost, company) {
  const host = hostFromWebsite(urlOrHost) || String(urlOrHost || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  if (!host || COLLISION_HOST_RE.test(host)) return false;
  const tokens = significantTokens(company).filter((t) => t.length >= 4 && !WEAK_NAME_TOKENS.has(t));
  if (tokens.some((t) => host.includes(t))) return true;
  if (/\.(gov|edu|mil)(\.|$)|(\.ac\.|\.go\.)/i.test(host)) {
    return significantTokens(company).some((t) => t.length >= 4 && host.includes(t));
  }
  return false;
}

export function scoreEmail(email, websiteHost = '') {
  const e = String(email || '').toLowerCase();
  const local = e.split('@')[0] || '';
  const domain = e.split('@')[1] || '';
  let score = ROLE_SCORE[local] || (local.includes('.') ? 30 : 48);
  if (websiteHost) {
    const site = registrableDomain(websiteHost);
    const mail = registrableDomain(domain);
    if (site && mail && (mail === site || domain.endsWith(`.${site}`))) score += 20;
  }
  return Math.min(score, 120);
}

export function extractEmails(html, { websiteHost = '' } = {}) {
  const text = pageText(html);
  const found = new Map();
  const add = (raw) => {
    const email = String(raw || '').toLowerCase();
    if (!isPlausibleEmail(email)) return;
    const prev = found.get(email);
    const item = {
      email,
      role: email.split('@')[0],
      score: scoreEmail(email, websiteHost),
    };
    if (!prev || item.score > prev.score) found.set(email, item);
  };
  for (const email of mailtoFromHtml(html)) add(email);
  for (const raw of text.match(EMAIL_RE) || []) add(raw);
  return [...found.values()].sort((a, b) => b.score - a.score);
}

const PHONE_ISO = {
  ae: 'AE', uk: 'GB', us: 'US', de: 'DE', fr: 'FR', nl: 'NL', in: 'IN', cl: 'CL',
  ph: 'PH', tr: 'TR', pk: 'PK', au: 'AU', es: 'ES', it: 'IT', pl: 'PL', at: 'AT',
  fi: 'FI', cz: 'CZ', pt: 'PT', be: 'BE', se: 'SE', no: 'NO', dk: 'DK', ch: 'CH',
  ca: 'CA', mx: 'MX', br: 'BR', za: 'ZA', sg: 'SG', my: 'MY', id: 'ID', th: 'TH',
  vn: 'VN', jp: 'JP', kr: 'KR', sa: 'SA', eg: 'EG', ie: 'IE', nz: 'NZ',
};

export function phoneCountry(country) {
  return PHONE_ISO[countryTld(country)] || 'US';
}

export function extractPhones(html, country = '') {
  return parsePhones(pageText(html), html, phoneCountry(country));
}

function pageTitle(html) {
  return cheerioTitle(html);
}

export function selectSearchContactUrls(urls, { max = 5 } = {}) {
  return [...new Set((urls || []).filter(Boolean))]
    .filter((u) => !/\.pdf(\?|$)/i.test(u))
    .sort((a, b) => scoreResearchUrl(b) - scoreResearchUrl(a))
    .slice(0, max);
}

export function mergeSearchSnippetEmails(snippetEmails, { websiteHost = '', company = '', source = '搜索摘要' } = {}) {
  const extra = [];
  const seen = new Set();
  for (const raw of snippetEmails || []) {
    const email = String(raw || '').toLowerCase();
    if (seen.has(email)) continue;
    if (!isPlausibleEmail(email) || !emailBelongsToCompany(email, websiteHost, company)) continue;
    seen.add(email);
    extra.push({
      email,
      role: email.split('@')[0],
      score: scoreEmail(email, websiteHost),
      source,
    });
  }
  return extra;
}

export function mergeEmailLists(existing, extras) {
  const map = new Map((existing || []).map((e) => [e.email, { ...e, pages: [...(e.pages || [])] }]));
  for (const item of extras || []) {
    if (!item?.email) continue;
    const prev = map.get(item.email);
    const pages = [...new Set([...(prev?.pages || []), ...(item.pages || [])])];
    if (!prev || (item.score || 0) > (prev.score || 0)) map.set(item.email, { ...item, pages });
    else prev.pages = pages;
  }
  return [...map.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8);
}

function sameRegistrableHost(a, b) {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return Boolean(da && db && da === db);
}

function emailSourceLabel(emails) {
  const sources = [...new Set((emails || []).map((e) => e.source).filter(Boolean))];
  const fromSearch = sources.some((s) => /搜索/.test(s));
  const fromSite = sources.some((s) => /官网/.test(s));
  const list = emails.map((e) => e.email).join('、');
  if (fromSite && fromSearch) return `官网和搜索引擎找到 ${list}`;
  if (fromSearch) return `搜索引擎找到 ${list}`;
  return `官网公开页找到 ${list}`;
}

const GENERIC_VERIFY = new Set([
  'technical', 'service', 'services', 'group', 'trading', 'company', 'international',
  'industrial', 'industries', 'global', 'general', 'limited', 'private',
]);

/** 单独出现时不能当官网/母公司证据：地名、弱品牌、通用机构词 */
const WEAK_NAME_TOKENS = new Set([
  ...GENERIC_VERIFY,
  'london', 'washington', 'crescent', 'federal', 'security', 'prime', 'webcam',
  'band', 'lawrence', 'fermi', 'magellan', 'national', 'united', 'american',
  'tyne', 'coast', 'city', 'county', 'college', 'university', 'hospital',
  'council', 'trust', 'consortium', 'association', 'first', 'new',
]);

const PARENT_QUERY_BLOCK = new Set([
  'london', 'crescent', 'national', 'washington', 'blue', 'prime', 'security',
  'federal', 'association', 'united', 'american', 'general', 'international',
  'global', 'first', 'new', 'city', 'county', 'lawrence', 'fermi', 'magellan',
]);

const COLLISION_HOST_RE = /webcam|theband|wordle|magellantv|voilanorbert|gohansel|grimmstories|merriam-webster/i;

function pageMentionsCompany(html, company, { country = '', pageUrl = '' } = {}) {
  const tokens = significantTokens(company).filter((t) => t.length >= 4);
  const title = pageTitle(html).toLowerCase();
  const text = `${title} ${pageText(html).slice(0, 4000)}`.toLowerCase();
  const distinctive = tokens.filter((t) => !WEAK_NAME_TOKENS.has(t));
  const place = countrySearchTerms(country).map((s) => s.replace(/"/g, '').toLowerCase());
  const countryHit = place.some((w) => w.length >= 3 && text.includes(w)) || hostFitsCountry(pageUrl, country);
  if (country && distinctive.length <= 1 && !hostFitsCountry(pageUrl, country)) return false;
  if (!tokens.length) {
    return significantTokens(company).some((t) => text.includes(t)) && (!country || countryHit);
  }
  if (!distinctive.length) {
    const weakHits = tokens.filter((t) => text.includes(t));
    return weakHits.length >= 2 && (weakHits.filter((t) => title.includes(t)).length >= 2 || countryHit);
  }
  const hits = distinctive.filter((t) => text.includes(t));
  if (hits.length >= 2) return true;
  if (hits.length === 1 && hits[0].length >= 6 && title.includes(hits[0]) && (!country || countryHit)) return true;
  return false;
}

async function fetchText(url, { timeout = 12000, accept = '*/*' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch (err) {
    return { ok: false, status: 0, url, text: '', error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, accept = 'application/json') {
  const r = await fetchText(url, { accept });
  if (!r.ok || !r.text) return null;
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

function discoverContactLinks(html, pageUrl) {
  return contactHrefs(html, pageUrl);
}

function claimValues(entity, pid) {
  const simple = entity?._simple || simplifyEntity(entity);
  if (simple?.claims?.[pid]) {
    return [].concat(simple.claims[pid]).map((v) => {
      if (v == null) return '';
      if (typeof v === 'string' || typeof v === 'number') return String(v);
      if (v.id) return v.id;
      if (v.value) return String(v.value);
      return '';
    }).filter(Boolean);
  }
  const out = [];
  for (const c of entity?.claims?.[pid] || []) {
    const val = c?.mainsnak?.datavalue?.value;
    if (val == null) continue;
    if (typeof val === 'string') out.push(val);
    else if (val.time) out.push(String(val.time).replace(/T.*$/, '').replace(/^\+/, ''));
    else if (val.amount) out.push(String(val.amount));
    else if (val.id) out.push(val.id);
    else if (val.text) out.push(val.text);
  }
  return out;
}

async function searchWikidata(query) {
  const data = await fetchJson(wikidataSearchUrl(query));
  return data?.search || [];
}

async function loadWikidataEntity(id) {
  const data = await fetchJson(wikidataEntitiesUrl([id]));
  return data?.entities?.[id] || null;
}

async function searchWikipedia(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json&search=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  const titles = data?.[1] || [];
  const links = data?.[3] || [];
  return titles.map((title, i) => ({ title, url: links[i] }));
}

async function wikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return fetchJson(url);
}

async function searchGleif(query, mode = 'legalName') {
  const filter = mode === 'fulltext' ? 'filter[fulltext]' : 'filter[entity.legalName]';
  const url = `https://api.gleif.org/api/v1/lei-records?page[size]=5&${filter}=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  return data?.data || [];
}

const ORG_HINT = /compan|group|college|university|corporation|limited|gmbh|agency|contractor|construction|housing|plc|inc\b|institut|authority|hospital|council|technologies|gesellschaft/i;

const JUNK_ENTITY_RE = /family name|given name|surname|disambiguation|hamlet|researcher|footballer|singer|illustrator|writer|poet|actor|musician|politician|\bband\b|television|webcam|glider|sailplane|aircraft model|video game|\balbum\b|\bfilm\b|\bsong\b|dictionary|fairy tale|wordle/i;

export function pickBestHit(hits, company, getLabel) {
  let best = null;
  let bestScore = 0;
  const companyTokens = significantTokens(company);
  const first = companyTokens[0];
  for (const hit of hits) {
    const label = getLabel(hit);
    const desc = hit.description || hit.display || '';
    if (JUNK_ENTITY_RE.test(desc) || JUNK_ENTITY_RE.test(label)) continue;
    const labelTokens = significantTokens(label);
    const inter = companyTokens.filter((t) => labelTokens.includes(t)).length;
    const coverage = companyTokens.length ? inter / companyTokens.length : 0;
    const orgLike = ORG_HINT.test(`${label} ${desc}`);
    const startsWithFirst = first && String(label).toLowerCase().startsWith(first);
    let score = 0;
    const parentHint = /group|plc|\binc\b|limited|gmbh|technologies|corporation|services|holdings/i.test(`${label} ${desc}`);
    const firstOk = first && first.length >= 3 && !PARENT_QUERY_BLOCK.has(first);
    if (coverage >= 0.8 && (orgLike || companyTokens.length >= 2)) score = 1;
    else if (startsWithFirst && orgLike && labelTokens.length >= 2 && coverage >= 0.5 && firstOk) score = 0.7;
    else if (startsWithFirst && orgLike && parentHint && firstOk && (coverage >= 0.4 || (first.length <= 4 && coverage >= 0.25))) score = 0.62;
    if (score > bestScore) {
      best = { hit, label, score };
      bestScore = score;
    }
  }
  if (bestScore <= 0) return null;
  const ranked = fuseRank(company, hits.filter((h) => !JUNK_ENTITY_RE.test(`${getLabel(h)} ${h.description || ''}`)), getLabel);
  const top = ranked[0];
  if (top && top.label === best.label) best.score += 0.05;
  return best;
}

export function queriesFor(company) {
  const full = String(company || '').trim();
  const stripped = stripLegalSuffix(full);
  const q = [];
  if (full) q.push(full);
  if (stripped && stripped.toLowerCase() !== full.toLowerCase()) q.push(stripped);
  const tokens = significantTokens(full);
  if (tokens.length >= 2) q.push(tokens.slice(0, 3).join(' '));
  const hasLegal = new RegExp(LEGAL_SUFFIX_RE.source, 'i').test(full) || INSTITUTION_RE.test(full);
  if (hasLegal && tokens[0] && tokens[0].length >= 3 && !PARENT_QUERY_BLOCK.has(tokens[0])) {
    q.push(`${tokens[0]} Group`);
    q.push(`${tokens[0]} PLC`);
    q.push(`${tokens[0]} Inc`);
  }
  return [...new Set(q)].slice(0, 5);
}

export function websiteCandidates(url) {
  try {
    const raw = String(url || '').trim();
    if (!raw) return [];
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    const bare = host.replace(/^www\./, '');
    const hosts = [...new Set([`www.${bare}`, bare, host])];
    const path = u.pathname === '/' ? '/' : u.pathname;
    const out = [];
    for (const scheme of ['https', 'http']) {
      for (const h of hosts) out.push(`${scheme}://${h}${path}`);
    }
    return out;
  } catch {
    return [];
  }
}

const COUNTRY_TLD = {
  德国: 'de', DE: 'de', Germany: 'de',
  英国: 'co.uk', GB: 'co.uk', UK: 'co.uk',
  美国: 'com', US: 'com', USA: 'com',
  荷兰: 'nl', NL: 'nl', Netherlands: 'nl',
  法国: 'fr', FR: 'fr',
  波兰: 'pl', PL: 'pl',
  芬兰: 'fi', FI: 'fi',
  西班牙: 'es', ES: 'es',
  意大利: 'it', IT: 'it',
  印度: 'in', IN: 'in',
  阿联酋: 'ae', UAE: 'ae', AE: 'ae', 'United Arab Emirates': 'ae',
  智利: 'cl', Chile: 'cl',
  菲律宾: 'ph', Philippines: 'ph',
  土耳其: 'tr', Turkey: 'tr',
  巴基斯坦: 'pk', Pakistan: 'pk',
};

function guessWebsiteUrls(company, country) {
  const tokens = significantTokens(company);
  const first = tokens[0] || '';
  const slugs = [...new Set([first, stripLegalSuffix(company).toLowerCase().replace(/[^a-z0-9]/g, '')])]
    .filter((s) => s.length >= 4 && s.length <= 24 && !/^\d+$/.test(s));
  const tlds = [...new Set([COUNTRY_TLD[country] || '', 'com', 'co.uk']).values()].filter(Boolean);
  const urls = [];
  for (const slug of slugs.slice(0, 2)) {
    for (const tld of tlds.slice(0, 2)) urls.push(`https://www.${slug}.${tld}/`);
  }
  return [...new Set(urls)].slice(0, 4);
}

async function wikidataLabels(ids) {
  const uniq = [...new Set(ids)].slice(0, 6);
  if (!uniq.length) return {};
  const data = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${uniq.join('|')}&props=labels&languages=en&format=json`
  );
  const map = {};
  for (const id of uniq) {
    const label = data?.entities?.[id]?.labels?.en?.value;
    if (label) map[id] = label;
  }
  return map;
}

async function resolveEntity(company, country = '') {
  const sources = [];
  const facts = [];
  let website = '';
  let legalName = company;
  let extract = '';
  let wikiTitle = '';
  let relatedNote = '';

  const queryList = queriesFor(company).slice(0, 3);
  const gleifQueries = queryList.filter((q) => significantTokens(q).length >= 2);
  const [firstWd, firstGleif] = await Promise.all([
    queryList[0] ? searchWikidata(queryList[0]) : Promise.resolve([]),
    gleifQueries[0] ? searchGleif(gleifQueries[0], 'legalName') : Promise.resolve([]),
  ]);
  let gleif = firstGleif || [];

  for (const [i, q] of queryList.entries()) {
    const wdHits = i === 0 ? firstWd : await searchWikidata(q);
    const picked = pickBestHit(wdHits, company, (h) => h.label || '');
    if (picked) {
      const ent = await loadWikidataEntity(picked.hit.id);
      const label = ent?.labels?.en?.value || picked.label;
      legalName = label || legalName;
      const sites = claimValues(ent, 'P856');
      if (sites[0]) website = sites[0];
      const sitelink = ent?.sitelinks?.enwiki?.title;
      if (sitelink) wikiTitle = sitelink;
      facts.push({ label: 'Wikidata', value: `${label} (${picked.hit.id})`, source: 'Wikidata' });
      if (picked.hit.description) facts.push({ label: '主体说明', value: picked.hit.description, source: 'Wikidata' });
      if (claimValues(ent, 'P571')[0]) facts.push({ label: '成立', value: claimValues(ent, 'P571')[0], source: 'Wikidata' });
      const employees = claimValues(ent, 'P1128')[0];
      if (employees) facts.push({ label: '员工规模', value: String(employees).replace(/^[+]/, ''), source: 'Wikidata' });
      const phone = claimValues(ent, 'P1329')[0];
      if (phone) facts.push({ label: '公开电话', value: phone, source: 'Wikidata' });
      const socials = [
        ['P4264', 'LinkedIn', (v) => (String(v).startsWith('http') ? v : `https://www.linkedin.com/company/${v}`)],
        ['P2013', 'Facebook', (v) => (String(v).startsWith('http') ? v : `https://www.facebook.com/${v}`)],
        ['P2002', 'X', (v) => (String(v).startsWith('http') ? v : `https://x.com/${v}`)],
      ];
      for (const [pid, name, toUrl] of socials) {
        const val = claimValues(ent, pid)[0];
        if (!val) continue;
        facts.push({ label: name, value: toUrl(val), source: 'Wikidata' });
      }
      const industryIds = [...claimValues(ent, 'P452'), ...claimValues(ent, 'P31')].filter((id) => /^Q\d+$/.test(id)).slice(0, 4);
      if (industryIds.length) {
        const labels = await wikidataLabels(industryIds);
        const text = industryIds.map((id) => labels[id]).filter(Boolean).join(' / ');
        if (text) facts.push({ label: '行业', value: text, source: 'Wikidata' });
      }
      const hqIds = claimValues(ent, 'P159').filter((id) => /^Q\d+$/.test(id)).slice(0, 2);
      if (hqIds.length) {
        const labels = await wikidataLabels(hqIds);
        const text = hqIds.map((id) => labels[id]).filter(Boolean).join(', ');
        if (text) facts.push({ label: '总部', value: text, source: 'Wikidata' });
      }
      sources.push({ title: `Wikidata ${picked.hit.id}`, url: `https://www.wikidata.org/wiki/${picked.hit.id}` });
      if (tokenOverlap(company, label) < 0.8) {
        relatedNote = `公开库匹配到相关主体「${label}」，不一定等于询盘上的法定全称`;
      }
      break;
    }
  }

  if (!wikiTitle && !website) {
    for (const q of queryList.slice(0, 2)) {
      const hits = await searchWikipedia(q);
      const picked = pickBestHit(hits, company, (h) => h.title);
      if (picked) {
        wikiTitle = picked.label;
        break;
      }
    }
  }

  if (wikiTitle && !website) {
    const sum = await wikipediaSummary(wikiTitle);
    if (sum?.extract) extract = sum.extract;
    const wikiUrl = sum?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
    sources.push({ title: `Wikipedia · ${wikiTitle}`, url: wikiUrl });
    if (extract) facts.push({ label: '公开简介', value: extract.slice(0, 400), source: 'Wikipedia' });
    if (!website && sum?.content_urls) {
      /* official site still comes from Wikidata P856 when available */
    }
  }

  if (!gleif.length) {
    for (const q of gleifQueries.slice(0, 2)) {
      gleif = await searchGleif(q, 'legalName');
      if (gleif.length) break;
    }
  }
  if (!gleif.length && gleifQueries[0]) {
    gleif = await searchGleif(gleifQueries[0], 'fulltext');
  }
  const gleifPick = pickBestHit(gleif, company, (h) => h?.attributes?.entity?.legalName?.name || '');
  if (gleifPick) {
    const attrs = gleifPick.hit.attributes || {};
    const ent = attrs.entity || {};
    const addr = ent.legalAddress || {};
    legalName = ent.legalName?.name || legalName;
    facts.push({ label: 'LEI', value: attrs.lei || '', source: 'GLEIF' });
    facts.push({ label: '登记状态', value: ent.status || '', source: 'GLEIF' });
    facts.push({
      label: '注册地址',
      value: [addr.addressLines, addr.city, addr.postalCode, addr.country].flat().filter(Boolean).join(', '),
      source: 'GLEIF',
    });
    if (ent.jurisdiction) facts.push({ label: '法域', value: ent.jurisdiction, source: 'GLEIF' });
    if (ent.registeredAs) facts.push({ label: '登记号', value: String(ent.registeredAs).trim(), source: 'GLEIF' });
    if (ent.registeredAt?.id) facts.push({ label: '登记机关', value: ent.registeredAt.id, source: 'GLEIF' });
    sources.push({ title: `GLEIF ${attrs.lei}`, url: `https://search.gleif.org/#/record/${attrs.lei}` });
  }

  const open = await enrichOpenSources({ company, country, facts, website });
  facts.push(...open.facts);
  sources.push(...open.sources);
  if (!website && open.website) website = open.website;

  return { website, legalName, extract, facts: facts.filter((f) => f.value), sources, relatedNote };
}

async function harvestContacts(website, company, { extraUrls = [], country = '' } = {}) {
  if (!website) return { emails: [], phones: [], pages: [], verified: false };
  let homeRes = { ok: false, status: 0, url: website, text: '', error: '未请求' };
  for (const home of websiteCandidates(website)) {
    homeRes = await fetchText(home, { accept: 'text/html', timeout: 14000 });
    if (homeRes.ok && homeRes.text) break;
  }
  if (!homeRes.ok) return { emails: [], phones: [], pages: [], verified: false, error: homeRes.error || `HTTP ${homeRes.status}` };

  const verified = pageMentionsCompany(homeRes.text, company, { country, pageUrl: homeRes.url })
    || (!country && pageMentionsCompany(homeRes.text, pageTitle(homeRes.text)));
  const pages = [{ url: homeRes.url, title: pageTitle(homeRes.text) || '官网首页' }];
  const htmls = [homeRes.text];
  let siteHost = '';
  try { siteHost = new URL(homeRes.url).hostname; } catch { /* ignore */ }
  const searchSameDomain = extraUrls.filter((u) => {
    try {
      return registrableDomain(u) === registrableDomain(siteHost);
    } catch {
      return false;
    }
  }).sort((a, b) => scoreResearchUrl(b) - scoreResearchUrl(a)).slice(0, 3);
  const discovered = discoverContactLinks(homeRes.text, homeRes.url);
  const commonPaths = [
    '/contact', '/contact-us', '/contactus', '/en/contact', '/nl/contact', '/fr/contact',
    '/contactez-nous', '/impressum', '/kontakt', '/procurement',
  ].map((p) => {
    try { return new URL(p, homeRes.url).toString(); } catch { return ''; }
  }).filter(Boolean);
  const extra = [
    ...discovered,
    ...commonPaths,
    ...['/about-us', '/leadership', '/governance'].map((p) => {
      try { return new URL(p, homeRes.url).toString(); } catch { return ''; }
    }),
    ...searchSameDomain,
  ].filter((u) => u && !isAssetUrl(u) && u !== homeRes.url);
  const ranked = [...new Set(extra)].sort((a, b) => {
    const weight = (u) => (/impressum|imprint|kontakt|contact|procurement|purchasing/i.test(u) ? 0 : 1);
    return weight(a) - weight(b);
  }).slice(0, 4);

  const extras = await Promise.all(ranked.map((url) => fetchText(url, { accept: 'text/html', timeout: 8000 })));
  for (const r of extras) {
    if (!r.ok || !r.text) continue;
    if (isAssetUrl(r.url) || !/<html|mailto:|contact|@|leadership|about|director/i.test(r.text.slice(0, 4000))) continue;
    pages.push({ url: r.url, title: pageTitle(r.text) || r.url });
    htmls.push(r.text);
  }

  let host = '';
  try { host = new URL(homeRes.url).hostname; } catch { /* ignore */ }
  const emailMap = new Map();
  const phones = new Set();
  const socials = [];
  const officers = [];
  htmls.forEach((html, i) => {
    const pageUrl = pages[i]?.url || homeRes.url;
    const pageHeading = pages[i]?.title || '';
    for (const item of extractEmails(html, { websiteHost: host })) {
      if (!emailBelongsToCompany(item.email, host, company)) continue;
      const prev = emailMap.get(item.email);
      const pagesFor = [...new Set([...(prev?.pages || []), pageUrl])];
      if (!prev || item.score > prev.score) {
        emailMap.set(item.email, { ...item, source: '官网公开页', pages: pagesFor });
      } else {
        prev.pages = pagesFor;
      }
    }
    for (const p of extractPhones(html, country)) phones.add(p);
    socials.push(...extractCompanySocials(html, pageUrl));
    officers.push(...extractLeadership(html, { pageUrl, title: pageHeading }));
  });

  const meta = pageMeta(homeRes.text);
  const emails = [...emailMap.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  const whois = emails.some((e) => isOutreachEmail(e)) ? null : await whoisFacts(homeRes.url);
  return {
    emails,
    phones: [...phones].slice(0, 8),
    pages,
    socials: mergeSocials(socials),
    officers: mergeOfficers(officers),
    verified,
    website: homeRes.url,
    meta,
    whois,
    tools: {
      cheerio: true,
      tldts: true,
      libphonenumber: phones.size > 0,
      wayback: false,
      crtsh: false,
      whoiser: Boolean(whois?.domain),
      searchDorks: searchSameDomain.length > 0,
    },
  };
}

async function harvestSearchContacts({ urls = [], snippetEmails = [], company, website, fetchPages = true } = {}) {
  const host = hostFromWebsite(website);
  const emails = mergeSearchSnippetEmails(snippetEmails, { websiteHost: host, company, source: '搜索摘要' });
  const pages = [];
  const phones = [];
  if (!fetchPages) {
    return { emails: mergeEmailLists([], emails), phones: [], pages };
  }

  for (const url of selectSearchContactUrls(urls, { max: 5 })) {
    const r = await fetchText(url, { accept: 'text/html', timeout: 10000 });
    if (!r.ok || !r.text) continue;
    if (isAssetUrl(r.url) || !/<html|mailto:|contact|@/i.test(r.text.slice(0, 4000))) continue;
    const sameHost = host ? sameRegistrableHost(r.url, host) : false;
    if (!sameHost && !pageMentionsCompany(r.text, company, { country: '', pageUrl: r.url })) continue;
    pages.push({ url: r.url, title: pageTitle(r.text) || url });
    let pageHost = host;
    try { pageHost = host || new URL(r.url).hostname; } catch { /* ignore */ }
    for (const item of extractEmails(r.text, { websiteHost: pageHost })) {
      if (!emailBelongsToCompany(item.email, pageHost, company)) continue;
      emails.push({ ...item, source: '搜索结果页', pages: [r.url] });
    }
    for (const p of extractPhones(r.text)) phones.push(p);
  }

  return {
    emails: mergeEmailLists([], emails),
    phones: [...new Set(phones)].slice(0, 8),
    pages,
  };
}

function mergeSearchHits(base, extra) {
  const seen = new Set(base.urls || []);
  const urls = [...(base.urls || [])];
  for (const u of extra.urls || []) {
    if (seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
  }
  return {
    ...base,
    queries: [...new Set([...(base.queries || []), ...(extra.queries || [])])],
    urls,
    items: [...(base.items || []), ...(extra.items || [])],
    snippetEmails: [...new Set([...(base.snippetEmails || []), ...(extra.snippetEmails || [])])],
    officialGuess: base.officialGuess || extra.officialGuess || '',
    snippetAddress: base.snippetAddress || extra.snippetAddress || '',
    snippetHours: base.snippetHours || extra.snippetHours || '',
    engine: base.engine || extra.engine || '',
    notes: [...(base.notes || []), ...(extra.notes || [])],
  };
}

function fallbackBrief({ customer, legalName, extract, emails, website, personLike, relatedNote }) {
  const bits = [];
  bits.push(`${customer.company || customer.name} 来自 ${customer.source || '公开询盘'}，国家/地区 ${customer.country || '未知'}。`);
  if (personLike) {
    bits.push('公开源只有个人显示名，核不到公司主体，也没有可验证的公开角色邮箱。按外贸公式不应猜测私人邮箱，更不应群发。');
  } else if (legalName) {
    bits.push(`主体核验指向「${legalName}」。${relatedNote || ''}`.trim());
  }
  if (extract) bits.push(extract.slice(0, 220));
  if (website) bits.push(`官网：${website}。`);
  if (emails.length) bits.push(`公开页找到角色邮箱：${emails.map((e) => e.email).join('、')}。优先用采购/询盘邮箱，不要用媒体或招聘邮箱当开发信入口。`);
  else if (website) bits.push('官网能打开，但联系方式是表单或未明文公布邮箱，不能编造 purchase@ 域名去撞。');
  if (customer.painPoints) bits.push(`询盘意图：${String(customer.painPoints).slice(0, 160)}`);
  return bits.join(' ');
}

async function aiBrief(payload) {
  const text = await chat(
    [
      {
        role: 'system',
        content: `你是外贸开发信前的公开背调分析师。只根据给定公开事实，禁止编造联系方式、营收、新闻或未出现的子公司。
用中文输出 JSON：
{
  "brief": "8-12 句背调摘要，按主体核验 / 官网 / 公开联系方式 / 采购意图 / 开发信建议写",
  "entityType": "listed_company|sme|government|institution|unknown_person|unknown",
  "buyingRole": "一句话采购意图",
  "outreachAdvice": "必须遵守给定的 A/B/C 分级：A 才能写开发信，B 走表单或要登记号，C 停",
  "risks": ["风险点"]
}
分级是强制约束，禁止把 C 级写成可以群发。`,
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    { temperature: 0.3 }
  );
  return parseJson(text);
}

export async function researchLead(customer, { useAi = true } = {}) {
  const clues = extractRfqClues(rfqCorpus(customer));
  let personLike = isPersonLikeLead(customer);
  const path = classifyResearchPath(customer, { personLike, clues });
  customer.researchPath = path.key;

  if (personLike && clues.companyHint) {
    try {
      applyLeadIdentity(customer, { company: clues.companyHint });
      customer.identitySource = customer.identitySource || 'rfq_text';
      personLike = false;
    } catch {
      /* 抽到的仍不像法定名 */
    }
  }

  const company = String(customer.company || customer.name || '').trim();
  const facts = [];
  const sources = [];
  const notes = [];
  const steps = [];
  notes.push(`背调路径：${path.label}。${path.next}`);

  if (customer.country) facts.push({ label: '国家/地区', value: customer.country, source: '入库' });
  if (customer.regNo) facts.push({ label: '登记号', value: customer.regNo, source: '补主体' });
  if (customer.buyerAlias && customer.buyerAlias !== company) {
    facts.push({ label: '询盘显示名', value: customer.buyerAlias, source: '入库' });
  }
  if (customer.painPoints) facts.push({ label: '询盘/招标摘要', value: String(customer.painPoints).slice(0, 300), source: '入库' });
  if (customer.sourceUrl) sources.push({ title: '原始询盘/公告', url: customer.sourceUrl });

  let website = clues.websites[0] || '';
  let legalName = company;
  let extract = '';
  let relatedNote = '';
  let emails = [];
  let phones = [...(clues.phones || [])];
  let pages = [];
  let harvestedTools = {};
  let search = { queries: [], urls: [], snippetEmails: [], officialGuess: '', notes: [], engine: '' };
  let crosspost = null;
  let siteSocials = [];
  let siteOfficers = [];

  if (personLike && !website && clues.emails[0]) {
    website = `https://${clues.emails[0].split('@')[1]}`;
  }

  if (personLike && clues.fingerprints.length) {
    crosspost = await suggestCrosspostCompany(clues, customer.country, customer);
    if (crosspost.company) {
      try {
        applyLeadIdentity(customer, { company: crosspost.company, website });
        customer.identitySource = customer.identitySource || 'rfq_crosspost';
        personLike = false;
        legalName = crosspost.company;
        notes.push(`同款询盘交叉检索命中 ${crosspost.company}，按这家核主体，没有搜买家昵称。`);
      } catch {
        notes.push('交叉检索抽到的名字仍不像法定名，未自动写入。');
      }
    }
  }

  if (personLike && website) {
    personLike = false;
    notes.push(`正文里的官网/角色邮箱域名 ${website} 当作起点，不搜买家昵称。`);
  }

  if (personLike) {
    steps.push({ key: 'entity', label: '主体核验', ok: false, detail: '只有个人显示名，公开库无法核到公司' });
    steps.push({ key: 'website', label: '官网定位', ok: false, detail: website || '无线索，未猜测域名' });
    steps.push({ key: 'contact', label: '公开联系方式', ok: false, detail: '不猜测私人邮箱，不从社交资料扒信' });
    steps.push({
      key: 'search',
      label: '搜索公式',
      ok: Boolean(clues.fingerprints.length),
      detail: clues.fingerprints.length
        ? `用型号 ${clues.fingerprints.join('、')} 交叉检索，不搜「${company}」`
        : '个人昵称不拿去撞搜索结果',
    });
    notes.push('符合要求的背调到此缺主体。导入阿里后台报价后的公司名，或填「补主体」。');
  } else {
    const resolved = await resolveEntity(company, customer.country);
    website = resolved.website;
    legalName = resolved.legalName || company;
    extract = resolved.extract;
    relatedNote = resolved.relatedNote;
    facts.push(...resolved.facts);
    sources.push(...resolved.sources);
    if (relatedNote) notes.push(relatedNote);
    steps.push({
      key: 'entity',
      label: '主体核验',
      ok: Boolean(resolved.facts.length),
      detail: resolved.facts.length
        ? `匹配到 ${legalName}`
        : 'Wikidata / GLEIF / ROR / 各国开放登记没有足够匹配',
    });

    const searchedWebsite = website;
    const productTerms = rfqProductTerms(`${customer.title || ''} ${customer.painPoints || ''}`);
    const openWebsite = website;
    search = await searchCompanyPages(legalName || company, {
      maxQueries: openWebsite ? 2 : 4,
      website: searchedWebsite,
      country: customer.country,
      product: productTerms,
    });
    notes.push(...search.notes);
    if (search.officialGuess && !website && hostLooksLikeCompany(search.officialGuess, legalName || company)) {
      website = search.officialGuess;
    }
    for (const it of (search.items || []).slice(0, 8)) {
      sources.push({ title: it.title || '搜索结果', url: it.url });
    }
    for (const u of search.urls.slice(0, 8)) {
      if (!sources.some((s) => s.url === u)) sources.push({ title: '搜索结果', url: u });
    }

    let harvested = website
      ? await harvestContacts(website, legalName || company, { extraUrls: search.urls, country: customer.country })
      : { emails: [], phones: [], pages: [], verified: false };

    if (harvested.website && !harvested.verified && !openWebsite) {
      harvested = { emails: [], phones: [], pages: [], verified: false };
      website = '';
    }

    const haveVerifiedSite = Boolean(harvested.pages?.length && (harvested.verified || openWebsite));
    if (!haveVerifiedSite && (search.urls.length || resolved.facts.length)) {
      const guesses = [
        ...search.urls.filter((u) => hostFitsCountry(u, customer.country)).slice(0, 4),
        ...search.urls.filter((u) => scoreResearchUrl(u) >= 3).slice(0, 4),
        ...guessWebsiteUrls(legalName || company, customer.country),
      ];
      for (const guess of guesses) {
        if (openWebsite && guess === openWebsite) continue;
        if (COLLISION_HOST_RE.test(guess) || (!hostLooksLikeCompany(guess, legalName || company) && !/\.(gov|edu|mil)(\.|$)|(\.ac\.|\.go\.)/i.test(guess))) {
          continue;
        }
        const probe = await harvestContacts(guess, legalName || company, { extraUrls: search.urls, country: customer.country });
        if (probe.pages?.length && probe.verified) {
          harvested = probe;
          website = probe.website || guess;
          notes.push(search.urls.includes(guess)
            ? `搜索结果页核到官网 ${website}`
            : '公开库没有官网字段，已用主体名+国家域名打开，并核验页面提到该公司');
          break;
        }
      }
    }
    if (harvested.verified && !openWebsite && harvested.website) {
      facts.push({ label: '搜索官网', value: harvested.website, source: '搜索公式' });
      notes.push(`外贸搜索公式定位到 ${harvested.website}`);
    }

    const haveOutreach = filterOutreachEmails(harvested.emails || []).length > 0;
    if (!haveOutreach && !(harvested.emails || []).length && website && hostFromWebsite(website) !== hostFromWebsite(searchedWebsite)) {
      const siteSearch = await searchCompanyPages(legalName || company, {
        maxQueries: 3,
        website,
        country: customer.country,
      });
      search = mergeSearchHits(search, siteSearch);
      notes.push(...siteSearch.notes);
      if (harvested.website) {
        const again = await harvestContacts(website, legalName || company, { extraUrls: search.urls, country: customer.country });
        if (again.emails?.length || again.pages?.length) harvested = { ...harvested, ...again, emails: again.emails?.length ? again.emails : harvested.emails };
      }
    }

    const intelTexts = (search.items || []).flatMap((it) => [it.title, it.desc]);
    const snippetAddress = search.snippetAddress || addressFromSnippets(intelTexts);
    const snippetHours = search.snippetHours || hoursFromSnippets(intelTexts);
    const snippetPhones = parsePhones(intelTexts.join('\n'), '', phoneCountry(customer.country));
    if (snippetAddress) facts.push({ label: '公开地址', value: snippetAddress, source: '搜索摘要' });
    if (snippetHours) facts.push({ label: '营业时间', value: snippetHours, source: '搜索摘要' });

    const fromSearch = await harvestSearchContacts({
      urls: search.urls,
      snippetEmails: search.snippetEmails,
      company: legalName || company,
      website,
      fetchPages: !haveOutreach && !(snippetAddress && snippetPhones.length && (harvested.emails?.length || search.snippetEmails?.length)),
    });
    if (fromSearch.emails.length || fromSearch.pages.length) {
      harvested = {
        ...harvested,
        emails: mergeEmailLists(harvested.emails, fromSearch.emails),
        phones: [...new Set([...(harvested.phones || []), ...fromSearch.phones])].slice(0, 8),
        pages: [...(harvested.pages || []), ...fromSearch.pages.filter((p) => !(harvested.pages || []).some((x) => x.url === p.url))],
        tools: { ...(harvested.tools || {}), searchDorks: true },
      };
      if (fromSearch.emails.length) notes.push(`搜索引擎挖到角色邮箱：${fromSearch.emails.map((e) => e.email).join('、')}`);
    }

    harvestedTools = { ...(harvested.tools || {}), searchDorks: Boolean(harvested.tools?.searchDorks || search.urls.length) };
    if (harvested.website && (harvested.verified || openWebsite)) website = harvested.website;
    emails = harvested.emails || [];
    siteSocials = harvested.socials || [];
    siteOfficers = harvested.officers || [];
    const wikiPhones = facts.filter((f) => f.label === '公开电话').map((f) => f.value);
    phones = [...new Set([...(harvested.phones || []), ...snippetPhones, ...wikiPhones])].slice(0, 8);
    if (phones.length && !facts.some((f) => f.label === '公开电话')) {
      facts.push({ label: '公开电话', value: phones.join(' · '), source: '搜索摘要' });
    }
    pages = harvested.pages || [];
    if (harvested.error && !website) notes.push(`官网抓取：${harvested.error}`);
    if (harvested.whois?.created) {
      facts.push({
        label: '域名登记',
        value: [harvested.whois.domain, harvested.whois.created && `注册于 ${harvested.whois.created}`, harvested.whois.registrar].filter(Boolean).join(' · '),
        source: 'whoiser',
      });
    }
    if (harvested.meta?.description) {
      facts.push({ label: '官网简介', value: String(harvested.meta.description).slice(0, 240), source: 'cheerio' });
    }
    for (const p of pages) sources.push({ title: p.title || '官网', url: p.url });
    steps.push({
      key: 'website',
      label: '官网定位',
      ok: Boolean(website),
      detail: website || '公开库未给出官网，也没有核验通过的域名，未用未验证域名发信',
    });
    steps.push({
      key: 'contact',
      label: '公开联系方式',
      ok: emails.length > 0,
      detail: emails.length
        ? emailSourceLabel(emails)
        : website
          ? '官网和搜索都没有明文角色邮箱，联系方式多为表单，不能编造 purchase@ 去撞'
          : '搜索公式没有挖到可核验的公开角色邮箱',
    });
    steps.push({
      key: 'search',
      label: '搜索公式',
      ok: search.urls.length > 0 || search.snippetEmails.length > 0,
      detail: search.urls.length || search.snippetEmails.length
        ? `${searchEngineLabel(search.engine)}解析到 ${search.urls.length} 个公开页${search.snippetEmails.length ? `，摘要里看到 ${search.snippetEmails.length} 个邮箱线索` : ''}`
        : '搜索没有可用的背调页',
    });
  }

  steps.push({
    key: 'intent',
    label: '采购意图',
    ok: Boolean(customer.painPoints),
    detail: customer.painPoints ? String(customer.painPoints).slice(0, 160) : '入库摘要为空',
  });

  emails = attachEmailEvidence(emails, {
    website,
    country: customer.country,
    verifiedEntity: hasVerifiedEntity(facts),
    sameDomainFn: (item) => emailBelongsToCompany(item.email, hostFromWebsite(website), legalName || company),
  });
  const readyMails = emails.filter((e) => e.evidence?.ready);

  const [sanctions, traces, chOfficers] = await Promise.all([
    personLike ? { hits: [], screened: false, lists: [] } : screenSanctions(legalName || company),
    personLike
      ? []
      : findTradeTraces({
        company: legalName || company,
        country: customer.country,
        source: customer.source,
        sourceUrl: customer.sourceUrl,
        awardId: customer.awardId,
      }),
    personLike ? [] : fetchCompaniesHouseOfficers(companyNumberFromFacts(facts)),
  ]);
  const officers = mergeOfficers(
    chOfficers,
    siteOfficers,
    personLike ? [] : extractTenderPeople(`${customer.painPoints || ''} ${customer.title || ''} ${rfqCorpus(customer)}`),
  );
  const wikiSocials = facts
    .filter((f) => /LinkedIn|Facebook|^X$|Twitter|YouTube|Instagram|社媒/i.test(f.label))
    .map((f) => ({ label: f.label, url: f.value, source: f.source }));
  const socials = mergeSocials(siteSocials, wikiSocials);
  for (const o of officers.slice(0, 6)) {
    facts.push({ label: '公开职务', value: `${o.name} · ${o.title}`, source: o.source });
  }
  for (const s of socials) {
    if (!facts.some((f) => f.label === s.label && f.value === s.url)) {
      facts.push({ label: s.label, value: s.url, source: s.source || '官网公开页' });
    }
  }
  if (officers.length) {
    steps.push({
      key: 'officers',
      label: '公开职务',
      ok: true,
      detail: officers.slice(0, 3).map((o) => `${o.name}（${o.title}）`).join('、'),
    });
  }
  if (sanctions.error) notes.push(`制裁名单未能下载：${sanctions.error}`);
  else if (!personLike && !sanctions.screened) notes.push('制裁名单本轮未筛到，发信前请人工复核。');
  for (const hit of sanctions.hits || []) {
    facts.push({ label: '制裁名单', value: `${hit.name} · ${hit.list}`, source: hit.list });
    if (hit.url) sources.push({ title: `制裁 ${hit.name}`, url: hit.url });
  }
  for (const t of traces) {
    facts.push({ label: t.label, value: t.value, source: t.source });
    if (t.url) sources.push({ title: t.label, url: t.url });
  }
  steps.push({
    key: 'sanctions',
    label: '制裁筛查',
    ok: Boolean(sanctions.screened) && !(sanctions.hits || []).length,
    detail: !sanctions.screened
      ? '名单未下载'
      : sanctions.hits?.length
        ? `命中 ${sanctions.hits.map((h) => h.name).join('、')}`
        : `已对照 ${sanctions.lists.join(' / ')}，无命中`,
  });
  steps.push({
    key: 'trade',
    label: '采购痕迹',
    ok: traces.length > 0,
    detail: traces.length
      ? traces.map((t) => t.value).join('；')
      : '没有公开招标/联邦采购痕迹。海关提单需付费库，本轮未查。',
  });

  const kyb = {
    ...gradeKyb({
      personLike,
      forwarder: isForwarderName(legalName || company),
      verified: hasVerifiedEntity(facts),
      website,
      emails: readyMails,
      sanctions: sanctions.hits || [],
      procurement: hasProcurementTrace(customer, traces),
      legalName: legalName || company,
    }),
    sanctions: sanctions.hits || [],
    traces,
    screened: Boolean(sanctions.screened),
  };
  steps.push({
    key: 'grade',
    label: '背调分级',
    ok: kyb.grade === 'A',
    detail: `${kyb.grade} · ${kyb.nextAction}`,
  });
  notes.push(`分级 ${kyb.grade}：${kyb.nextAction}`);
  if (kyb.needRegNo) notes.push('标准动作：向询盘方要法定全称、登记号、付款主体，不要继续猜域名。');

  let brief = fallbackBrief({ customer, legalName, extract, emails, website, personLike, relatedNote });
  let entityType = personLike ? 'unknown_person' : emails.length || website ? 'unknown' : 'unknown';
  let buyingRole = customer.painPoints ? String(customer.painPoints).slice(0, 120) : '';
  let outreachAdvice = kyb.nextAction;
  let risks = kyb.risks.length ? kyb.risks : ['公开源有限，海关提单和信用报告需付费补'];

  if (useAi) {
    try {
      const ai = await aiBrief({
        name: customer.name,
        company,
        legalName,
        country: customer.country,
        source: customer.source,
        inquiry: customer.painPoints,
        website,
        emails,
        phones,
        extract,
        facts,
        notes,
        personLike,
        kyb,
      });
      if (ai.brief) brief = String(ai.brief);
      if (ai.entityType) entityType = String(ai.entityType);
      if (ai.buyingRole) buyingRole = String(ai.buyingRole);
      if (ai.outreachAdvice && kyb.grade !== 'C') outreachAdvice = String(ai.outreachAdvice);
      if (Array.isArray(ai.risks) && ai.risks.length && kyb.grade !== 'C') risks = ai.risks.map(String);
    } catch {
      notes.push('AI 摘要未生成，已用公开事实拼接。');
    }
  }

  const confidence = kyb.grade === 'C' || personLike
    ? 'none'
    : kyb.grade === 'A'
      ? 'high'
      : kyb.grade === 'B'
        ? 'medium'
        : 'low';

  const factOf = (re) => facts.find((f) => re.test(f.label))?.value || '';
  const intel = buildIntel({
    legalName,
    website,
    country: customer.country,
    facts,
    traces,
    emails,
    socials,
    officers,
  });

  return {
    status: 'done',
    updatedAt: new Date().toISOString(),
    confidence,
    legalName,
    website: website || '',
    emails,
    phones,
    address: factOf(/注册地址|总部|公开地址/),
    industry: factOf(/行业/),
    employees: factOf(/员工规模/),
    socials,
    facts,
    sources: dedupeSources(sources),
    pages,
    steps,
    brief,
    entityType,
    buyingRole,
    outreachAdvice,
    risks,
    notes,
    searchQueries: search.queries || (personLike ? crosspostLinks(clues, customer.country).map((l) => l.query) : []),
    searchLinks: personLike
      ? crosspostLinks(clues, customer.country)
      : (search.links || buildSearchLinks({
        company: legalName || company,
        country: customer.country,
        website,
        product: rfqProductTerms(`${customer.title || ''} ${customer.painPoints || ''}`),
      })),
    path,
    clues,
    crosspost,
    searchPages: (search.urls || []).slice(0, 8),
    kyb,
    grade: kyb.grade,
    nextAction: kyb.nextAction,
    needRegNo: kyb.needRegNo,
    officers,
    intel,
    canApplyEmail: readyMails.length > 0 && kyb.grade === 'A',
    outreach: {
      ready: kyb.grade === 'A' && readyMails.length > 0,
      email: readyMails[0]?.email || '',
      score: readyMails[0]?.evidence?.score || 0,
      website: website || '',
      reason: kyb.nextAction,
      greetingTitle: officers[0] ? `${officers[0].title}` : '',
      greetingName: officers[0]?.name || '',
    },
    tools: GITHUB_TOOLS.map((t) => ({
      ...t,
      used: t.id === 'cheerio' || t.id === 'tldts' || t.id === 'fuse'
        || (t.id === 'wikibase-sdk' && facts.some((f) => f.source === 'Wikidata'))
        || (t.id === 'libphonenumber-js' && phones.length > 0)
        || (t.id === 'whoiser' && Boolean(harvestedTools.whoiser))
        || (t.id === 'waybackurls' && Boolean(harvestedTools.wayback))
        || (t.id === 'subfinder' && Boolean(harvestedTools.crtsh))
        || (t.id === 'search-dorks' && Boolean(harvestedTools.searchDorks))
        || (t.id === 'google-cse' && search.engine === 'google-cse')
        || (t.id === 'serper' && search.engine === 'serper'),
    })),
  };
}

function dedupeSources(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const url = s?.url || '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(s);
  }
  return out.slice(0, 24);
}

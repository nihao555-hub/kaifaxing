import { parse as parseDomain } from 'tldts';
import { chat, parseJson } from './ai.js';
import { enrichOpenSources } from './openSources.js';
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
  waybackContactUrls,
  crtshHosts,
  whoisFacts,
} from './githubTools.js';
import {
  searchCompanyPages,
  scoreResearchUrl,
} from './searchDorks.js';
import { gradeKyb, hasVerifiedEntity, hasProcurementTrace, isForwarderName } from './kyb.js';
import { screenSanctions } from './sanctions.js';
import { findTradeTraces } from './tradeTraces.js';

const UA = 'OutreachAI/1.0 (public due-diligence; +https://github.com/nihao555-hub/kaifaxing)';

const LEGAL_SUFFIX_RE =
  /\b(limited|ltd\.?|inc\.?|incorporated|llc|l\.l\.c\.|gmbh|mbh|sarl|s\.a\.r\.l\.|plc|p\.l\.c\.|corp\.?|corporation|co\.|company|ag|s\.a\.|n\.v\.|b\.v\.|oy|ab|a\/s|s\.p\.a\.|s\.r\.l\.|pty|pvt|private|public|lp|llp|llc\.|m\.b\.h\.)\b/gi;

const INSTITUTION_RE =
  /\b(college|university|hospital|council|ministry|department|authority|agency|municipality|borough|county|city|trust|consortium|society|foundation|institute|school|police|nhs|government|kommune|gemeinde|stadt|amt)\b/i;

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
  const words = s.split(/\s+/).filter(Boolean);
  if (s.length > 42) return false;
  if (words.length === 1) return /^[A-Za-z][A-Za-z.'-]{2,24}$/.test(words[0]);
  if (words.length > 4) return false;
  if (words.every((w) => w.replace(/\./g, '').length <= 2)) return true;
  return words.length >= 2 && words.every((w) => /^[A-Za-z][A-Za-z.'-]{1,20}$/.test(w));
}

export function isPersonLikeLead(customer) {
  const company = String(customer?.company || '').trim();
  const name = String(customer?.name || '').trim();
  if (company) return isPersonLikeDisplayName(company);
  return isPersonLikeDisplayName(name);
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
  if (websiteHost) {
    const site = registrableDomain(websiteHost);
    const mail = registrableDomain(domain);
    if (site && (mail === site || domain.endsWith(`.${site}`))) return true;
  }
  const first = significantTokens(company)[0];
  return Boolean(first && first.length >= 4 && domain.includes(first));
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

export function extractPhones(html) {
  return parsePhones(pageText(html), html);
}

function pageTitle(html) {
  return cheerioTitle(html);
}

function pageMentionsCompany(html, company) {
  const tokens = significantTokens(company).filter((t) => t.length >= 4);
  const title = pageTitle(html).toLowerCase();
  const text = `${title} ${pageText(html).slice(0, 4000)}`.toLowerCase();
  if (!tokens.length) {
    return significantTokens(company).some((t) => text.includes(t));
  }
  const hits = tokens.filter((t) => text.includes(t));
  if (hits.length >= Math.min(2, tokens.length)) return true;
  if (hits.length >= 1 && title.includes(hits[0])) return true;
  return hits.length >= 1 && tokens[0].length >= 5;
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

const JUNK_ENTITY_RE = /family name|given name|surname|disambiguation|hamlet|researcher|footballer|singer|illustrator|writer|poet|actor|musician|politician/i;

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
    if (coverage >= 0.8 && (orgLike || companyTokens.length >= 2)) score = 1;
    else if (startsWithFirst && orgLike && labelTokens.length >= 2 && coverage >= 0.5) score = 0.7;
    else if (startsWithFirst && orgLike && parentHint && first.length >= 3 && coverage >= 0.25) score = 0.62;
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
  if (hasLegal && tokens[0] && tokens[0].length >= 3) {
    q.push(`${tokens[0]} Group`);
    q.push(`${tokens[0]} PLC`);
    q.push(`${tokens[0]} Inc`);
  }
  return [...new Set(q)].slice(0, 7);
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

  for (const q of queriesFor(company)) {
    const wdHits = await searchWikidata(q);
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

  if (!wikiTitle) {
    for (const q of queriesFor(company)) {
      const hits = await searchWikipedia(q);
      const picked = pickBestHit(hits, company, (h) => h.title);
      if (picked) {
        wikiTitle = picked.label;
        break;
      }
    }
  }

  if (wikiTitle) {
    const sum = await wikipediaSummary(wikiTitle);
    if (sum?.extract) extract = sum.extract;
    const wikiUrl = sum?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
    sources.push({ title: `Wikipedia · ${wikiTitle}`, url: wikiUrl });
    if (extract) facts.push({ label: '公开简介', value: extract.slice(0, 400), source: 'Wikipedia' });
    if (!website && sum?.content_urls) {
      /* official site still comes from Wikidata P856 when available */
    }
  }

  let gleif = [];
  const gleifQueries = queriesFor(company).filter((q) => significantTokens(q).length >= 2);
  for (const q of gleifQueries) {
    gleif = await searchGleif(q, 'legalName');
    if (gleif.length) break;
  }
  if (!gleif.length && gleifQueries.length) {
    for (const q of gleifQueries) {
      gleif = await searchGleif(q, 'fulltext');
      if (gleif.length) break;
    }
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

async function harvestContacts(website, company, { extraUrls = [] } = {}) {
  if (!website) return { emails: [], phones: [], pages: [], verified: false };
  let homeRes = { ok: false, status: 0, url: website, text: '', error: '未请求' };
  for (const home of websiteCandidates(website)) {
    homeRes = await fetchText(home, { accept: 'text/html', timeout: 14000 });
    if (homeRes.ok && homeRes.text) break;
  }
  if (!homeRes.ok) return { emails: [], phones: [], pages: [], verified: false, error: homeRes.error || `HTTP ${homeRes.status}` };

  const verified = pageMentionsCompany(homeRes.text, company) || pageMentionsCompany(homeRes.text, pageTitle(homeRes.text));
  const pages = [{ url: homeRes.url, title: pageTitle(homeRes.text) || '官网首页' }];
  const htmls = [homeRes.text];
  const [wayback, crtHosts] = await Promise.all([
    waybackContactUrls(homeRes.url),
    crtshHosts(homeRes.url),
  ]);
  let siteHost = '';
  try { siteHost = new URL(homeRes.url).hostname; } catch { /* ignore */ }
  const searchSameDomain = extraUrls.filter((u) => {
    try {
      return registrableDomain(u) === registrableDomain(siteHost);
    } catch {
      return false;
    }
  }).sort((a, b) => scoreResearchUrl(b) - scoreResearchUrl(a)).slice(0, 6);
  const extra = [
    ...discoverContactLinks(homeRes.text, homeRes.url),
    ...CONTACT_PATHS.map((p) => {
      try { return new URL(p, homeRes.url).toString(); } catch { return ''; }
    }).filter(Boolean),
    ...searchSameDomain,
    ...wayback,
    ...crtHosts.map((h) => `https://${h}/`),
  ].filter((u) => u && !isAssetUrl(u));
  const ranked = [...new Set(extra)].sort((a, b) => {
    const weight = (u) => (/impressum|imprint|kontakt|contact|procurement|purchasing/i.test(u) ? 0 : 1);
    return weight(a) - weight(b);
  });

  let fetched = 0;
  for (const url of ranked) {
    if (fetched >= 8) break;
    if (url === homeRes.url) continue;
    const r = await fetchText(url, { accept: 'text/html', timeout: 10000 });
    fetched += 1;
    if (!r.ok || !r.text) continue;
    if (isAssetUrl(r.url) || !/<html|mailto:|contact|@/i.test(r.text.slice(0, 4000))) continue;
    pages.push({ url: r.url, title: pageTitle(r.text) || url });
    htmls.push(r.text);
  }

  let host = '';
  try { host = new URL(homeRes.url).hostname; } catch { /* ignore */ }
  const emailMap = new Map();
  const phones = new Set();
  for (const html of htmls) {
    for (const item of extractEmails(html, { websiteHost: host })) {
      if (!emailBelongsToCompany(item.email, host, company)) continue;
      const prev = emailMap.get(item.email);
      if (!prev || item.score > prev.score) emailMap.set(item.email, { ...item, source: '官网公开页' });
    }
    for (const p of extractPhones(html)) phones.add(p);
  }

  const meta = pageMeta(homeRes.text);
  const whois = await whoisFacts(homeRes.url);
  return {
    emails: [...emailMap.values()].sort((a, b) => b.score - a.score).slice(0, 8),
    phones: [...phones].slice(0, 8),
    pages,
    verified,
    website: homeRes.url,
    meta,
    whois,
    tools: {
      cheerio: true,
      tldts: true,
      libphonenumber: phones.size > 0,
      wayback: wayback.length > 0,
      crtsh: crtHosts.length > 0,
      whoiser: Boolean(whois?.domain),
      searchDorks: searchSameDomain.length > 0,
    },
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
  const company = String(customer.company || customer.name || '').trim();
  const personLike = isPersonLikeLead(customer);
  const facts = [];
  const sources = [];
  const notes = [];
  const steps = [];

  if (customer.country) facts.push({ label: '国家/地区', value: customer.country, source: '入库' });
  if (customer.painPoints) facts.push({ label: '询盘/招标摘要', value: String(customer.painPoints).slice(0, 300), source: '入库' });
  if (customer.sourceUrl) sources.push({ title: '原始询盘/公告', url: customer.sourceUrl });

  let website = '';
  let legalName = company;
  let extract = '';
  let relatedNote = '';
  let emails = [];
  let phones = [];
  let pages = [];
  let harvestedTools = {};
  let search = { queries: [], urls: [], snippetEmails: [], officialGuess: '', notes: [], engine: '' };

  if (personLike) {
    steps.push({ key: 'entity', label: '主体核验', ok: false, detail: '只有个人显示名，公开库无法核到公司' });
    steps.push({ key: 'website', label: '官网定位', ok: false, detail: '无线索，未猜测域名' });
    steps.push({ key: 'contact', label: '公开联系方式', ok: false, detail: '不猜测私人邮箱，不从社交资料扒信' });
    steps.push({ key: 'search', label: '搜索公式', ok: false, detail: '个人昵称不拿去撞搜索结果' });
    notes.push('阿里等公开 RFQ 卡片经常只有买家昵称。没有公司全称时，外贸公式到此结束。');
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

    search = await searchCompanyPages(legalName || company, { maxQueries: 2 });
    notes.push(...search.notes);
    const openWebsite = website;
    if (search.officialGuess && !website) website = search.officialGuess;
    for (const it of (search.items || []).slice(0, 8)) {
      sources.push({ title: it.title || '搜索结果', url: it.url });
    }
    for (const u of search.urls.slice(0, 8)) {
      if (!sources.some((s) => s.url === u)) sources.push({ title: '搜索结果', url: u });
    }

    let harvested = website
      ? await harvestContacts(website, legalName || company, { extraUrls: search.urls })
      : { emails: [], phones: [], pages: [], verified: false };

    if (harvested.website && !harvested.verified && !openWebsite) {
      harvested = { emails: [], phones: [], pages: [], verified: false };
      website = '';
    }

    const haveVerifiedSite = Boolean(harvested.pages?.length && (harvested.verified || openWebsite));
    if (!haveVerifiedSite && (search.urls.length || resolved.facts.length)) {
      const guesses = [
        ...search.urls.filter((u) => scoreResearchUrl(u) >= 3).slice(0, 4),
        ...guessWebsiteUrls(legalName || company, customer.country),
      ];
      for (const guess of guesses) {
        if (openWebsite && guess === openWebsite) continue;
        const probe = await harvestContacts(guess, legalName || company, { extraUrls: search.urls });
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

    if (website && search.snippetEmails.length) {
      let host = '';
      try { host = new URL(website).hostname; } catch { /* ignore */ }
      const extra = [];
      for (const raw of search.snippetEmails) {
        if (!isPlausibleEmail(raw) || !emailBelongsToCompany(raw, host, legalName || company)) continue;
        extra.push({
          email: raw,
          role: raw.split('@')[0],
          score: scoreEmail(raw, host),
          source: '搜索摘要',
        });
      }
      if (extra.length) {
        const map = new Map((harvested.emails || []).map((e) => [e.email, e]));
        for (const item of extra) {
          const prev = map.get(item.email);
          if (!prev || item.score > prev.score) map.set(item.email, item);
        }
        harvested = { ...harvested, emails: [...map.values()].sort((a, b) => b.score - a.score).slice(0, 8) };
      }
    }

    harvestedTools = { ...(harvested.tools || {}), searchDorks: Boolean(harvested.tools?.searchDorks || search.urls.length) };
    if (harvested.website && (harvested.verified || openWebsite)) website = harvested.website;
    emails = harvested.emails || [];
    const wikiPhones = facts.filter((f) => f.label === '公开电话').map((f) => f.value);
    phones = [...new Set([...(harvested.phones || []), ...wikiPhones])].slice(0, 8);
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
        ? `官网公开页找到 ${emails.map((e) => e.email).join('、')}`
        : website
          ? '官网可打开，联系方式多为表单，没有明文角色邮箱'
          : '没有可核验的公开邮箱',
    });
    steps.push({
      key: 'search',
      label: '搜索公式',
      ok: search.urls.length > 0,
      detail: search.urls.length
        ? `${search.engine === 'google' ? '谷歌' : '必应'}解析到 ${search.urls.length} 个公开页`
        : '搜索没有可用的背调页',
    });
  }

  steps.push({
    key: 'intent',
    label: '采购意图',
    ok: Boolean(customer.painPoints),
    detail: customer.painPoints ? String(customer.painPoints).slice(0, 160) : '入库摘要为空',
  });

  const [sanctions, traces] = await Promise.all([
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
  ]);
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
      emails,
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
  const socials = facts
    .filter((f) => /LinkedIn|Facebook|^X$|Twitter|社媒/i.test(f.label))
    .map((f) => ({ label: f.label, url: f.value }));

  return {
    status: 'done',
    updatedAt: new Date().toISOString(),
    confidence,
    legalName,
    website: website || '',
    emails,
    phones,
    address: factOf(/注册地址|总部/),
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
    searchQueries: search.queries || [],
    searchPages: (search.urls || []).slice(0, 8),
    kyb,
    grade: kyb.grade,
    nextAction: kyb.nextAction,
    needRegNo: kyb.needRegNo,
    canApplyEmail: emails.length > 0 && kyb.grade === 'A',
    tools: GITHUB_TOOLS.map((t) => ({
      ...t,
      used: t.id === 'cheerio' || t.id === 'tldts' || t.id === 'fuse'
        || (t.id === 'wikibase-sdk' && facts.some((f) => f.source === 'Wikidata'))
        || (t.id === 'libphonenumber-js' && phones.length > 0)
        || (t.id === 'whoiser' && Boolean(harvestedTools.whoiser))
        || (t.id === 'waybackurls' && Boolean(harvestedTools.wayback))
        || (t.id === 'subfinder' && Boolean(harvestedTools.crtsh))
        || (t.id === 'search-dorks' && Boolean(harvestedTools.searchDorks)),
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

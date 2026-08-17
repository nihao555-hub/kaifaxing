/** 公开情报卡：角色邮箱证据分、公司社媒、公开职务。不搜人名、不猜私人邮箱。 */
import { getDomain } from 'tldts';
import { isOutreachEmail, emailLocalPart, filterOutreachEmails } from './kyb.js';
import { loadPage, pageText, pageTitle } from './githubTools.js';
import { hostFitsCountry } from './searchDorks.js';

export const OUTREACH_READY_MIN = 80;

const PROCUREMENT_ROLES = new Set([
  'procurement', 'purchasing', 'purchase', 'buying', 'buyer', 'sourcing',
  'tenders', 'tender', 'enquiry', 'inquiry', 'enquiries', 'inquiries',
]);
const GATE_ROLES = new Set(['info', 'contact', 'office']);
const SALES_ROLES = new Set(['sales', 'sale', 'export', 'import', 'trade', 'trading', 'suppliers', 'supplier', 'vendor']);

export function scoreEmailEvidence(item = {}, {
  website = '',
  sameDomain = false,
  countryFit = false,
  verifiedEntity = false,
} = {}) {
  const reasons = [];
  if (!isOutreachEmail(item)) {
    return { score: 0, ready: false, reasons: ['不是采购/总机角色箱'] };
  }
  if (website && !sameDomain) {
    return { score: 0, ready: false, reasons: ['邮箱域名与已核官网不一致'] };
  }
  let score = 0;
  if (sameDomain) {
    score += 40;
    reasons.push('与已核官网同域');
  }
  const role = String(item.role || emailLocalPart(item.email)).toLowerCase();
  if (PROCUREMENT_ROLES.has(role)) {
    score += 30;
    reasons.push('采购/询盘角色');
  } else if (GATE_ROLES.has(role)) {
    score += 20;
    reasons.push('总机/联系角色');
  } else if (SALES_ROLES.has(role)) {
    score += 12;
    reasons.push('销售角色');
  }

  const pages = item.pages || [];
  const blob = `${item.source || ''} ${pages.join(' ')}`;
  if (/tender|procurement|impressum|imprint|kontakt|contact/i.test(blob)) {
    score += 20;
    reasons.push('出自联系页/招标页');
  } else if (/官网|官方/.test(item.source || '')) {
    score += 10;
    reasons.push('出自官网');
  } else if (/搜索/.test(item.source || '')) {
    score += 4;
    reasons.push('仅搜索摘要');
  }

  const pageCount = new Set(pages.filter(Boolean)).size;
  if (pageCount >= 2) {
    score += 10;
    reasons.push('两个以上官方页出现');
  }
  if (countryFit) {
    score += 10;
    reasons.push('域名国家后缀匹配');
  }

  score = Math.min(100, score);
  const ready = Boolean(verifiedEntity && website && sameDomain && score >= OUTREACH_READY_MIN);
  if (!verifiedEntity) reasons.push('主体尚未核验');
  return { score, ready, reasons };
}

export function attachEmailEvidence(emails = [], {
  website = '',
  country = '',
  verifiedEntity = false,
  sameDomainFn,
} = {}) {
  return (emails || []).map((item) => {
    const sameDomain = typeof sameDomainFn === 'function'
      ? Boolean(sameDomainFn(item))
      : Boolean(website && item.email);
    const countryFit = Boolean(website && country && hostFitsCountry(website, country));
    const evidence = scoreEmailEvidence(item, {
      website,
      sameDomain,
      countryFit,
      verifiedEntity,
    });
    return { ...item, evidence, evidenceScore: evidence.score };
  }).sort((a, b) => (b.evidence?.score || 0) - (a.evidence?.score || 0));
}

export function classifyCompanySocial(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let host = '';
  let path = '';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    host = u.hostname.replace(/^www\./i, '').toLowerCase();
    path = u.pathname;
  } catch {
    return '';
  }
  if (/linkedin\.com$/i.test(host)) {
    if (/^\/(company|school|showcase)\//i.test(path)) return 'LinkedIn';
    return '';
  }
  if (/facebook\.com$/i.test(host) && !/sharer|dialog|share/i.test(path)) return 'Facebook';
  if (/^(twitter|x)\.com$/i.test(host) && !/intent|share/i.test(path)) return 'X';
  if (/youtube\.com$/i.test(host) && /^\/(channel|c|@|user)\//i.test(path)) return 'YouTube';
  if (/instagram\.com$/i.test(host) && !/^\/p\//i.test(path)) return 'Instagram';
  return '';
}

export function extractCompanySocials(html, pageUrl = '') {
  const $ = loadPage(html);
  const seen = new Set();
  const out = [];
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    let abs = href;
    try {
      abs = new URL(href, pageUrl || 'https://example.invalid').toString();
    } catch {
      return;
    }
    const label = classifyCompanySocial(abs);
    if (!label) return;
    const key = abs.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, url: abs, source: '官网公开页' });
  });
  return out.slice(0, 8);
}

const LEADER_TITLE = '(?:the\\s+)?(?:[A-Z][A-Za-z&/\\- ]{0,40}?)(?:Director|Principal|Chair(?:man|woman|person)?|President|Chief Executive|Chief Financial Officer|Vice[- ]?Chancellor|Vice Principal|Dean|Councillor|Governor|Manager|Officer)';

export function extractLeadership(html, { pageUrl = '', title = '' } = {}) {
  const hint = `${pageUrl} ${title} ${pageTitle(html)} ${pageText(html).slice(0, 500)}`;
  if (!/leadership|governance|governor|director|board|about|senior|executive|principal|management|impressum/i.test(hint)) {
    return [];
  }
  const text = pageText(html).replace(/\s+/g, ' ');
  const re = new RegExp(
    `((?:Dr|Prof|Mr|Mrs|Ms|Sir)\\.?\\s+)?([A-Z][a-zA-Z'\`-]+(?:\\s+[A-Z][a-zA-Z'\`-]+){1,3}),\\s+(${LEADER_TITLE})`,
    'g',
  );
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(re)) {
    const name = `${m[1] || ''}${m[2]}`.replace(/\s+/g, ' ').trim();
    const role = String(m[3] || '').replace(/\s+/g, ' ').trim();
    if (name.split(' ').length < 2 || name.length > 60) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      title: role,
      source: '官网公开页',
      url: pageUrl || '',
    });
  }
  return out.slice(0, 8);
}

export function extractTenderPeople(text) {
  const src = String(text || '');
  const re = /(?:contact|attention of|fao|attn)[:\s]+((?:Dr|Mr|Mrs|Ms)\.?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:,\s*([^.;\n]{3,80}))?/gi;
  const seen = new Set();
  const out = [];
  for (const m of src.matchAll(re)) {
    const name = `${m[1] || ''}${m[2]}`.replace(/\s+/g, ' ').trim();
    const title = String(m[3] || '').replace(/\s+/g, ' ').trim();
    if (name.split(' ').length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      title: title || '招标联系人',
      source: '招标/询盘原文',
      url: '',
    });
  }
  return out.slice(0, 4);
}

export function parseCompaniesHouseOfficers(json) {
  const rows = json?.items || [];
  return rows
    .filter((row) => !row.resigned_on)
    .map((row) => ({
      name: String(row.name || '').replace(/\s+/g, ' ').trim(),
      title: String(row.officer_role || 'officer').replace(/_/g, ' '),
      source: 'Companies House',
      url: '',
    }))
    .filter((row) => row.name)
    .slice(0, 8);
}

export function companyNumberFromFacts(facts = []) {
  for (const f of facts || []) {
    const blob = `${f.label || ''} ${f.value || ''} ${f.source || ''}`;
    if (!/Companies House|英国公司登记|登记号/i.test(blob)) continue;
    const m = String(f.value || '').match(/\b([A-Z]{2}\d{6}|\d{6,8})\b/);
    if (m) return m[1];
  }
  return '';
}

export function mergeOfficers(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of list || []) {
      const key = String(row.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out.slice(0, 12);
}

export function mergeSocials(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of list || []) {
      const key = String(row.url || '').toLowerCase().replace(/\/$/, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out.slice(0, 8);
}

export function factValue(facts, re) {
  return (facts || []).find((f) => re.test(f.label))?.value || '';
}

export function buildIntel({
  legalName = '',
  website = '',
  country = '',
  facts = [],
  traces = [],
  emails = [],
  socials = [],
  officers = [],
} = {}) {
  const ready = filterOutreachEmails(emails).find((e) => e.evidence?.ready);
  return {
    legalName,
    website,
    country,
    lei: factValue(facts, /^LEI$/),
    regNo: factValue(facts, /登记号|英国公司登记|SIREN|Org\.nr|IČO|CNPJ/),
    parent: factValue(facts, /最终母公司/),
    traces: (traces || []).slice(0, 6),
    socials,
    officers,
    emails: (emails || []).map((e) => ({
      email: e.email,
      role: e.role,
      source: e.source,
      score: e.evidence?.score || e.score || 0,
      ready: Boolean(e.evidence?.ready),
      reasons: e.evidence?.reasons || [],
    })),
    outreachEmail: ready?.email || '',
  };
}

export function registrableHost(urlOrHost) {
  const raw = String(urlOrHost || '').trim();
  if (!raw) return '';
  try {
    const host = raw.includes('://') ? new URL(raw).hostname : raw;
    return (getDomain(host, { allowPrivateDomains: true }) || host.replace(/^www\./i, '')).toLowerCase();
  } catch {
    return raw.replace(/^www\./i, '').toLowerCase();
  }
}

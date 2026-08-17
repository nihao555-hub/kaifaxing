/** 怎么拿到符合要求的背调：先有可核验主体，再查官网角色联系方式。不搜人名、不猜私人邮箱。 */
import { extractCompanyHintFromText, buyerFacingText } from './rfqHints.js';
import { countrySearchTerms, searchPageUrl, searchOfficialJson } from './searchDorks.js';

const PERSONAL_MAIL = /gmail|yahoo|ymail|hotmail|outlook|live\.com|icloud|proton|qq\.com|163\.com|126\.com/;
const ROLE_LOCAL = /^(info|enquiry|inquiry|enquiries|inquiries|contact|office|sales|sale|procurement|purchasing|purchase|buying|buyer|sourcing|export|import|trade|hello)$/i;
const MARKET_HOST = /alibaba|1688|aliexpress|amazon|ebay|facebook|linkedin|made-in-china|globalsources|tradeindia|indiamart/i;
const GENERIC_FP = /^(20v|12v|24v|110v|220v|usb|led|oem|odm|moq|iso|ce|rohs|202[0-9]|100pcs|pcs|www)$/i;

const COMPANY_IN_TEXT = /\b([A-Z][A-Za-z0-9&.'-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9&.'-]{1,}){0,6}\s+(?:L\.?L\.?C\.?|Ltd\.?|Limited|GmbH|Inc\.?|PLC|Pte\.?\s*Ltd\.?|S\.?A\.?|B\.?V\.?|Pvt\.?\s*Ltd\.?))\b/g;
const FINGERPRINT_RE = /\b(?=[A-Z0-9./-]{6,}\b)(?=[A-Z./-]*\d)(?=\d*[A-Z])[A-Z][A-Z0-9./-]{4,}\b/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const EMAIL_RE = /[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,24}/g;
const PHONE_RE = /(?:\+|00)\d{1,3}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/g;

export function rfqCorpus(customer = {}) {
  return [
    customer.painPoints,
    customer.title,
    customer.product,
    customer.publicCard?.subject,
    customer.publicCard?.description,
    customer.rfq?.title,
    customer.rfq?.description,
  ].filter(Boolean).join(' ');
}

const SUBJECT_STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'buyer', 'alibaba', 'rfq',
  'wholesale', 'custom', 'high', 'quality', 'factory',
]);

export function rfqSubject(customer = {}) {
  return String(
    customer.publicCard?.subject || customer.product || customer.title || customer.rfq?.title || '',
  ).replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Quoted product phrase for crosspost. Never includes the buyer nickname. */
export function distinctiveSubjectPhrase(subject) {
  const words = String(subject || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9.-]/g, ''))
    .filter((w) => w.length >= 3 && !SUBJECT_STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  if (words.length < 4) return '';
  return words.slice(0, 8).join(' ');
}

export function extractRfqClues(text) {
  const src = buyerFacingText(text);
  const companyHint = extractCompanyHintFromText(src);
  const websites = [];
  const seenHost = new Set();
  for (const raw of src.match(URL_RE) || []) {
    try {
      const u = new URL(raw.replace(/[),.;]+$/, ''));
      const host = u.hostname.replace(/^www\./i, '').toLowerCase();
      if (MARKET_HOST.test(host) || seenHost.has(host)) continue;
      if (!/\.[a-z]{2,}$/i.test(host)) continue;
      seenHost.add(host);
      websites.push(`https://${host}${u.pathname === '/' ? '' : u.pathname}`);
    } catch {
      /* ignore */
    }
  }
  const emails = [];
  for (const raw of src.match(EMAIL_RE) || []) {
    const email = raw.toLowerCase();
    const [local, domain] = email.split('@');
    if (!local || !domain || PERSONAL_MAIL.test(domain) || MARKET_HOST.test(domain)) continue;
    if (!ROLE_LOCAL.test(local)) continue;
    emails.push(email);
  }
  const phones = [...new Set((src.match(PHONE_RE) || []).map((s) => s.replace(/\s+/g, ' ').trim()))].slice(0, 4);
  const fingerprints = [];
  const seenFp = new Set();
  for (const raw of src.match(FINGERPRINT_RE) || []) {
    const token = raw.replace(/[.,;]+$/, '');
    const key = token.toUpperCase();
    if (GENERIC_FP.test(key) || seenFp.has(key)) continue;
    if (token.length > 28) continue;
    seenFp.add(key);
    fingerprints.push(token);
  }
  return {
    companyHint,
    websites: websites.slice(0, 3),
    emails: [...new Set(emails)].slice(0, 3),
    phones,
    fingerprints: fingerprints.slice(0, 4),
  };
}

export function classifyResearchPath(customer = {}, { personLike = false, clues } = {}) {
  const found = clues || extractRfqClues(rfqCorpus(customer));
  if (customer.email && customer.forceCompany) {
    return {
      key: 'auto',
      label: '可自动背调',
      next: '主体已补且有邮箱，按官网角色邮箱走开发信流程。',
      clues: found,
    };
  }
  if (!personLike || customer.forceCompany || customer.regNo || found.companyHint) {
    return {
      key: 'auto',
      label: '可自动背调',
      next: found.companyHint
        ? `正文写到 ${found.companyHint}，按这家公司核官网和角色邮箱。`
        : '有公司全称或机构名，走公开主体库 + 搜索公式。',
      clues: found,
    };
  }
  if (found.websites.length || found.emails.length) {
    return {
      key: 'clues',
      label: '正文有主体线索',
      next: found.emails[0]
        ? `正文出现角色邮箱 ${found.emails[0]}，先核域名是不是这家，再决定发不发。`
        : `正文出现官网 ${found.websites[0]}，从联系页挖角色邮箱，不搜买家昵称。`,
      clues: found,
    };
  }
  const phrase = distinctiveSubjectPhrase(rfqSubject(customer));
  if (found.fingerprints.length || phrase) {
    return {
      key: 'crosspost',
      label: '用询盘指纹交叉检索',
      next: found.fingerprints.length
        ? `不搜「${customer.company || customer.name}」这个人。用型号 ${found.fingerprints.join(' / ')} 找同款公开询盘，看别的站点有没有写出公司名。`
        : `不搜「${customer.company || customer.name}」这个人。用产品「${phrase}」在公开招标/其它 B2B 站找写出公司名的同款需求。`,
      clues: found,
    };
  }
  return {
    key: 'import',
    label: '需补主体',
    next: '公开卡只有昵称和产品句。符合要求的背调要从阿里后台报价/导出拿到法定名，或让对方回登记号。',
    clues: found,
  };
}

export function crosspostQueries(clues = {}, country = '', customer = {}) {
  const place = countrySearchTerms(country).filter((t) => !t.includes(' ')).slice(0, 2);
  const queries = [];
  for (const fp of (clues.fingerprints || []).slice(0, 2)) {
    const token = `"${fp.replace(/"/g, '')}"`;
    queries.push(`${token} (RFQ OR "buying request" OR "want to buy" OR inquiry)`);
    if (place[0]) queries.push(`${token} ${place[0]} (company OR Ltd OR LLC OR contact)`);
  }
  const phrase = distinctiveSubjectPhrase(rfqSubject(customer) || clues.subject || '');
  if (phrase) {
    queries.push(`"${phrase}" (RFQ OR "buying request" OR "want to buy" OR "looking for") -site:alibaba.com -site:alicdn.com`);
    if (place[0]) {
      queries.push(`"${phrase}" ${place[0]} (Ltd OR Limited OR Inc OR GmbH OR "Pvt Ltd" OR company)`);
    }
  }
  return [...new Set(queries)].slice(0, 4);
}

export function crosspostLinks(clues, country) {
  return crosspostQueries(clues, country).map((query) => ({
    query,
    google: searchPageUrl('google', query),
    bing: searchPageUrl('bing', query),
  }));
}

export function companiesFromSnippets(items = [], { country = '' } = {}) {
  const place = countrySearchTerms(country).map((s) => s.replace(/"/g, '').toLowerCase()).filter((s) => s.length >= 3);
  const counts = new Map();
  for (const it of items) {
    const blob = `${it.title || ''} ${it.desc || ''} ${it.snippet || ''}`;
    const hits = blob.match(COMPANY_IN_TEXT) || [];
    const placeOk = !place.length || place.some((w) => blob.toLowerCase().includes(w));
    for (const raw of hits) {
      const name = raw.replace(/\s+/g, ' ').trim();
      if (/alibaba|trade assurance|gold supplier/i.test(name)) continue;
      if (name.length < 6 || name.length > 80) continue;
      const key = name.toLowerCase();
      const prev = counts.get(key) || { name, n: 0, placeOk: false, sample: blob.slice(0, 160) };
      prev.n += 1;
      prev.placeOk = prev.placeOk || placeOk;
      counts.set(key, prev);
    }
  }
  return [...counts.values()]
    .filter((x) => x.placeOk || !place.length)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
}

function rawSearchItems(json) {
  const rows = json?.organic || json?.items || [];
  return rows.map((r) => ({
    url: r.link || r.url || '',
    title: r.title || '',
    desc: r.snippet || r.htmlSnippet || '',
  })).filter((r) => r.url || r.title);
}

export async function suggestCrosspostCompany(clues, country, customer = {}) {
  const queries = crosspostQueries(clues, country, customer);
  const items = [];
  let engine = '';
  let error = '';
  for (const query of queries.slice(0, 2)) {
    const r = await searchOfficialJson(query);
    if (r.engine) {
      engine = r.engine;
      items.push(...rawSearchItems(r.json));
      continue;
    }
    error = r.error || error;
  }
  const companies = companiesFromSnippets(items, { country });
  return {
    queries,
    engine,
    error,
    items: items.slice(0, 8),
    companies,
    company: companies[0]?.n >= 1 && companies[0].placeOk ? companies[0].name : '',
  };
}

export function parseAlibabaExportRow(row = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
    }
    return '';
  };
  return {
    company: pick(
      'buyer_company_name', 'buyerCompanyName', 'company_name', 'companyName', 'company',
      '买家公司', '公司名称', 'Buyer Company', 'Company Name',
    ),
    name: pick('buyer_name', 'buyerName', 'contact', 'name', '买家', '联系人', 'Buyer Name'),
    email: pick('buyer_email', 'buyerEmail', 'email', 'contactEmail', '邮箱', 'Email'),
    country: pick('country', 'buyer_country', 'buyerCountry', '国家', 'Country'),
    title: pick('subject', 'rfq_title', 'title', 'product', '询盘标题', 'Product Name'),
    painPoints: pick('description', 'requirement', 'painPoints', '需求', 'Description'),
    awardId: pick('rfq_id', 'rfqId', 'id', '询盘ID', 'RFQ ID'),
    url: pick('url', 'link', 'sourceUrl'),
  };
}

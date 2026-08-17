/** 阿里询盘怎么对齐网易外贸通：公开列表没有邮箱；报价/后台导出解锁后，再补工商级情报。 */

import { parseAlibabaExportRow } from './researchPath.js';
import { isPersonLikeDisplayName } from './research.js';

const ALI_SOURCE = /阿里|Alibaba|ICBU|国际站/i;
const PERSONAL_MAIL = /gmail|yahoo|ymail|hotmail|outlook|live\.com|icloud|proton|qq\.com|163\.com|126\.com|mail\.ru/i;

export function isAlibabaLead(customer = {}) {
  return ALI_SOURCE.test(customer.source || '') || Boolean(customer.publicCard?.rfqId);
}

export function buyerClusterKey(customer = {}) {
  const alias = String(customer.buyerAlias || customer.publicCard?.buyerName || customer.name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const country = String(customer.country || customer.publicCard?.country || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!alias || alias === 'alibaba buyer') return '';
  return `${alias}|${country}`;
}

export function rfqIdOf(row = {}) {
  return String(row.awardId || row.rfq_id || row.rfqId || row.publicCard?.rfqId || '').trim();
}

export function isSellerUnlocked(customer = {}) {
  return customer.contactSource === 'alibaba_seller' || customer.identitySource === 'alibaba_seller';
}

export function applySellerExportToLead(customer, row = {}) {
  if (!customer) return false;
  const parsed = row.company || row.email ? row : parseAlibabaExportRow(row);
  const company = String(parsed.company || '').trim();
  const email = String(parsed.email || '').trim().toLowerCase();
  const name = String(parsed.name || '').trim();
  const website = String(parsed.website || '').trim();
  let changed = false;

  if (company && company !== customer.company) {
    customer.buyerAlias = customer.buyerAlias || customer.company || customer.name;
    customer.company = company;
    customer.legalName = customer.legalName || company;
    if (!isPersonLikeDisplayName(company)) customer.forceCompany = true;
    customer.identitySource = 'alibaba_seller';
    customer.research = null;
    changed = true;
  }
  if (name && (!customer.name || customer.name === customer.buyerAlias || /alibaba buyer/i.test(customer.name))) {
    customer.name = name;
    changed = true;
  }
  if (email && email !== String(customer.email || '').toLowerCase()) {
    customer.email = email;
    customer.contactSource = 'alibaba_seller';
    if (customer.agentPhase === 'need_email') customer.agentPhase = null;
    changed = true;
  }
  if (website && !customer.website) {
    customer.website = website;
    changed = true;
  }
  if (parsed.country && !customer.country) {
    customer.country = parsed.country;
    changed = true;
  }
  return changed;
}

export function findAlibabaMatch(customers = [], row = {}) {
  const rfqId = rfqIdOf(row);
  if (rfqId) {
    const hit = customers.find((c) => isAlibabaLead(c) && rfqIdOf(c) === rfqId);
    if (hit) return hit;
  }
  const parsed = row.company || row.name ? row : parseAlibabaExportRow(row);
  const name = String(parsed.name || '').trim().toLowerCase();
  const country = String(parsed.country || '').trim().toLowerCase();
  const title = String(parsed.title || '').trim().toLowerCase();
  if (!name || !country) return null;
  const same = customers.filter((c) => {
    if (!isAlibabaLead(c)) return false;
    const key = buyerClusterKey(c);
    return key === `${name}|${country}` || key.endsWith(`|${country}`) && key.startsWith(`${name}|`);
  });
  if (same.length === 1) return same[0];
  if (title) {
    const byTitle = same.find((c) => String(c.product || c.publicCard?.subject || '').toLowerCase() === title);
    if (byTitle) return byTitle;
  }
  return null;
}

export function mergeAlibabaSellerExport(customers = [], rows = []) {
  let updated = 0;
  let unmatched = 0;
  const touched = [];
  for (const raw of rows) {
    const parsed = parseAlibabaExportRow(raw);
    if (!parsed.company && !parsed.email) {
      unmatched += 1;
      continue;
    }
    const hit = findAlibabaMatch(customers, { ...raw, ...parsed });
    if (!hit) {
      unmatched += 1;
      continue;
    }
    if (applySellerExportToLead(hit, parsed)) {
      updated += 1;
      touched.push(hit);
    }
  }
  return { updated, unmatched, touched };
}

export function propagateAlibabaIdentity(customers = []) {
  const groups = new Map();
  for (const c of customers) {
    if (!isAlibabaLead(c)) continue;
    const key = buyerClusterKey(c);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  let propagated = 0;
  for (const siblings of groups.values()) {
    if (siblings.length < 2) continue;
    const seed = siblings.find((c) => c.forceCompany && c.company && !isPersonLikeDisplayName(c.company));
    if (!seed) continue;
    for (const c of siblings) {
      if (c === seed || c.forceCompany) continue;
      c.buyerAlias = c.buyerAlias || c.company || c.name;
      c.company = seed.company;
      c.legalName = seed.legalName || seed.company;
      c.forceCompany = true;
      c.identitySource = c.identitySource || seed.identitySource || 'alibaba_cluster';
      if (seed.website && !c.website) c.website = seed.website;
      c.research = null;
      propagated += 1;
    }
  }
  return { clusters: [...groups.values()].filter((g) => g.length > 1).length, propagated };
}

export function alibabaSiblings(customers = [], customer = {}) {
  const key = buyerClusterKey(customer);
  if (!key) return [];
  return customers.filter((c) => c !== customer && isAlibabaLead(c) && buyerClusterKey(c) === key);
}

/** 人工打开，不自动抓。邦阅/米课的第一步是人名+国家去谷歌/领英，不是批量撞库。 */
export function peopleSearchLinks(customer = {}) {
  const name = String(customer.buyerAlias || customer.publicCard?.buyerName || customer.name || '').trim();
  const country = String(customer.country || customer.publicCard?.country || '').trim();
  if (!name || /alibaba buyer/i.test(name) || name.length < 3) return [];
  const q = [name, country].filter(Boolean).join(' ');
  const enc = encodeURIComponent(q);
  return [
    { key: 'google-people', label: '谷歌搜人名+国家', url: `https://www.google.com/search?q=${enc}` },
    { key: 'bing-people', label: '必应搜人名+国家', url: `https://www.bing.com/search?q=${enc}` },
    { key: 'linkedin', label: '领英搜人', url: `https://www.linkedin.com/search/results/people/?keywords=${enc}` },
  ];
}

export function buildAlibabaDossier(customer = {}, { siblings = [], research = null } = {}) {
  const report = research || customer.research || {};
  const unlocked = isSellerUnlocked(customer);
  const legalName = report.legalName || customer.legalName || (customer.forceCompany ? customer.company : '');
  const displayName = customer.buyerAlias || customer.publicCard?.buyerName || customer.name || '';
  const email = customer.email || report.outreach?.email || '';
  const facts = report.facts || [];
  const fact = (re) => facts.find((f) => re.test(f.label))?.value || '';
  const subjects = [customer.product || customer.publicCard?.subject, ...siblings.map((s) => s.product || s.publicCard?.subject)]
    .filter(Boolean)
    .slice(0, 8);
  const categories = [...new Set([customer.categoryName, ...siblings.map((s) => s.categoryName)].filter(Boolean))];

  let next = '';
  if (unlocked && email) {
    next = '阿里后台已解锁联系方式。再核官网和制裁后，按外贸通节奏写开发信。';
  } else if (legalName) {
    next = `已有法定名「${legalName}」。按工商/官网挖角色邮箱；没有明文箱就走官网表单，不要猜 Gmail。`;
  } else {
    next = '公开列表没有邮箱。在国际站对这条询盘报价后，从卖家后台导出 buyer_company_name / buyer_email，按询盘 ID 回填。不登录爬 Buyer profile。';
  }

  return {
    platform: '阿里国际站',
    displayName,
    legalName,
    country: customer.country || '',
    contactName: unlocked ? customer.name : displayName,
    email,
    emailSource: customer.contactSource || '',
    unlocked,
    personalInbox: Boolean(email && PERSONAL_MAIL.test(email)),
    website: report.website || customer.website || '',
    regNo: customer.regNo || fact(/登记号|英国公司登记|SIREN|Org\.nr|IČO|CNPJ/),
    lei: fact(/^LEI$/),
    address: report.address || fact(/注册地址|总部|地址/),
    employees: report.employees || fact(/员工规模/),
    officers: (report.officers || []).slice(0, 4),
    traces: (report.traces || []).slice(0, 4),
    rfqCount: 1 + siblings.length,
    categories,
    subjects,
    grade: report.kyb?.grade || report.grade || '',
    next,
    peopleSearchLinks: peopleSearchLinks(customer),
  };
}

export function summarizeAlibabaPlan(customers = []) {
  const counts = {
    total: 0,
    auto: 0,
    crosspost: 0,
    import: 0,
    textHint: 0,
    sellerUnlocked: 0,
    hasEmail: 0,
    repeatBuyers: 0,
  };
  const clusters = new Map();
  for (const c of customers) {
    if (!isAlibabaLead(c)) continue;
    counts.total += 1;
    if (c.email) counts.hasEmail += 1;
    if (isSellerUnlocked(c)) counts.sellerUnlocked += 1;
    if (c.identitySource === 'rfq_text') counts.textHint += 1;
    const path = c.researchPath || 'import';
    if (path === 'auto' || path === 'clues') counts.auto += 1;
    else if (path === 'crosspost') counts.crosspost += 1;
    else counts.import += 1;
    const key = buyerClusterKey(c);
    if (key) clusters.set(key, (clusters.get(key) || 0) + 1);
  }
  counts.repeatBuyers = [...clusters.values()].filter((n) => n > 1).length;
  return counts;
}

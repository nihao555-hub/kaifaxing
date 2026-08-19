/**
 * 1 万条样本漏斗 + 高星核验算法（Reacher check-if-email-exists / AfterShip email-verifier）。
 * 只核「角色@已有公司域名」。不猜 Gmail，不跑 holehe，不对 12 万条批量撞私人邮箱。
 */
import { extractCompanyHintFromText, companyFromBuyerName } from './rfqHints.js';
import { extractRfqClues, rfqCorpus } from './researchPath.js';
import { isDistinctivePersonName } from './peopleProbe.js';
import { heuristicRoleLocals, buildRoleCandidates, mailDomainFromWebsite, PERSONAL_INBOX } from './inferEmail.js';
import { lookupMx, verifyMailboxes } from './smtpVerify.js';

export const GUESS_TOOL = {
  name: 'check-if-email-exists',
  repo: 'https://github.com/reacherhq/check-if-email-exists',
  stars: '9k+',
  also: 'https://github.com/AfterShip/email-verifier',
};

export function strideSample(items = [], n = 10000) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.min(Math.max(Number(n) || 0, 0), list.length);
  if (!limit) return [];
  if (list.length <= limit) return list.slice();
  const step = list.length / limit;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < limit; i += 1) {
    let idx = Math.min(list.length - 1, Math.floor(i * step));
    while (seen.has(idx) && idx < list.length - 1) idx += 1;
    seen.add(idx);
    out.push(list[idx]);
  }
  return out;
}

export function classifyGuessLead(customer = {}) {
  const clues = extractRfqClues(rfqCorpus(customer), customer);
  const display = String(customer.buyerAlias || customer.publicCard?.buyerName || customer.name || '').trim();
  const glued = companyFromBuyerName(display) || companyFromBuyerName(customer.company);
  const textHint = clues.companyHint && clues.companyHint !== glued ? clues.companyHint : (extractCompanyHintFromText(rfqCorpus(customer)) || '');
  const website = customer.website || clues.websites[0] || '';
  const domain = mailDomainFromWebsite(website);
  const existingEmail = String(customer.email || '').trim().toLowerCase();
  const personalExisting = Boolean(existingEmail && PERSONAL_INBOX.test(existingEmail.split('@')[1] || ''));
  return {
    display,
    glued: glued || '',
    textHint: textHint && textHint !== glued ? textHint : (glued ? '' : textHint),
    companyHint: glued || textHint || '',
    website,
    domain,
    existingEmail: personalExisting ? '' : existingEmail,
    personalExisting,
    distinctivePerson: isDistinctivePersonName(display),
    fingerprints: clues.fingerprints || [],
    haveAnnexes: Boolean(customer.haveAnnexes),
    hasImage: Boolean(customer.imageUrl),
    country: customer.country || '',
  };
}

export function reachabilityOf({ free = false, role = false, hasMx = false, smtp } = {}) {
  if (free) return 'invalid';
  if (!hasMx) return 'invalid';
  if (smtp === 'catch_all') return 'risky';
  if (smtp === 'accepted' && role) return 'safe';
  if (smtp === 'rejected') return 'invalid';
  if (smtp === 'blocked' || smtp === 'unknown' || smtp === 'tempfail') return 'unknown';
  if (hasMx && role) return 'risky';
  return 'unknown';
}

export function roleCandidatesFor(row) {
  if (!row.domain) return [];
  return buildRoleCandidates(`https://${row.domain}`, heuristicRoleLocals({
    painPoints: row.textHint,
    product: 'RFQ',
  }));
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

export async function runGuessSample(customers = [], {
  size = 10000,
  smtpLimit = 20,
  mxConcurrency = 20,
  lookup = lookupMx,
  verify = verifyMailboxes,
} = {}) {
  const sample = strideSample(customers, size);
  const rows = sample.map((c) => classifyGuessLead(c));
  const counts = {
    sample: rows.length,
    gluedCompany: 0,
    textHint: 0,
    hasDomain: 0,
    hasWebsite: 0,
    existingRoleEmail: 0,
    personalExisting: 0,
    distinctivePerson: 0,
    personOnly: 0,
    alibaba: 0,
    government: 0,
    alibabaPersonOnly: 0,
    alibabaHasDomain: 0,
    fingerprints: 0,
    haveAnnexes: 0,
    hasImage: 0,
    candidates: 0,
    mxYes: 0,
    mxNo: 0,
    smtpTried: 0,
    smtpAccepted: 0,
    smtpCatchAll: 0,
    smtpBlocked: 0,
    reachableSafe: 0,
    reachableRisky: 0,
    reachableInvalid: 0,
    reachableUnknown: 0,
  };

  const domainSet = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const src = String(sample[i]?.source || '');
    const ali = /阿里|alibaba/i.test(src);
    const gov = /TED|Contracts Finder|USASpending|SAM|World Bank/i.test(src);
    if (ali) counts.alibaba += 1;
    if (gov) counts.government += 1;
    if (row.glued) counts.gluedCompany += 1;
    if (row.textHint) counts.textHint += 1;
    if (row.website) counts.hasWebsite += 1;
    if (row.domain) counts.hasDomain += 1;
    if (row.existingEmail) counts.existingRoleEmail += 1;
    if (row.personalExisting) counts.personalExisting += 1;
    if (row.distinctivePerson) counts.distinctivePerson += 1;
    if (row.fingerprints.length) counts.fingerprints += 1;
    if (row.haveAnnexes) counts.haveAnnexes += 1;
    if (row.hasImage) counts.hasImage += 1;
    if (!row.glued && !row.textHint && !row.domain && !row.existingEmail) {
      counts.personOnly += 1;
      if (ali) counts.alibabaPersonOnly += 1;
    }
    if (ali && row.domain) counts.alibabaHasDomain += 1;
    if (row.domain && !domainSet.has(row.domain)) {
      domainSet.set(row.domain, roleCandidatesFor(row));
    }
  }
  counts.uniqueDomains = domainSet.size;
  counts.candidates = [...domainSet.values()].reduce((n, list) => n + list.length, 0);

  const domains = [...domainSet.keys()];
  const mxHits = await mapPool(domains, mxConcurrency, async (domain) => {
    const mx = await lookup(domain);
    return { domain, mx: mx[0]?.exchange || '', hasMx: mx.length > 0 };
  });
  const mxByDomain = new Map(mxHits.map((x) => [x.domain, x]));
  for (const hit of mxHits) {
    if (hit.hasMx) counts.mxYes += 1;
    else counts.mxNo += 1;
  }

  const smtpTargets = mxHits.filter((x) => x.hasMx).slice(0, smtpLimit);
  const smtpByDomain = new Map();
  for (const hit of smtpTargets) {
    const emails = (domainSet.get(hit.domain) || []).slice(0, 3);
    if (!emails.length) continue;
    counts.smtpTried += 1;
    const probe = await verify(emails);
    smtpByDomain.set(hit.domain, probe);
    if (probe.catchAll) counts.smtpCatchAll += 1;
    else if ((probe.results || []).some((r) => r.status === 'accepted')) counts.smtpAccepted += 1;
    else if ((probe.results || []).some((r) => r.status === 'blocked')) counts.smtpBlocked += 1;
  }

  const examples = { glued: [], domain: [], mx: [] };
  for (const row of rows) {
    if (row.glued && examples.glued.length < 8) {
      examples.glued.push({ name: row.display, company: row.glued, country: row.country });
    }
    if (row.domain && examples.domain.length < 8) {
      const mx = mxByDomain.get(row.domain);
      examples.domain.push({
        company: row.companyHint || row.display,
        domain: row.domain,
        hasMx: Boolean(mx?.hasMx),
        mx: mx?.mx || '',
      });
    }
  }
  examples.mx = examples.domain.filter((x) => x.hasMx).slice(0, 8);

  for (const hit of mxHits) {
    const smtp = smtpByDomain.get(hit.domain);
    const smtpStatus = smtp?.catchAll
      ? 'catch_all'
      : smtp?.results?.[0]?.status;
    const reach = reachabilityOf({
      free: false,
      role: true,
      hasMx: hit.hasMx,
      smtp: smtpStatus,
    });
    if (reach === 'safe') counts.reachableSafe += 1;
    else if (reach === 'risky') counts.reachableRisky += 1;
    else if (reach === 'invalid') counts.reachableInvalid += 1;
    else counts.reachableUnknown += 1;
  }

  return {
    tool: GUESS_TOOL,
    note: '高星项目是核验器，不是 Hunter。1 万条里多数没有公司域名，猜 Gmail 没有可核主体。',
    counts,
    examples,
  };
}

/** 全量联系流水线：所有线索进同一条线。可跑的先官网/电话+背调，再角色箱。 */
import { extractRfqClues, rfqCorpus } from './researchPath.js';
import { isPersonLikeLead } from './research.js';
import { isAlibabaLead, isSellerUnlocked } from './alibabaIntel.js';
import { filterOutreachEmails, isOutreachEmail } from './kyb.js';

export const CONTACT_WAVES = ['site', 'email', 'crosspost'];

export function leadHasWebsite(customer = {}) {
  return Boolean(customer.website || customer.research?.website);
}

export function leadHasPhones(customer = {}) {
  if ((customer.research?.phones || []).length) return true;
  return (customer.research?.facts || []).some((f) => f.label === '公开电话' && f.value);
}

export function leadHasRoleEmail(customer = {}) {
  if (customer.email && (customer.contactSource === 'alibaba_seller' || isOutreachEmail(customer.email))) {
    return true;
  }
  return filterOutreachEmails(customer.research?.emails || []).length > 0;
}

function triedSite(customer = {}) {
  const stage = customer.research?.contactStage || '';
  return stage === 'need-site' || stage === 'await_email' || stage === 'done' || stage === 'email';
}

function triedEmail(customer = {}) {
  const stage = customer.research?.contactStage || '';
  return stage === 'done' || stage === 'email';
}

/**
 * Where this lead sits on the one contact line.
 * site → email → done. Nicknames stay on seller/identity. SKU-only → crosspost.
 */
export function contactGap(customer = {}) {
  const sanctions = customer.research?.kyb?.sanctions || [];
  if (sanctions.length) return 'stop';
  if (isSellerUnlocked(customer) && customer.email && customer.research?.kyb?.grade === 'A') return 'done';
  if (isSellerUnlocked(customer) && customer.email) return 'kyb';

  const clues = extractRfqClues(rfqCorpus(customer), customer);
  const person = isPersonLikeLead(customer);
  const named = !person || customer.forceCompany || customer.regNo || clues.companyHint;
  const path = customer.researchPath || (person ? 'import' : 'auto');

  if (named || clues.websites[0] || clues.emails[0] || customer.website) {
    if (!leadHasWebsite(customer)) {
      if (triedSite(customer)) return 'stuck';
      return 'site';
    }
    if (!leadHasRoleEmail(customer)) {
      if (triedEmail(customer)) return 'stuck';
      return 'email';
    }
    return 'done';
  }

  if (clues.fingerprints.length || path === 'crosspost') return 'crosspost';
  if (isAlibabaLead(customer)) return 'seller';
  return 'identity';
}

export function summarizeContactLine(customers = []) {
  const counts = {
    total: 0,
    site: 0,
    email: 0,
    crosspost: 0,
    seller: 0,
    identity: 0,
    kyb: 0,
    done: 0,
    stop: 0,
    stuck: 0,
    runnable: 0,
  };
  for (const c of customers) {
    if (!c?.source && !c?.awardId && !c?.sourceUrl && c?.agentPhase !== 'need_email') continue;
    counts.total += 1;
    const gap = contactGap(c);
    if (counts[gap] != null) counts[gap] += 1;
    else counts.identity += 1;
  }
  counts.runnable = counts.site + counts.email + counts.crosspost;
  return counts;
}

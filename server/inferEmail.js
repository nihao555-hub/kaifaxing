/** 有已核公司域名时，推断角色箱并用 SMTP 核对。不猜 Gmail，不拼名.姓@私人邮箱。 */
import { getDomain } from 'tldts';
import { config } from './config.js';
import { chat, parseJson } from './ai.js';
import { hostFromWebsite } from './searchDorks.js';
import { OUTREACH_ROLES, isOutreachEmail } from './kyb.js';
import { verifyMailboxes } from './smtpVerify.js';

export const PERSONAL_INBOX = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|proton|protonmail|qq|163|126|yeah|aol|hey|gmx|mail)\./i;

const BUYING_HINT = /procur|purchas|rfq|quot|buyer|buying|sourcing|inquiry|enquiry|want to buy|looking for/i;

export function mailDomainFromWebsite(website) {
  const host = hostFromWebsite(website);
  if (!host || PERSONAL_INBOX.test(host)) return '';
  const root = getDomain(host, { allowPrivateDomains: true }) || host;
  if (!root || PERSONAL_INBOX.test(root)) return '';
  return root.toLowerCase();
}

export function heuristicRoleLocals(customer = {}) {
  const text = [customer.product, customer.painPoints, customer.title, customer.publicCard?.subject]
    .filter(Boolean)
    .join(' ');
  if (BUYING_HINT.test(text)) {
    return ['procurement', 'purchasing', 'enquiry', 'info', 'contact', 'import'];
  }
  return ['info', 'contact', 'enquiry', 'sales', 'office', 'procurement'];
}

export function filterRankedLocals(locals = [], fallback = []) {
  const allow = new Set(OUTREACH_ROLES);
  const out = [];
  for (const raw of [...locals, ...fallback]) {
    const local = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!allow.has(local) || out.includes(local)) continue;
    out.push(local);
    if (out.length >= 6) break;
  }
  return out;
}

export async function rankRoleLocals(customer = {}, { chatFn } = {}) {
  const fallback = heuristicRoleLocals(customer);
  const run = chatFn || (config.ai.apiKey ? chat : null);
  if (!run) return fallback.slice(0, 4);
  try {
    const text = await run([
      {
        role: 'system',
        content: '你只从给定角色里排序公司总机/采购邮箱本地部分。禁止 gmail/yahoo、禁止人名.姓、禁止发明不在列表里的角色。只输出 JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          company: customer.company || customer.legalName || '',
          country: customer.country || '',
          product: customer.product || customer.publicCard?.subject || '',
          snippet: String(customer.painPoints || '').slice(0, 280),
          allow: [...OUTREACH_ROLES],
          format: { locals: ['procurement', 'info'] },
        }),
      },
    ], { temperature: 0 });
    const json = parseJson(text);
    const ranked = filterRankedLocals(json.locals || json.roles || []);
    return ranked.length ? ranked : fallback.slice(0, 4);
  } catch {
    return fallback.slice(0, 4);
  }
}

export function buildRoleCandidates(website, locals = []) {
  const domain = mailDomainFromWebsite(website);
  if (!domain) return [];
  return filterRankedLocals(locals).map((local) => `${local}@${domain}`);
}

export async function inferAndVerifyEmails({
  website,
  company,
  customer = {},
  knownEmails = [],
  chatFn,
  verify = verifyMailboxes,
} = {}) {
  const domain = mailDomainFromWebsite(website);
  if (!domain) {
    return {
      domain: '',
      catchAll: false,
      mx: '',
      candidates: [],
      accepted: [],
      results: [],
      notes: ['没有已核公司域名，不能推断角色邮箱，更不能猜 Gmail。'],
    };
  }
  const locals = await rankRoleLocals({ ...customer, company: company || customer.company }, { chatFn });
  const known = new Set((knownEmails || []).map((e) => String(e.email || e).toLowerCase()));
  const candidates = buildRoleCandidates(`https://${domain}`, locals).filter((email) => !known.has(email));
  if (!candidates.length) {
    return {
      domain,
      catchAll: false,
      mx: '',
      candidates: [],
      accepted: [],
      results: [],
      notes: ['官网页上的角色箱已经够用，不再用 SMTP 撞同一域名。'],
    };
  }
  const probe = await verify(candidates);
  const accepted = [];
  for (const row of probe.results || []) {
    if (row.status !== 'accepted') continue;
    if (!isOutreachEmail({ email: row.email, role: row.email.split('@')[0] })) continue;
    accepted.push({
      email: row.email,
      role: row.email.split('@')[0],
      score: 56,
      source: 'inferred_smtp',
      smtp: { status: row.status, mx: probe.mx, reason: row.reason || '' },
    });
  }
  const notes = [];
  if (probe.catchAll) {
    notes.push(`${domain} 的 MX 接受任意本地部分（catch-all），SMTP 不能证明推断邮箱存在。`);
  } else if (accepted.length) {
    notes.push(`SMTP 在 ${probe.mx || domain} 接受 ${accepted.map((e) => e.email).join('、')}。未在官网页见到，不自动群发。`);
  } else if ((probe.results || []).some((r) => r.status === 'blocked')) {
    notes.push(`SMTP 探活被拦（常见是云主机封 25 端口）：${(probe.results[0] || {}).reason || 'blocked'}。推断名单只作参考。`);
  } else {
    notes.push(`已按询盘推断 ${candidates.join('、')}，SMTP 没有确认存在。`);
  }
  return {
    domain,
    catchAll: Boolean(probe.catchAll),
    mx: probe.mx || '',
    candidates,
    accepted,
    results: probe.results || [],
    notes,
  };
}

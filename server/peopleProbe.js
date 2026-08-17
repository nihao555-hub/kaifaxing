/** 圈内「人名+国家对人」的公开搜索实验。不接 Hunter/Apollo/Lusha，不猜 Gmail。 */
import { searchOfficialJson } from './searchDorks.js';
import { companiesFromSnippets } from './researchPath.js';
import { companyFromBuyerName } from './rfqHints.js';

export const EMAIL_GUESS_REFUSAL =
  '不猜 Gmail/Yahoo，不接 Hunter / Apollo / Lusha / RocketReach / ContactOut。那是撞私人邮箱，不是背调。有公司域名再挖 info@ / procurement@，或导入卖家后台解锁的邮箱。';

const ORG_IN_NAME = /\b(ltd|limited|llc|gmbh|inc|plc|company|group|services|solutions|boutique|engineering|trading)\b/i;

export function isEmailGuessRequest(payload = {}) {
  if (payload.guessEmail || payload.hunter || payload.apollo || payload.lusha || payload.rocketReach || payload.contactOut) {
    return true;
  }
  const pattern = String(payload.pattern || payload.emailPattern || payload.guess || '');
  return /gmail|yahoo|hotmail|outlook|first\.last|hunter|apollo|lusha|rocketreach|contactout|verify-email/i.test(pattern);
}

export function isDistinctivePersonName(name) {
  const s = String(name || '').trim();
  if (!/^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(s)) return false;
  if (ORG_IN_NAME.test(s) || companyFromBuyerName(s)) return false;
  const words = s.split(/\s+/);
  const last = words[words.length - 1] || '';
  return last.length >= 6 && words[0].length >= 3;
}

export function snippetMentionsPerson(name, ...texts) {
  const tokens = String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  if (tokens.length < 2) return false;
  const blob = texts.join(' ').toLowerCase();
  return tokens.every((t) => blob.includes(t));
}

export function filterNamedHits(items = [], name) {
  return (items || []).filter((it) => snippetMentionsPerson(name, it.title, it.desc, it.snippet, it.link));
}

function rawSearchItems(json) {
  const rows = json?.organic || json?.items || [];
  return rows.map((r) => ({
    url: r.link || r.url || '',
    title: r.title || '',
    desc: r.snippet || r.htmlSnippet || '',
    snippet: r.snippet || r.htmlSnippet || '',
  })).filter((r) => r.url || r.title);
}

export function peopleSearchQueries(name, country = '') {
  const person = String(name || '').replace(/"/g, '').trim();
  const place = String(country || '').replace(/"/g, '').trim();
  if (!person) return [];
  return [
    `"${person}"${place ? ` ${place}` : ''}`,
    `"${person}" (Ltd OR Limited OR GmbH OR Inc OR "Pvt Ltd" OR company)`,
  ];
}

/**
 * 只从「片段里出现了这个全名」的结果抽 Ltd/LLC。
 * 无密钥必应常返回完全不相关条目；没有全名共现就不写公司。
 */
export async function probePeopleCompany(customer = {}, { search = searchOfficialJson } = {}) {
  const name = String(customer.buyerAlias || customer.publicCard?.buyerName || customer.name || '').trim();
  const country = String(customer.country || customer.publicCard?.country || '').trim();
  if (!isDistinctivePersonName(name)) {
    return {
      tried: false,
      reason: 'not_distinctive',
      queries: [],
      namedHits: 0,
      companies: [],
      company: '',
      note: '显示名不够独特，或本身像公司名。Linda / John 这种不拿去撞搜索。',
    };
  }
  const queries = peopleSearchQueries(name, country);
  const items = [];
  let engine = '';
  let error = '';
  for (const query of queries.slice(0, 2)) {
    const r = await search(query);
    if (r?.engine) {
      engine = r.engine;
      items.push(...rawSearchItems(r.json));
      continue;
    }
    error = r?.error || error;
  }
  const unique = [];
  const seen = new Set();
  for (const it of items) {
    const key = `${it.url || ''}|${it.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  const named = filterNamedHits(unique, name);
  const companies = companiesFromSnippets(named, { country }).map((c) => ({
    name: c.name,
    n: c.n,
    sample: String(c.sample || '').slice(0, 160),
  }));
  return {
    tried: true,
    engine,
    error,
    queries,
    namedHits: named.length,
    companies,
    company: companies[0]?.n >= 1 ? companies[0].name : '',
    note: named.length
      ? '片段里出现了这个全名。仍可能是重名，只当公司候选，不扒私人邮箱、不装 RocketReach。'
      : '公开搜索没有把这个全名对上公司。圈内靠「这个 Linda 是不是那个 Linda」，重名极多；无密钥必应还经常返回无关页。',
  };
}

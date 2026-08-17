/** Same-product public buyers from official notices. Not the Alibaba nickname. */
import { searchUk } from './rfq.js';
import { rfqProductTerms } from './searchDorks.js';
import { distinctiveSubjectPhrase, rfqSubject } from './researchPath.js';

export function peerKeyword(customer = {}) {
  const phrase = distinctiveSubjectPhrase(rfqSubject(customer));
  if (phrase) return phrase.split(' ').slice(0, 4).join(' ');
  const terms = rfqProductTerms(`${customer.categoryName || ''} ${rfqSubject(customer)}`, { max: 3 });
  return terms.join(' ') || String(customer.categoryName || '').trim();
}

export async function searchDemandPeers(customer = {}, { limit = 6 } = {}) {
  const keyword = peerKeyword(customer);
  if (!keyword || keyword.length < 4) return [];
  try {
    const rows = await searchUk({ keyword, limit });
    return rows.filter((r) => r.company && String(r.company).length >= 4);
  } catch {
    return [];
  }
}

export function clusterDemandKeywords(customers = [], { maxClusters = 16 } = {}) {
  const counts = new Map();
  for (const c of customers) {
    const key = peerKeyword(c);
    if (!key || key.length < 4) continue;
    const prev = counts.get(key) || { keyword: key, n: 0, sample: c };
    prev.n += 1;
    counts.set(key, prev);
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, maxClusters);
}

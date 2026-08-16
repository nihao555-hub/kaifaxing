const UA = 'OutreachAI/1.0 (public due-diligence; +https://github.com/nihao555-hub/kaifaxing)';

const LISTS = [
  { id: 'us_ofac_sdn', label: 'OFAC SDN' },
  { id: 'un_sc_sanctions', label: 'UN' },
  { id: 'eu_fsf', label: 'EU' },
  { id: 'gb_fcdo_sanctions', label: 'UK Sanctions List' },
];

const STOP = new Set([
  'limited', 'ltd', 'inc', 'incorporated', 'llc', 'gmbh', 'plc', 'corp', 'corporation',
  'company', 'group', 'the', 'and', 'of', 'for', 'co', 'sa', 'ojsc', 'oao', 'jsc',
  'pjsc', 'ooo', 'zao', 'public', 'private', 'holding', 'holdings', 'international',
]);

/** 行业通用词不能单独当制裁证据，否则 Transportation / Energy 会误中 */
const GENERIC = new Set([
  'transportation', 'shipping', 'energy', 'pipeline', 'agency', 'freight', 'cargo',
  'trading', 'oil', 'gas', 'service', 'services', 'industries', 'industrial', 'logistics',
  'marine', 'aviation', 'construction', 'engineering', 'technologies', 'technology',
  'technical', 'commercial', 'center', 'centre',
  'solutions', 'systems', 'enterprises', 'enterprise', 'partners', 'capital',
  'investment', 'investments', 'bank', 'trust', 'united', 'national', 'general',
]);

const cache = { at: 0, rows: [] };
const TTL_MS = 12 * 60 * 60 * 1000;

export function sanctionTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["'().,]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function wholeWord(hay, token) {
  return new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`, 'i').test(hay);
}

/** 只收高重合：避免 Kier / Tyne 这种短词误中 */
export function matchSanctionNames(company, rows) {
  const tokens = sanctionTokens(company);
  const brand = tokens.filter((t) => t.length >= 4 && !GENERIC.has(t));
  if (!brand.length) return [];
  const hits = [];
  for (const row of rows) {
    const hay = String(row.name || '').toLowerCase();
    if (!hay) continue;
    if (!brand.every((t) => wholeWord(hay, t))) continue;
    hits.push({ name: row.name, list: row.list, url: row.url || '' });
    if (hits.length >= 5) break;
  }
  return hits;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/plain' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function loadSanctionNames({ force = false } = {}) {
  if (!force && cache.rows.length && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = [];
  for (const list of LISTS) {
    try {
      const index = await fetchJson(`https://data.opensanctions.org/datasets/latest/${list.id}/index.json`);
      const file = (index.resources || []).find((r) => r.name === 'names.txt');
      if (!file?.url) continue;
      const text = await fetchText(file.url);
      for (const line of text.split(/\n/)) {
        const name = line.trim();
        if (name.length < 4) continue;
        rows.push({
          name,
          list: list.label,
          url: `https://www.opensanctions.org/search/?q=${encodeURIComponent(name)}`,
        });
      }
    } catch {
      /* 单份名单失败不阻断其余 */
    }
  }
  if (rows.length) {
    cache.rows = rows;
    cache.at = Date.now();
  }
  return cache.rows.length ? cache.rows : rows;
}

export async function screenSanctions(company) {
  const q = String(company || '').trim();
  if (q.length < 4) return { hits: [], screened: false, lists: [] };
  try {
    const rows = await loadSanctionNames();
    if (!rows.length) return { hits: [], screened: false, lists: LISTS.map((l) => l.label) };
    return {
      hits: matchSanctionNames(q, rows),
      screened: true,
      lists: LISTS.map((l) => l.label),
    };
  } catch (err) {
    return { hits: [], screened: false, lists: LISTS.map((l) => l.label), error: err.message };
  }
}

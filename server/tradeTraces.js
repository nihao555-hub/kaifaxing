import { pickOpenHit } from './openSources.js';

const UA = 'OutreachAI/1.0 (public due-diligence; +https://github.com/nihao555-hub/kaifaxing)';

function isUsLike(country) {
  return /united states|usa\b|\bus\b|美国/i.test(String(country || ''));
}

export async function searchUsaSpendingRecipients(company) {
  const q = String(company || '').trim();
  if (q.length < 4) return [];
  const res = await fetch('https://api.usaspending.gov/api/v2/autocomplete/recipient/', {
    method: 'POST',
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_text: q }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.results || [];
}

export function parseUsaSpendingHit(row) {
  if (!row?.recipient_name) return null;
  return {
    name: row.recipient_name,
    uei: row.uei || '',
    url: `https://www.usaspending.gov/search/?q=${encodeURIComponent(row.recipient_name)}`,
  };
}

/** 公开采购痕迹：询盘本身的招标 + 美国联邦收款方。海关提单仍是付费源，这里不假装已接。 */
export async function findTradeTraces({ company, country, source = '', sourceUrl = '', awardId = '' } = {}) {
  const traces = [];
  if (sourceUrl || awardId || /USASpending|Contracts Finder|TED|World Bank|SAM/i.test(source)) {
    traces.push({
      label: '原始采购/招标',
      value: [source, awardId].filter(Boolean).join(' · ') || '询盘附件',
      url: sourceUrl || '',
      source: '询盘',
    });
  }

  if (isUsLike(country) || /USASpending|SAM/i.test(source)) {
    try {
      const rows = await searchUsaSpendingRecipients(company);
      const picked = pickOpenHit(rows, company, (h) => h.recipient_name || '');
      const hit = parseUsaSpendingHit(picked);
      if (hit) {
        traces.push({
          label: '美国联邦采购收款方',
          value: hit.name,
          url: hit.url,
          source: 'USASpending',
        });
      }
    } catch {
      /* 公开接口失败不阻断背调 */
    }
  }

  return traces;
}

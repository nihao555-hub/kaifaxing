async function req(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export const api = {
  getCustomers: () => req('/api/customers'),
  addCustomer: (payload) => req('/api/customers', { method: 'POST', body: JSON.stringify(payload) }),
  getThread: (id) => req(`/api/customers/${id}/thread`),
  generate: (customerId, extraContext) =>
    req('/api/ai/generate', { method: 'POST', body: JSON.stringify({ customerId, extraContext }) }),
  evaluate: (customerId, subject, body) =>
    req('/api/ai/evaluate', { method: 'POST', body: JSON.stringify({ customerId, subject, body }) }),
  batchSend: (items, mode) =>
    req('/api/batch/send', { method: 'POST', body: JSON.stringify({ items, mode }) }),
  getJobs: () => req('/api/batch/jobs'),
  getJob: (id) => req(`/api/batch/jobs/${id}`),
  getQuota: () => req('/api/quota'),
  getAgent: () => req('/api/agent'),
  startAgent: () => req('/api/agent/start', { method: 'POST', body: '{}' }),
  stopAgent: () => req('/api/agent/stop', { method: 'POST', body: '{}' }),
  rfqSources: () => req('/api/rfq/sources'),
  rfqSearch: (source, q, extra = {}) => {
    const qs = new URLSearchParams({
      source: source || 'all',
      q: q || '',
      since: extra.since || '2026-07-01',
    });
    if (extra.limit) qs.set('limit', String(extra.limit));
    return req(`/api/rfq/search?${qs}`);
  },
  rfqImport: (items) => req('/api/rfq/import', { method: 'POST', body: JSON.stringify({ items }) }),
  rfqIngest: (payload) => req('/api/rfq/ingest', { method: 'POST', body: JSON.stringify(payload) }),
  rfqCrawl: (payload) => req('/api/rfq/public/crawl', { method: 'POST', body: JSON.stringify(payload) }),
  rfqCrawlAll: (payload) => req('/api/rfq/crawl-all', { method: 'POST', body: JSON.stringify(payload || {}) }),
  rfqCrawlAllStatus: () => req('/api/rfq/crawl-all'),
  rfqSchema: () => req('/api/rfq/schema'),
  updateCustomer: (id, payload) => req(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
};

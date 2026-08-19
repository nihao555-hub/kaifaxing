/** 公开页/搜索 fetch：带重试，避免偶发网络抖动拖垮背调队列。 */
const RETRYABLE = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|aborted|timeout|socket hang up/i;

export function isRetryableFetchError(err = '') {
  return RETRYABLE.test(String(err || ''));
}

export async function fetchWithRetry(url, init = {}, { retries = 3, backoffMs = 600 } = {}) {
  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      return res;
    } catch (err) {
      lastErr = String(err.message || err);
      if (attempt >= retries || !isRetryableFetchError(lastErr)) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
    }
  }
  throw new Error(lastErr || 'fetch failed');
}

export async function fetchTextRetry(url, { timeout = 12000, accept = '*/*', retries = 3, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchWithRetry(url, {
      headers: { Accept: accept, ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    }, { retries });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch (err) {
    return { ok: false, status: 0, url, text: '', error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

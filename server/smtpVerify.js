/** 对已核公司域名做 MX RCPT 探测。不发信、不猜 Gmail、不扫私人邮箱。 */
import net from 'node:net';
import { resolveMx as dnsResolveMx } from 'node:dns/promises';

const DEFAULT_TIMEOUT_MS = 8000;

export function classifySmtpCode(code) {
  const n = Number(code);
  if (n >= 200 && n < 300) return 'accepted';
  if (n >= 500 && n < 600) return 'rejected';
  if (n >= 400 && n < 500) return 'tempfail';
  return 'unknown';
}

export function parseSmtpReply(buffer) {
  const text = String(buffer || '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const m = last.match(/^(\d{3})([\s-])/);
  const code = m ? Number(m[1]) : 0;
  const more = Boolean(m && m[2] === '-');
  return { code, more, status: classifySmtpCode(code), text: last.slice(0, 180) };
}

function readReply(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('smtp timeout'));
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const parsed = parseSmtpReply(buf);
      if (parsed.code && !parsed.more) {
        cleanup();
        resolve(parsed);
      }
    };
    const onErr = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onErr);
    };
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

export async function lookupMx(domain, resolveMx = dnsResolveMx) {
  const host = String(domain || '').replace(/^www\./i, '').toLowerCase();
  if (!host) return [];
  try {
    const rows = await resolveMx(host);
    return (rows || []).slice().sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

export function catchAllLocal() {
  return `no-box-${Math.random().toString(36).slice(2, 12)}`;
}

async function openSmtp(host, { connect, timeoutMs }) {
  if (connect) return connect(host);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: 25 }, () => resolve(socket));
    socket.setTimeout(timeoutMs);
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('smtp timeout'));
    });
  });
}

/**
 * 同一条 SMTP 会话先探 catch-all，再探候选。
 * 全收 = 域名吞所有地址，不能当「这个邮箱是真的」。
 */
export async function verifyMailboxes(emails = [], {
  resolveMx = dnsResolveMx,
  connect,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  catchAll = catchAllLocal(),
} = {}) {
  const list = [...new Set((emails || []).map((e) => String(e || '').toLowerCase()).filter((e) => e.includes('@')))];
  if (!list.length) return { catchAll: false, mx: '', results: [] };
  const domain = list[0].split('@')[1];
  if (list.some((e) => e.split('@')[1] !== domain)) {
    throw new Error('一次只核同一个域名');
  }
  const mxRows = await lookupMx(domain, resolveMx);
  if (!mxRows.length) {
    return {
      catchAll: false,
      mx: '',
      results: list.map((email) => ({ email, status: 'unknown', reason: 'no_mx' })),
    };
  }
  const mx = mxRows[0].exchange;
  let socket;
  try {
    socket = await openSmtp(mx, { connect, timeoutMs });
    const banner = await readReply(socket, timeoutMs);
    if (banner.status !== 'accepted') {
      return {
        catchAll: false,
        mx,
        results: list.map((email) => ({ email, status: 'blocked', reason: banner.text || 'banner' })),
      };
    }
    socket.write(`EHLO outreach-ai.invalid\r\n`);
    const ehlo = await readReply(socket, timeoutMs);
    if (ehlo.status !== 'accepted') {
      return {
        catchAll: false,
        mx,
        results: list.map((email) => ({ email, status: 'blocked', reason: ehlo.text || 'ehlo' })),
      };
    }
    socket.write('MAIL FROM:<>\r\n');
    const from = await readReply(socket, timeoutMs);
    if (from.status !== 'accepted') {
      return {
        catchAll: false,
        mx,
        results: list.map((email) => ({ email, status: 'unknown', reason: from.text || 'mail_from' })),
      };
    }

    socket.write(`RCPT TO:<${catchAll}@${domain}>\r\n`);
    const bait = await readReply(socket, timeoutMs);
    if (bait.status === 'accepted') {
      return {
        catchAll: true,
        mx,
        results: list.map((email) => ({
          email,
          status: 'catch_all',
          reason: '域名接受任意本地部分，SMTP 不能证明邮箱存在',
        })),
      };
    }

    const results = [];
    for (const email of list) {
      socket.write(`RCPT TO:<${email}>\r\n`);
      const rcpt = await readReply(socket, timeoutMs);
      results.push({
        email,
        status: rcpt.status === 'accepted' ? 'accepted' : rcpt.status === 'rejected' ? 'rejected' : 'unknown',
        reason: rcpt.text || '',
        code: rcpt.code,
      });
    }
    return { catchAll: false, mx, results };
  } catch (err) {
    return {
      catchAll: false,
      mx,
      results: list.map((email) => ({
        email,
        status: 'blocked',
        reason: String(err.message || err).slice(0, 120),
      })),
    };
  } finally {
    if (socket) {
      try { socket.write('QUIT\r\n'); } catch { /* ignore */ }
      socket.destroy();
    }
  }
}

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from './config.js';
import { db, save, logActivity, appendThread } from './store.js';
import { stripQuotedReply } from './context.js';

let lastError = null;
let lastPollAt = null;

function normalize(addr) {
  return String(addr || '').trim().toLowerCase();
}

function findCustomerByEmail(fromAddr) {
  const from = normalize(fromAddr);
  return db.customers.find((c) => normalize(c.email) === from);
}

async function extractText(source) {
  try {
    const parsed = await simpleParser(source);
    return stripQuotedReply(parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '');
  } catch {
    return stripQuotedReply(String(source || '').replace(/^[\s\S]*?\r?\n\r?\n/, ''));
  }
}

export function ingestInbound(customer, { subject, body, from }) {
  const clean = stripQuotedReply(body);
  const already = (db.threads[customer.id] || []).some(
    (t) => t.type === 'inbound' && t.subject === subject && t.body?.slice(0, 80) === clean.slice(0, 80)
  );
  if (already) return false;

  appendThread(customer.id, {
    id: `in_${Date.now()}`,
    type: 'inbound',
    label: '客户回复',
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    subject,
    body: clean.slice(0, 2000) || subject,
    from: from || customer.email,
  });
  customer.status = 'replied';
  customer.agentPhase = 'replied';
  customer.lastActivity = new Date().toISOString().slice(0, 10);
  customer.pendingReply = { subject, body: clean.slice(0, 2000) };
  save();
  logActivity({
    customerId: customer.id,
    action: '收到回复',
    detail: `${customer.name} 来信「${subject}」：${clean.slice(0, 80)}… Agent 将带着完整来往上下文回信`,
  });
  return true;
}

export async function pollInbox() {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: true,
    auth: { user: config.imap.user, pass: config.imap.pass },
    logger: false,
  });

  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    for await (const msg of client.fetch({ seen: false, since }, { envelope: true, source: true })) {
      const from = msg.envelope?.from?.[0]?.address;
      const customer = findCustomerByEmail(from);
      if (!customer || normalize(from) === normalize(config.smtp.user)) continue;
      const subject = msg.envelope?.subject || '(no subject)';
      const body = await extractText(msg.source);
      ingestInbound(customer, { subject, body, from });
    }
    lastPollAt = new Date().toISOString();
    lastError = null;
  } finally {
    await client.logout().catch(() => {});
  }
}

export function inboxStatus() {
  return { lastPollAt, lastError };
}

export async function safePollInbox() {
  try {
    await pollInbox();
  } catch (err) {
    lastError = String(err.message || err).slice(0, 240);
    logActivity({
      customerId: null,
      action: '收件箱同步失败',
      detail: `IMAP 未能读取回复（${lastError}）。请确认 163 已开启 IMAP。`,
    });
  }
}

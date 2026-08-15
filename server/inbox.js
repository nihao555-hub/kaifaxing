import { ImapFlow } from 'imapflow';
import { config } from './config.js';
import { db, save, logActivity, appendThread } from './store.js';

// 轮询 163 收件箱，把真实客户的回复挂回对应沟通历史
let lastError = null;
let lastPollAt = null;

function normalize(addr) {
  return String(addr || '').trim().toLowerCase();
}

function findCustomerByEmail(fromAddr) {
  const from = normalize(fromAddr);
  return db.customers.find((c) => normalize(c.email) === from);
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
    const unseen = [];
    for await (const msg of client.fetch({ seen: false, since }, { envelope: true, source: true })) {
      unseen.push(msg);
    }

    for (const msg of unseen) {
      const from = msg.envelope?.from?.[0]?.address;
      const customer = findCustomerByEmail(from);
      if (!customer) continue;
      if (normalize(from) === normalize(config.smtp.user)) continue;

      const subject = msg.envelope?.subject || '(no subject)';
      const body = msg.source ? String(msg.source).slice(0, 4000) : '';
      const already = (db.threads[customer.id] || []).some(
        (t) => t.type === 'inbound' && t.subject === subject && t.body?.slice(0, 80) === body.slice(0, 80)
      );
      if (already) continue;

      appendThread(customer.id, {
        id: `in_${msg.uid || Date.now()}`,
        type: 'inbound',
        label: '客户回复',
        time: new Date().toISOString().slice(0, 16).replace('T', ' '),
        subject,
        body: body.replace(/^[\s\S]*?\r?\n\r?\n/, '').slice(0, 2000) || subject,
      });
      customer.status = 'replied';
      customer.agentPhase = 'replied';
      customer.lastActivity = new Date().toISOString().slice(0, 10);
      customer.pendingReply = {
        subject,
        body: (db.threads[customer.id] || []).slice(-1)[0]?.body || '',
      };
      save();
      logActivity({
        customerId: customer.id,
        action: '收到回复',
        detail: `${customer.name} 已回复「${subject}」，Agent 将自动起草并回信`,
      });
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
      detail: `IMAP 未能读取回复（${lastError}）。请确认 163 已开启 IMAP。Agent 仍会按未回复规则自动跟进。`,
    });
  }
}

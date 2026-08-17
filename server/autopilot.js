import { config } from './config.js';
import { generateEmail, evaluateEmail, generateFollowUp, generateReply } from './agent.js';
import { createBatchJob, cancelPendingSends, resumeSending, cancelScheduledFor } from './scheduler.js';
import { db, save, logActivity, getCustomer } from './store.js';
import { safePollInbox } from './inbox.js';
import { buildConversationBrief } from './context.js';
import { hydrateInquiry } from './rfq.js';

// ============================================================
// 客户入库后的完整自动流程（人工只监控 / 停止）
//  1. 客户入库（真实买家邮箱）
//  2. 研究行业与痛点
//  3. 起草开发信并五维评分
//  4. 低于 minScore 则按建议重写一次
//  5. 按对方时区黄金窗口 + 全球发信频率排期
//  6. SMTP 发送到真实客户邮箱（占位 example.com 不投递）
//  7. 等待回复；IMAP 扫到回复 → 标记已回复并自动回信
//  8. 满 followupDays 仍未回复 → 自动跟进（最多 maxFollowups 封）
// ============================================================

const state = {
  enabled: true,
  busy: false,
  currentId: null,
  lastError: null,
  processed: 0,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isOwnInbox(email) {
  return String(email || '').toLowerCase() === String(config.smtp.user || '').toLowerCase();
}

function isBlockedOutreachEmail(email) {
  const e = String(email || '').toLowerCase();
  if (/@(gmail|yahoo|ymail|hotmail|outlook|live\.com|icloud|proton|qq\.com|163\.com|126\.com|mail\.ru)/i.test(e)) {
    return true;
  }
  return /lawrencetheband\.com|washington\.org|civilsolutionsva\.com/i.test(e);
}

function isPendingFirstTouch(c) {
  if (!c.inOutreach) return false;
  if (!c.email || !c.email.includes('@')) return false;
  if (isBlockedOutreachEmail(c.email)) return false;
  if (c.agentPhase === 'need_email') return false;
  return (
    c.status === 'uncontacted' &&
    !['working', 'scheduled', 'paused', 'error', 'waiting', 'need_email'].includes(c.agentPhase)
  );
}

function lastOutbound(customerId) {
  return [...(db.threads[customerId] || [])].reverse().find((t) => t.type === 'outbound');
}

function outboundCount(customerId) {
  return (db.threads[customerId] || []).filter((t) => t.type === 'outbound').length;
}

function daysSince(isoLike) {
  if (!isoLike) return 999;
  const t = new Date(String(isoLike).replace(' ', 'T'));
  return (Date.now() - t.getTime()) / 86400000;
}

function nextFollowup() {
  return db.customers.find((c) => {
    if (c.status !== 'following') return false;
    if (c.agentPhase === 'working' || c.agentPhase === 'scheduled') return false;
    if (isOwnInbox(c.email)) return false;
    const n = outboundCount(c.id);
    if (n < 1 || n > config.sending.maxFollowups) return false;
    const last = lastOutbound(c.id);
    return daysSince(last?.time || last?.sentAt) >= config.sending.followupDays;
  });
}

function nextReplyJob() {
  return db.customers.find((c) => c.status === 'replied' && c.pendingReply && c.agentPhase !== 'working');
}

function saveDraft(customer, draft, evaluation) {
  db.aiPanel[customer.id] = {
    draft: {
      subject: draft.subject,
      body: draft.body,
      painPointAnalysis: draft.painPointAnalysis,
    },
    evaluation: evaluation || db.aiPanel[customer.id]?.evaluation || null,
  };
  save();
}

function enqueue(customer, draft, actionLabel) {
  if (isBlockedOutreachEmail(customer.email) || isOwnInbox(customer.email)) return;
  const job = createBatchJob(
    [{ customerId: customer.id, subject: draft.subject, body: draft.body }],
    'smart'
  );
  customer.agentPhase = 'scheduled';
  save();
  const task = job.items[0];
  logActivity({
    customerId: customer.id,
    action: actionLabel,
    detail: task
      ? `${task.scheduleNote}；相邻邮件间隔 ${config.sending.minIntervalSec}-${config.sending.maxIntervalSec} 秒`
      : '已加入发送队列',
  });
}

async function draftFirstEmail(customer) {
  let result = await generateEmail(customer);
  let evaluation = result.evaluation || (await evaluateEmail({ ...result, customer }));
  saveDraft(customer, result, evaluation);
  logActivity({
    customerId: customer.id,
    action: '草稿就绪',
    detail: `主题「${result.subject}」· AI ${evaluation.total} 分（${evaluation.grade}）。${result.painPointAnalysis || ''}`,
  });

  if (evaluation.total < config.sending.minScore) {
    logActivity({
      customerId: customer.id,
      action: '质量不达标，重写',
      detail: `${evaluation.total} 分低于 ${config.sending.minScore}。按建议重写：${evaluation.suggestion || ''}`,
    });
    result = await generateEmail(customer, `上一稿 ${evaluation.total} 分，请按此建议重写：${evaluation.suggestion || ''}`);
    evaluation = result.evaluation || (await evaluateEmail({ ...result, customer }));
    saveDraft(customer, result, evaluation);
    logActivity({
      customerId: customer.id,
      action: '重写完成',
      detail: `新主题「${result.subject}」· AI ${evaluation.total} 分（${evaluation.grade}）`,
    });
  }
  return { result, evaluation };
}

async function processFirstTouch(customer) {
  if (isOwnInbox(customer.email)) {
    customer.agentPhase = 'error';
    save();
    logActivity({
      customerId: customer.id,
      action: '已跳过',
      detail: '收件人是自己的发件箱，没有投递意义。请改为真实客户邮箱。',
    });
    return;
  }

  customer.agentPhase = 'working';
  save();
  state.currentId = customer.id;
  logActivity({
    customerId: customer.id,
    action: '开始研究',
    detail: `正在研究 ${customer.name} / ${customer.company}（${customer.country} · ${customer.timezone}）`,
  });

  await hydrateInquiry(customer);
  const { result } = await draftFirstEmail(customer);
  if (!state.enabled) {
    customer.agentPhase = 'paused';
    save();
    return;
  }
  enqueue(customer, result, '已排期');
  state.processed += 1;
}

async function processFollowup(customer) {
  customer.agentPhase = 'working';
  save();
  state.currentId = customer.id;
  const prev = lastOutbound(customer.id);
  const { brief } = buildConversationBrief(customer, db.threads[customer.id] || [], prev);
  logActivity({
    customerId: customer.id,
    action: '准备跟进',
    detail: `已发出 ${outboundCount(customer.id)} 封、${Math.floor(daysSince(prev?.time))} 天未回复。跟进将引用完整来往，而不是重发上一封。`,
  });
  const draft = await generateFollowUp(customer, brief);
  saveDraft(customer, draft, db.aiPanel[customer.id]?.evaluation);
  if (!state.enabled) {
    customer.agentPhase = 'paused';
    save();
    return;
  }
  enqueue(customer, draft, '跟进已排期');
}

async function processInboundReply(customer) {
  customer.agentPhase = 'working';
  save();
  state.currentId = customer.id;
  const inbound = customer.pendingReply;
  const thread = db.threads[customer.id] || [];
  const { brief } = buildConversationBrief(customer, thread, inbound);
  const draft = await generateReply(customer, inbound, brief);

  db.aiPanel[customer.id] = {
    ...(db.aiPanel[customer.id] || {}),
    draft: {
      subject: draft.subject,
      body: draft.body,
      painPointAnalysis: draft.painPointAnalysis,
      intent: draft.intent,
      contextUsed: draft.contextUsed,
      strategy: draft.strategy,
    },
    evaluation: db.aiPanel[customer.id]?.evaluation || null,
  };
  delete customer.pendingReply;
  if (draft.stopSequence) customer.agentPhase = 'stopped';
  save();

  logActivity({
    customerId: customer.id,
    action: '回信已理解上下文',
    detail: `意图=${draft.intent}。${draft.contextUsed || ''} ${draft.strategy || ''}`,
  });

  if (!state.enabled) {
    customer.agentPhase = 'paused';
    save();
    return;
  }
  if (!draft.shouldSend) {
    logActivity({
      customerId: customer.id,
      action: '回信未自动发出',
      detail: `意图 ${draft.intent} 不适合自动发送（休假/投诉等），草稿已放在 AI 面板，等人工看过。`,
    });
    customer.agentPhase = 'waiting_human';
    save();
    return;
  }
  enqueue(customer, draft, '回信已排期');
}

async function loop() {
  let inboxTick = 0;
  while (true) {
    if (!state.enabled) {
      state.busy = false;
      state.currentId = null;
      await sleep(800);
      continue;
    }

    inboxTick += 1;
    if (inboxTick % 20 === 1) {
      await safePollInbox();
    }

    const replyJob = nextReplyJob();
    const follow = !replyJob && nextFollowup();
    const first = !replyJob && !follow && db.customers.find(isPendingFirstTouch);

    if (!replyJob && !follow && !first) {
      state.busy = false;
      state.currentId = null;
      await sleep(1500);
      continue;
    }

    state.busy = true;
    const customer = replyJob || follow || first;
    try {
      if (replyJob) await processInboundReply(customer);
      else if (follow) await processFollowup(customer);
      else await processFirstTouch(customer);
    } catch (err) {
      state.lastError = String(err.message || err);
      customer.agentPhase = 'error';
      save();
      logActivity({
        customerId: customer.id,
        action: '处理失败',
        detail: state.lastError.slice(0, 240),
      });
    }
  }
}

function enqueueDraft(customer) {
  const draft = db.aiPanel[customer.id]?.draft;
  if (!draft?.subject || !draft?.body) return false;
  if (isOwnInbox(customer.email)) return false;
  enqueue(customer, draft, '已排期');
  return true;
}

/** 取消未发出的首封，清空草稿，让 Agent 按询盘全文 + 背调重写。已发出的不动。 */
export function rewriteOutreach(ids = []) {
  const targets = [];
  const pool = ids.length ? ids.map((id) => getCustomer(id)).filter(Boolean) : db.customers.filter((c) => c.inOutreach);
  for (const c of pool) {
    if (!c?.inOutreach || !c.email || isBlockedOutreachEmail(c.email) || isOwnInbox(c.email)) continue;
    const sent = (db.threads[c.id] || []).some((t) => t.type === 'outbound');
    if (sent) continue;
    targets.push(c);
  }
  const cancelled = cancelScheduledFor(targets.map((c) => c.id));
  for (const c of targets) {
    c.agentPhase = null;
    if (c.status !== 'replied' && c.status !== 'following') c.status = 'uncontacted';
    if (db.aiPanel[c.id]) db.aiPanel[c.id].draft = null;
    logActivity({
      customerId: c.id,
      action: '重写开发信',
      detail: `已撤下旧草稿，将按询盘原文 + 公开背调重写 ${c.company || c.name}。`,
    });
  }
  save();
  startAgent();
  return { reset: targets.length, cancelled, ids: targets.map((c) => c.id), agent: getAgentState() };
}

export function startAgent() {
  state.enabled = true;
  resumeSending();
  recoverScheduled();
  for (const c of db.customers) {
    if (c.agentPhase === 'paused' && c.inOutreach && !isBlockedOutreachEmail(c.email)) enqueueDraft(c);
  }
  logActivity({
    customerId: null,
    action: 'Agent 已启动',
    detail: '客户入库后自动：研究 → 写信/质检 → 按时区发送 → 等回复/跟进/回信。请填写真实客户邮箱。',
  });
}

export function stopAgent() {
  state.enabled = false;
  cancelPendingSends();
  for (const c of db.customers) {
    if (c.agentPhase === 'scheduled') c.agentPhase = 'paused';
  }
  save();
  logActivity({
    customerId: null,
    action: 'Agent 已停止',
    detail: '已停止处理新客户，并取消尚未发出的计划邮件。已发出的不受影响。',
  });
}

export function getAgentState() {
  const current = db.customers.find((c) => c.id === state.currentId) || null;
  return {
    enabled: state.enabled,
    busy: state.busy,
    processed: state.processed,
    queue: db.customers.filter(isPendingFirstTouch).length,
    lastError: state.lastError,
    current: current ? { id: current.id, name: current.name, company: current.company } : null,
  };
}

function recoverScheduled() {
  for (const c of db.customers) {
    if (isBlockedOutreachEmail(c.email) && c.agentPhase !== 'paused') {
      c.agentPhase = 'paused';
      continue;
    }
    if (c.agentPhase === 'working') c.agentPhase = null;
    const draft = db.aiPanel[c.id]?.draft;
    const sent = (db.threads[c.id] || []).some((t) => t.type === 'outbound');
    if (
      c.inOutreach &&
      c.status === 'uncontacted' &&
      draft?.subject &&
      !sent &&
      !isOwnInbox(c.email) &&
      !isBlockedOutreachEmail(c.email) &&
      c.agentPhase !== 'error' &&
      c.agentPhase !== 'paused'
    ) {
      try {
        enqueueDraft(c);
      } catch (err) {
        logActivity({ customerId: c.id, action: '恢复失败', detail: String(err.message || err) });
      }
    }
  }
}

recoverScheduled();
loop();

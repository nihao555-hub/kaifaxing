import { config } from './config.js';
import { generateEmail, evaluateEmail } from './agent.js';
import { createBatchJob, cancelPendingSends, resumeSending } from './scheduler.js';
import { db, save, logActivity } from './store.js';

// ============================================================
// 全自动 Agent：客户进入「未联系」后，自动研究 → 写信 → 评分 → 按时区/频率发送
// 人工只监控现有界面，必要时 stop()
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

function isPending(c) {
  return c.status === 'uncontacted' && c.agentPhase !== 'working' && c.agentPhase !== 'scheduled' && c.agentPhase !== 'error';
}

function nextUncontacted() {
  // 自己的真实邮箱优先，方便尽快验证 SMTP 能否投递
  return db.customers.find((c) => isPending(c) && c.email === config.smtp.user)
    || db.customers.find(isPending);
}

async function processOne(customer) {
  customer.agentPhase = 'working';
  save();
  state.currentId = customer.id;
  logActivity({
    customerId: customer.id,
    action: '开始研究',
    detail: `正在研究 ${customer.name} / ${customer.company}（${customer.country} · ${customer.timezone}）的痛点并起草开发信`,
  });

  const result = await generateEmail(customer);
  let evaluation = result.evaluation;
  if (!evaluation) {
    evaluation = await evaluateEmail({ ...result, customer });
  }

  db.aiPanel[customer.id] = {
    draft: {
      subject: result.subject,
      body: result.body,
      painPointAnalysis: result.painPointAnalysis,
    },
    evaluation,
  };
  save();

  logActivity({
    customerId: customer.id,
    action: '草稿就绪',
    detail: `主题「${result.subject}」· AI ${evaluation.total} 分（${evaluation.grade}）。${result.painPointAnalysis || ''}`,
  });

  if (!state.enabled) {
    customer.agentPhase = null;
    save();
    return;
  }

  // 自己的真实邮箱立即发送以验证 SMTP；其余按收件人时区智能排队
  const isSelfTest = customer.email === config.smtp.user;
  const job = createBatchJob(
    [{ customerId: customer.id, subject: result.subject, body: result.body }],
    isSelfTest ? 'now' : 'smart'
  );
  customer.agentPhase = 'scheduled';
  save();
  state.processed += 1;

  const task = job.items[0];
  logActivity({
    customerId: customer.id,
    action: isSelfTest ? '立即发送' : '已排期',
    detail: task
      ? `${task.scheduleNote}；相邻邮件将间隔 ${config.sending.minIntervalSec}-${config.sending.maxIntervalSec} 秒`
      : '已加入发送队列',
  });
}

async function loop() {
  while (true) {
    if (!state.enabled) {
      state.busy = false;
      state.currentId = null;
      await sleep(800);
      continue;
    }
    const customer = nextUncontacted();
    if (!customer) {
      state.busy = false;
      state.currentId = null;
      await sleep(1500);
      continue;
    }
    state.busy = true;
    try {
      await processOne(customer);
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

export function startAgent() {
  state.enabled = true;
  resumeSending();
  logActivity({ customerId: null, action: 'Agent 已启动', detail: '将自动处理所有「未联系」客户：研究痛点 → 写信评分 → 按时区与频率发送' });
}

export function stopAgent() {
  state.enabled = false;
  cancelPendingSends();
  for (const c of db.customers) {
    if (c.agentPhase === 'scheduled') c.agentPhase = null;
  }
  save();
  logActivity({ customerId: null, action: 'Agent 已停止', detail: '已停止处理新客户，并取消尚未发出的计划邮件。已发出的不受影响。' });
}

export function getAgentState() {
  const queue = db.customers.filter(
    (c) => c.status === 'uncontacted' && c.agentPhase !== 'working' && c.agentPhase !== 'scheduled' && c.agentPhase !== 'error'
  ).length;
  const current = db.customers.find((c) => c.id === state.currentId) || null;
  return {
    enabled: state.enabled,
    busy: state.busy,
    processed: state.processed,
    queue,
    lastError: state.lastError,
    current: current ? { id: current.id, name: current.name, company: current.company } : null,
  };
}

loop();

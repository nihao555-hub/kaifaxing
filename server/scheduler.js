import { config } from './config.js';
import { suggestSendTime, isGoldenWindow, formatLocal } from './agent.js';
import { sendMail } from './mailer.js';
import { db, save, getCustomer, appendThread, sentToday, logActivity } from './store.js';

// ============================================================
// 批量发送调度器
//  - 时区感知：每封信按收件人时区计算最佳发送时间
//  - 频率控制：相邻两封之间随机间隔 45-120 秒，且单日不超过上限
// ============================================================

// jobs: Map<jobId, { id, mode, items: [...], createdAt }>
const jobs = new Map();
const timers = new Map();
const booked = []; // 已占用的发送时间戳，用于全球频率避让
let jobSeq = 1;
let taskSeq = 1;
let cancelled = false;

function randomIntervalMs() {
  const { minIntervalSec, maxIntervalSec } = config.sending;
  return (minIntervalSec + Math.random() * (maxIntervalSec - minIntervalSec)) * 1000;
}

function conflicts(t) {
  const minGap = config.sending.minIntervalSec * 1000;
  return booked.some((b) => Math.abs(t - b) < minGap);
}

/**
 * 为一位客户分配发送时间：
 *  1. 先落到其当地黄金窗口
 *  2. 若与已排期邮件间隔不足，只在窗口内后移；挤出窗口则改到下一个黄金窗口
 *  这样几十个跨时区客户不会被一条全球队列挤到凌晨
 */
function allocateSlot(timezone, mode) {
  if (mode === 'now') {
    let t = Date.now();
    while (conflicts(t)) t += randomIntervalMs();
    booked.push(t);
    booked.sort((a, b) => a - b);
    return { sendAt: t, note: '立即发送（按防封频率依次排队）' };
  }

  let from = new Date();
  for (let attempt = 0; attempt < 12; attempt++) {
    const sug = suggestSendTime(timezone, from);
    let t = sug.sendAt.getTime();
    for (let i = 0; i < 30 && isGoldenWindow(new Date(t), timezone); i++) {
      if (!conflicts(t)) {
        booked.push(t);
        booked.sort((a, b) => a - b);
        return {
          sendAt: t,
          note: `${sug.reason}（${formatLocal(new Date(t), timezone)}）`,
        };
      }
      t += randomIntervalMs();
    }
    from = new Date(t + 60 * 60 * 1000);
  }
  const fallback = Date.now() + randomIntervalMs();
  booked.push(fallback);
  return { sendAt: fallback, note: '未找到无冲突黄金窗口，已按频率顺延' };
}

/**
 * 创建批量发送任务
 * @param items  [{ customerId, subject, body }]
 * @param mode   'smart'（按收件人时区最佳窗口）| 'now'（立即按频率间隔依次发送）
 */
export function createBatchJob(items, mode = 'smart') {
  const remainingToday = config.sending.dailyLimit - sentToday();
  if (items.length > remainingToday) {
    throw new Error(
      `今日发送额度不足：单日上限 ${config.sending.dailyLimit} 封，今日剩余 ${Math.max(0, remainingToday)} 封，本次需发送 ${items.length} 封`
    );
  }

  const job = {
    id: `job${jobSeq++}`,
    mode,
    createdAt: new Date().toISOString(),
    items: [],
  };

  for (const it of items) {
    const customer = getCustomer(it.customerId);
    if (!customer) continue;

    const slot = allocateSlot(customer.timezone, mode);
    const sendAt = slot.sendAt;
    const scheduleNote = slot.note;

    const task = {
      id: `task${taskSeq++}`,
      customerId: customer.id,
      customerName: customer.name,
      email: customer.email,
      subject: it.subject,
      body: it.body,
      sendAt: new Date(sendAt).toISOString(),
      scheduleNote,
      status: 'scheduled', // scheduled | sending | sent | failed
      error: null,
    };
    job.items.push(task);
    scheduleTask(job, task, sendAt - Date.now());
  }

  jobs.set(job.id, job);
  return job;
}

function isPlaceholderEmail(email) {
  return /@([a-z0-9-]+\.)?example\.com$/i.test(email || '');
}

function scheduleTask(job, task, delayMs) {
  const timer = setTimeout(async () => {
    timers.delete(task.id);
    if (cancelled || task.status === 'cancelled') {
      task.status = 'cancelled';
      return;
    }
    task.status = 'sending';
    try {
      // 占位邮箱不走真实 SMTP，避免把 163 账号打进垃圾信誉；真实邮箱才真正投递
      if (!isPlaceholderEmail(task.email)) {
        await sendMail({ to: task.email, subject: task.subject, text: task.body });
      }
      task.status = 'sent';
      task.sentAt = new Date().toISOString();
      db.sentLog.push({ customerId: task.customerId, sentAt: task.sentAt });

      const customer = getCustomer(task.customerId);
      const count = (db.threads[task.customerId] || []).filter((t) => t.type === 'outbound').length;
      appendThread(task.customerId, {
        id: `t${Date.now()}_${task.id}`,
        type: 'outbound',
        label: `开发信 #${count + 1}`,
        status: 'delivered',
        time: new Date().toISOString().slice(0, 16).replace('T', ' '),
        subject: task.subject,
        body: task.body,
      });
      if (customer && customer.status === 'uncontacted') {
        customer.status = 'following';
        customer.lastActivity = new Date().toISOString().slice(0, 10);
        save();
      }
      logActivity({
        customerId: task.customerId,
        action: '已发送',
        detail: isPlaceholderEmail(task.email)
          ? `已按计划投递「${task.subject}」（占位邮箱，未走 SMTP）`
          : `已通过 SMTP 投递「${task.subject}」→ ${task.email}`,
      });
    } catch (err) {
      task.status = 'failed';
      task.error = String(err.message || err).slice(0, 300);
      logActivity({
        customerId: task.customerId,
        action: '发送失败',
        detail: task.error,
      });
    }
  }, Math.max(0, delayMs));
  timers.set(task.id, timer);
}

export function cancelPendingSends() {
  cancelled = true;
  for (const [id, timer] of timers) {
    clearTimeout(timer);
    timers.delete(id);
  }
  for (const job of jobs.values()) {
    for (const task of job.items) {
      if (task.status === 'scheduled') task.status = 'cancelled';
    }
  }
}

export function resumeSending() {
  cancelled = false;
}

export function getJob(id) {
  return jobs.get(id);
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

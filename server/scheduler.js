import { config } from './config.js';
import { suggestSendTime } from './agent.js';
import { sendMail } from './mailer.js';
import { db, save, getCustomer, appendThread, sentToday } from './store.js';

// ============================================================
// 批量发送调度器
//  - 时区感知：每封信按收件人时区计算最佳发送时间
//  - 频率控制：相邻两封之间随机间隔 45-120 秒，且单日不超过上限
// ============================================================

// jobs: Map<jobId, { id, mode, items: [...], createdAt }>
const jobs = new Map();
let jobSeq = 1;
let taskSeq = 1;

function randomIntervalMs() {
  const { minIntervalSec, maxIntervalSec } = config.sending;
  return (minIntervalSec + Math.random() * (maxIntervalSec - minIntervalSec)) * 1000;
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

  // 计算每封信的计划发送时间：
  // 智能模式下取"收件人时区最佳窗口"，同时保证相邻发送间隔 >= 随机频率间隔
  let earliest = Date.now();
  for (const it of items) {
    const customer = getCustomer(it.customerId);
    if (!customer) continue;

    let sendAt, scheduleNote;
    if (mode === 'smart') {
      const sug = suggestSendTime(customer.timezone);
      sendAt = Math.max(sug.sendAt.getTime(), earliest);
      scheduleNote = `${sug.reason}（${sug.localTime}）`;
    } else {
      sendAt = earliest;
      scheduleNote = '立即发送（按防封频率依次排队）';
    }
    earliest = sendAt + randomIntervalMs();

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

function scheduleTask(job, task, delayMs) {
  setTimeout(async () => {
    task.status = 'sending';
    try {
      await sendMail({ to: task.email, subject: task.subject, text: task.body });
      task.status = 'sent';
      task.sentAt = new Date().toISOString();
      db.sentLog.push({ customerId: task.customerId, sentAt: task.sentAt });

      // 写入沟通历史，并把"未联系"客户状态推进为"跟进中"
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
    } catch (err) {
      task.status = 'failed';
      task.error = String(err.message || err).slice(0, 300);
    }
  }, Math.max(0, delayMs));
}

export function getJob(id) {
  return jobs.get(id);
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

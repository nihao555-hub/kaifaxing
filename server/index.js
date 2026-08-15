import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, save } from './store.js';
import { generateEmail, evaluateEmail, suggestSendTime } from './agent.js';
import { createBatchJob, getJob, listJobs } from './scheduler.js';
import { sentToday } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- 客户 ----------
app.get('/api/customers', (req, res) => {
  res.json({ customers: db.customers });
});

app.post('/api/customers', (req, res) => {
  const { name, company, title, email, country, timezone, industry, painPoints } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: '姓名和邮箱必填' });
  const customer = {
    id: `c${Date.now()}`,
    name, company: company || '', title: title || '', email,
    country: country || '', timezone: timezone || 'America/New_York',
    industry: industry || '', painPoints: painPoints || '',
    status: 'uncontacted',
    lastActivity: new Date().toISOString().slice(0, 10),
  };
  db.customers.unshift(customer);
  save();
  res.json({ customer });
});

// ---------- 沟通历史与 AI 面板 ----------
app.get('/api/customers/:id/thread', (req, res) => {
  res.json({
    thread: db.threads[req.params.id] || [],
    aiPanel: db.aiPanel[req.params.id] || null,
  });
});

// ---------- AI Agent ----------
// 为单个客户生成开发信（含痛点分析 + 最佳发送时间建议 + AI 评分）
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { customerId, extraContext } = req.body || {};
    const customer = db.customers.find((c) => c.id === customerId);
    if (!customer) return res.status(404).json({ error: '客户不存在' });

    const draft = await generateEmail(customer, extraContext);
    const evaluation = await evaluateEmail({ ...draft, customer });
    const sendTime = suggestSendTime(customer.timezone);

    db.aiPanel[customerId] = { draft, evaluation };
    save();

    res.json({
      draft,
      evaluation,
      sendTime: {
        sendAt: sendTime.sendAt.toISOString(),
        localTime: sendTime.localTime,
        reason: sendTime.reason,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 对已有草稿重新评分
app.post('/api/ai/evaluate', async (req, res) => {
  try {
    const { customerId, subject, body } = req.body || {};
    const customer = db.customers.find((c) => c.id === customerId);
    const evaluation = await evaluateEmail({ subject, body, customer });
    if (customer && db.aiPanel[customerId]) {
      db.aiPanel[customerId].evaluation = evaluation;
      save();
    }
    res.json({ evaluation });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- 批量发送 ----------
// body: { items: [{customerId, subject, body}], mode: 'smart'|'now' }
app.post('/api/batch/send', (req, res) => {
  try {
    const { items, mode } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '发送列表为空' });
    }
    for (const it of items) {
      if (!it.subject || !it.body) return res.status(400).json({ error: '存在缺少主题或正文的邮件' });
    }
    const job = createBatchJob(items, mode === 'now' ? 'now' : 'smart');
    res.json({ job });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get('/api/batch/jobs', (req, res) => res.json({ jobs: listJobs() }));
app.get('/api/batch/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json({ job });
});

// ---------- 发送额度 ----------
app.get('/api/quota', (req, res) => {
  res.json({
    dailyLimit: config.sending.dailyLimit,
    sentToday: sentToday(),
    minIntervalSec: config.sending.minIntervalSec,
    maxIntervalSec: config.sending.maxIntervalSec,
  });
});

// ---------- 生产模式下托管前端构建产物 ----------
const dist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => err && next());
});

app.listen(config.port, () => {
  console.log(`[OutreachAI] server listening on http://localhost:${config.port}`);
});

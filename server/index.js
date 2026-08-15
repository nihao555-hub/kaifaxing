import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, save } from './store.js';
import { generateEmail, evaluateEmail, suggestSendTime } from './agent.js';
import { createBatchJob, getJob, listJobs } from './scheduler.js';
import { sentToday, logActivity } from './store.js';
import { startAgent, stopAgent, getAgentState } from './autopilot.js';
import { ingestInbound } from './inbox.js';
import { listSources, searchRfq, importRfqItems } from './rfq.js';

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
  if (!name) return res.status(400).json({ error: '姓名必填' });
  if (String(email).toLowerCase() === String(config.smtp.user).toLowerCase()) {
    return res.status(400).json({ error: '请填写真实客户邮箱，不要用自己的发件箱当收件人' });
  }
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
  logActivity({
    customerId: customer.id,
    action: '客户入库',
    detail: `${customer.name} 已进入名单，Agent 将自动研究并发送开发信`,
  });
  res.json({ customer });
});

app.patch('/api/customers/:id', (req, res) => {
  const customer = db.customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: '客户不存在' });
  const { email, painPoints, title, company } = req.body || {};
  if (email) {
    if (String(email).toLowerCase() === String(config.smtp.user).toLowerCase()) {
      return res.status(400).json({ error: '请填写真实客户邮箱，不要用自己的发件箱' });
    }
    customer.email = email;
    if (customer.agentPhase === 'need_email') customer.agentPhase = null;
  }
  if (painPoints != null) customer.painPoints = painPoints;
  if (title != null) customer.title = title;
  if (company != null) customer.company = company;
  save();
  res.json({ customer });
});

app.get('/api/rfq/sources', (req, res) => res.json({ sources: listSources() }));
app.get('/api/rfq/search', async (req, res) => {
  try {
    const { items, reports } = await searchRfq({
      source: req.query.source || 'all',
      keyword: req.query.q || 'power tools',
      limit: Number(req.query.limit || 10),
    });
    res.json({ items, reports });
  } catch (err) {
    res.status(502).json({ error: `RFQ 数据源请求失败：${err.message}` });
  }
});
app.post('/api/rfq/import', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const created = importRfqItems(items);
  res.json({ created });
});

// ---------- 沟通历史与 AI 面板 ----------
app.get('/api/customers/:id/thread', (req, res) => {
  const activities = (db.activities || []).filter(
    (a) => !a.customerId || a.customerId === req.params.id
  );
  res.json({
    thread: db.threads[req.params.id] || [],
    aiPanel: db.aiPanel[req.params.id] || null,
    activities,
  });
});

app.get('/api/activities', (req, res) => {
  res.json({ activities: db.activities || [] });
});

app.get('/api/agent', (req, res) => res.json(getAgentState()));
app.post('/api/agent/start', (req, res) => {
  startAgent();
  res.json(getAgentState());
});
app.post('/api/agent/stop', (req, res) => {
  stopAgent();
  res.json(getAgentState());
});

// 把一封客户来信挂进沟通历史（IMAP 正常时会自动做；也可用于补录）
app.post('/api/inbox/inbound', (req, res) => {
  const { customerId, subject, body } = req.body || {};
  const customer = db.customers.find((c) => c.id === customerId);
  if (!customer) return res.status(404).json({ error: '客户不存在' });
  const ok = ingestInbound(customer, { subject, body, from: customer.email });
  res.json({ ingested: ok, customerId: customer.id });
});

// ---------- AI Agent ----------
// 为单个客户生成开发信（含痛点分析 + 最佳发送时间建议 + AI 评分）
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { customerId, extraContext } = req.body || {};
    const customer = db.customers.find((c) => c.id === customerId);
    if (!customer) return res.status(404).json({ error: '客户不存在' });

    const generated = await generateEmail(customer, extraContext);
    const draft = {
      subject: generated.subject,
      body: generated.body,
      painPointAnalysis: generated.painPointAnalysis,
    };
    const evaluation = generated.evaluation || (await evaluateEmail({ ...draft, customer }));
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

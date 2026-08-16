import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, googleSearchReady, googleSearchStatus } from './config.js';
import { db, save, getCustomer, listCustomers, leadFacets, saveSearchSettings } from './store.js';
import { generateEmail, evaluateEmail, suggestSendTime } from './agent.js';
import { createBatchJob, getJob, listJobs } from './scheduler.js';
import { sentToday, logActivity } from './store.js';
import { startAgent, stopAgent, getAgentState } from './autopilot.js';
import { ingestInbound } from './inbox.js';
import { listSources, searchRfq, importRfqItems, ingestCommercial, crawlAlibabaPublic, crawlAllAndImport, ALIBABA_PUBLIC_FIELDS, PUBLIC_SINCE_DEFAULT } from './rfq.js';
import { alibabaCrawlProgress } from './publicRfq.js';
import { isPlausibleEmail, isPersonLikeLead } from './research.js';
import { buildSearchLinks, rfqProductTerms, searchGoogleCse, searchSerper, parseGoogleCse, parseSerper } from './searchDorks.js';
import { GITHUB_TOOLS } from './githubTools.js';
import {
  startLeadPipeline,
  getPipelineState,
  runDailySync,
  runLeadResearch,
  enqueueResearch,
  enqueuePendingResearch,
  kickResearch,
  stampPersonLikeLeads,
  applyPublicContact,
  promoteLeads,
} from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- 客户 ----------
app.get('/api/customers', (req, res) => {
  const view = req.query.view || 'inbox';
  const q = String(req.query.q || '');
  const limit = Number(req.query.limit || 200);
  const offset = Number(req.query.offset || 0);
  const result = listCustomers({ view, q, limit, offset });
  res.json({ customers: result.items, total: result.total, offset: result.offset, limit: result.limit });
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
    inOutreach: true,
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
  const { email, painPoints, title, company, website } = req.body || {};
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
  if (website != null) customer.website = website;
  save();
  res.json({ customer });
});

app.get('/api/rfq/sources', (req, res) => res.json({ sources: listSources() }));
app.get('/api/rfq/schema', (req, res) => {
  res.json({
    sinceDefault: PUBLIC_SINCE_DEFAULT,
    alibabaPublicFields: ALIBABA_PUBLIC_FIELDS,
    note: '公开列表页字段。无买家邮箱。emailConfirm 只表示平台标记邮箱已验证，不是地址。',
  });
});
app.get('/api/rfq/search', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const { items, reports } = await searchRfq({
      source,
      keyword: req.query.q || 'power tools',
      limit: Number(req.query.limit || (source === 'alibaba_public' || source === 'commercial' ? 40 : 10)),
      since: req.query.since || PUBLIC_SINCE_DEFAULT,
    });
    res.json({ items, reports });
  } catch (err) {
    res.status(502).json({ error: `RFQ 数据源请求失败：${err.message}` });
  }
});
app.post('/api/rfq/public/crawl', async (req, res) => {
  try {
    const keyword = req.body?.keyword ?? req.body?.q ?? '';
    const since = req.body?.since || PUBLIC_SINCE_DEFAULT;
    const maxPages = Number(req.body?.maxPages || 15);
    const crawled = await crawlAlibabaPublic({ keyword, since, maxPages, fanout: false });
    const created = req.body?.import ? importRfqItems(crawled.items, { quiet: true }) : [];
    if (created.length) enqueueResearch(created);
    res.json({ ...crawled, created });
  } catch (err) {
    res.status(502).json({ error: `公开询盘抓取失败：${err.message}` });
  }
});

let crawlAllJob = { status: 'idle' };
app.get('/api/rfq/crawl-all', (req, res) => res.json({ ...crawlAllJob, progress: alibabaCrawlProgress }));
app.post('/api/rfq/crawl-all', (req, res) => {
  if (crawlAllJob.status === 'running') return res.json(crawlAllJob);
  const since = req.body?.since || PUBLIC_SINCE_DEFAULT;
  const alibabaPages = Number(req.body?.alibabaPages || 100);
  const sources = Array.isArray(req.body?.sources) ? req.body.sources : undefined;
  crawlAllJob = { status: 'running', since, startedAt: new Date().toISOString(), createdCount: 0, reports: [] };
  crawlAllAndImport({ since, alibabaPages, govLimit: 80, doImport: true, sources })
    .then((r) => {
      if (r.created?.length) enqueueResearch(r.created);
      crawlAllJob = {
        status: 'done',
        since: r.since,
        startedAt: crawlAllJob.startedAt,
        finishedAt: new Date().toISOString(),
        fetched: r.items.length,
        createdCount: r.createdCount,
        reports: r.reports,
      };
    })
    .catch((err) => {
      crawlAllJob = { status: 'error', error: String(err.message || err), finishedAt: new Date().toISOString() };
    });
  res.json(crawlAllJob);
});
app.post('/api/rfq/import', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const created = importRfqItems(items);
  if (created.length) enqueueResearch(created);
  res.json({ created });
});
app.post('/api/rfq/ingest', (req, res) => {
  try {
    const { items, created } = ingestCommercial(req.body || {});
    if (created.length) enqueueResearch(created);
    res.json({ accepted: items.length, created });
  } catch (err) {
    res.status(400).json({ error: `导入失败：${err.message}` });
  }
});

app.get('/api/research/tools', (req, res) => res.json({ tools: GITHUB_TOOLS }));

app.get('/api/search/status', (req, res) => {
  res.json({
    ...googleSearchStatus(),
    docs: {
      cse: 'https://developers.google.com/custom-search/v1/overview',
      cseGithub: 'https://github.com/googleapis/google-api-nodejs-client',
      program: 'https://programmablesearchengine.google.com/',
      serper: 'https://serper.dev/',
    },
  });
});

app.post('/api/search/settings', (req, res) => {
  const status = saveSearchSettings({
    apiKey: req.body?.apiKey,
    cseId: req.body?.cseId,
    serperKey: req.body?.serperKey,
    clear: Boolean(req.body?.clear),
  });
  res.json(status);
});

app.post('/api/search/google/test', async (req, res) => {
  const query = String(req.body?.query || '"NMG TECHNICAL SERVICE" Dubai (website OR contact OR "info@")').slice(0, 240);
  const company = String(req.body?.company || 'NMG TECHNICAL SERVICE L.L.C');
  const country = String(req.body?.country || 'United Arab Emirates');
  if (!googleSearchReady()) {
    return res.status(400).json({
      error: '还没接上谷歌。GitHub 上能用的是官方 Custom Search JSON API，请先填 API Key + CX；或填 Serper Key。',
      ...googleSearchStatus(),
    });
  }
  try {
    let engine = '';
    let parsed = { urls: [], items: [], snippetEmails: [] };
    if (config.google.apiKey && config.google.cseId) {
      const cse = await searchGoogleCse(query);
      if (!cse.ok) return res.status(cse.status || 502).json({ error: cse.error || '谷歌官方 API 失败', ...googleSearchStatus() });
      parsed = parseGoogleCse(cse.json, company, { query, country });
      engine = 'google-cse';
    } else {
      const serper = await searchSerper(query);
      if (!serper.ok) return res.status(serper.status || 502).json({ error: serper.error || 'Serper 失败', ...googleSearchStatus() });
      parsed = parseSerper(serper.json, company, { query, country });
      engine = 'serper';
    }
    res.json({
      query,
      engine,
      urls: parsed.urls,
      items: parsed.items.slice(0, 8),
      snippetEmails: parsed.snippetEmails,
      officialGuess: parsed.urls.find((u) => /nmguae/i.test(u)) || parsed.urls[0] || '',
      ...googleSearchStatus(),
    });
  } catch (err) {
    res.status(502).json({ error: `谷歌搜索试跑失败：${err.message}`, ...googleSearchStatus() });
  }
});
app.get('/api/rfq/pipeline', (req, res) => res.json(getPipelineState()));
app.post('/api/rfq/pipeline/sync', async (req, res) => {
  try {
    const state = await runDailySync({ reason: 'manual' });
    res.json(state);
  } catch (err) {
    res.status(502).json({ error: `同步失败：${err.message}`, ...getPipelineState() });
  }
});

app.get('/api/rfq/leads', (req, res) => {
  const pipe = getPipelineState();
  const result = listCustomers({
    view: 'leads',
    q: String(req.query.q || ''),
    source: String(req.query.source || ''),
    country: String(req.query.country || ''),
    contact: String(req.query.contact || ''),
    quality: String(req.query.quality || ''),
    research: String(req.query.research || ''),
    ingestedOn: req.query.today === '1' ? pipe.today : '',
    limit: Number(req.query.limit || 20),
    offset: Number(req.query.offset || 0),
  });
  res.json({
    ...result,
    facets: { ...leadFacets(), todayNew: pipe.todayNew },
    pipeline: pipe,
  });
});

app.get('/api/rfq/leads/:id', (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.status(404).json({ error: '线索不存在' });
  const searchLinks = isPersonLikeLead(customer)
    ? []
    : (customer.research?.searchLinks?.length
      ? customer.research.searchLinks
      : buildSearchLinks({
        company: customer.legalName || customer.company || customer.name,
        country: customer.country,
        website: customer.website || customer.research?.website,
        product: rfqProductTerms(`${customer.title || ''} ${customer.painPoints || ''}`),
      }));
  res.json({ customer, research: customer.research || null, searchLinks, searchStatus: googleSearchStatus() });
});

app.post('/api/rfq/leads/research-queue', (req, res) => {
  const all = Boolean(req.body?.all);
  const limit = Number(req.body?.limit || (all ? 4000 : 800));
  const stamped = stampPersonLikeLeads();
  const added = enqueuePendingResearch({ limit });
  if (all && googleSearchReady()) config.pipeline.researchDelayMs = Math.min(config.pipeline.researchDelayMs, 2500);
  const state = kickResearch();
  res.json({ stamped, added, ...state });
});

app.post('/api/rfq/leads/research-batch', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 5) : [];
  const results = [];
  for (const id of ids) {
    const customer = getCustomer(id);
    if (!customer) {
      results.push({ id, error: '线索不存在' });
      continue;
    }
    try {
      const research = await runLeadResearch(customer);
      results.push({ id, research });
    } catch (err) {
      results.push({ id, error: String(err.message || err) });
    }
  }
  res.json({ results });
});

app.post('/api/rfq/leads/:id/research', async (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.status(404).json({ error: '线索不存在' });
  try {
    const research = await runLeadResearch(customer);
    res.json({ customer, research });
  } catch (err) {
    res.status(err.status || 502).json({ error: `背调失败：${err.message}`, research: customer.research || null });
  }
});

app.post('/api/rfq/leads/promote', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 50) : [];
  try {
    const result = await promoteLeads(ids);
    if (result.promoted.length) startAgent();
    res.json({ ...result, agent: getAgentState() });
  } catch (err) {
    res.status(502).json({ error: `录入开发信失败：${err.message}` });
  }
});

app.post('/api/rfq/leads/:id/apply-contact', (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.status(404).json({ error: '线索不存在' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const website = req.body?.website != null ? String(req.body.website).trim() : '';
  const company = req.body?.company != null ? String(req.body.company).trim() : '';
  if (customer.research?.kyb?.grade === 'C' || (customer.research?.kyb?.sanctions || []).length) {
    return res.status(400).json({ error: customer.research.kyb?.nextAction || '分级为停，不能写入开发信' });
  }
  if (!applyPublicContact(customer, email, { website, company, contactSource: 'public_research' })) {
    return res.status(400).json({ error: '请提供从公开页核到的有效邮箱，不要用自己的发件箱' });
  }
  save();
  logActivity({
    customerId: customer.id,
    action: '写入公开联系方式',
    detail: `已把 ${email} 写入 ${customer.company || customer.name}。若 Agent 在运行，可能按开发信流程自动联系该公开角色邮箱。`,
  });
  res.json({ customer });
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
  startLeadPipeline();
});

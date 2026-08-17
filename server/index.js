import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, googleSearchReady, googleSearchStatus } from './config.js';
import { alibabaReady } from './alibaba.js';
import { db, save, getCustomer, listCustomers, leadFacets, saveSearchSettings, markCustomersDirty } from './store.js';
import { generateEmail, evaluateEmail, suggestSendTime } from './agent.js';
import { createBatchJob, getJob, listJobs, cancelScheduledFor } from './scheduler.js';
import { sentToday, logActivity } from './store.js';
import { startAgent, stopAgent, getAgentState, rewriteOutreach } from './autopilot.js';
import { ingestInbound } from './inbox.js';
import { listSources, searchRfq, importRfqItems, ingestCommercial, crawlAlibabaPublic, crawlAllAndImport, ALIBABA_PUBLIC_FIELDS, PUBLIC_SINCE_DEFAULT, hydrateInquiry } from './rfq.js';
import { alibabaCrawlProgress, requestCrawlAbort } from './publicRfq.js';
import { isPlausibleEmail, isPersonLikeLead } from './research.js';
import { imageSearchLinks } from './rfqHints.js';
import { alibabaSiblings, buildAlibabaDossier, isAlibabaLead, peopleSearchLinks } from './alibabaIntel.js';
import { buildSearchLinks, rfqProductTerms, searchOfficialJson, parseGoogleCse, parseSerper } from './searchDorks.js';
import { GITHUB_TOOLS } from './githubTools.js';
import { paidSourceStatus } from './paidSources.js';
import { companiesHouseReady, openCorporatesReady } from './openSources.js';
import {
  startLeadPipeline,
  getPipelineState,
  runDailySync,
  runLeadResearch,
  enqueueResearch,
  enqueuePendingResearch,
  kickResearch,
  applyTextCompanyHints,
  startFullKybPass,
  startSignalPass,
  identifyLead,
  applyPublicContact,
  promoteLeads,
  kybPlanStats,
} from './pipeline.js';
import { flushRemoteBackup, objectStoreStatus } from './dataPersistence.js';
import { cloudDbStatus, flushCloudSync, pushCloudDatabase } from './cloudDb.js';

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
  markCustomersDirty([customer]);
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
  markCustomersDirty([customer]);
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
  if (req.body?.cancel) {
    requestCrawlAbort();
    crawlAllJob = { ...crawlAllJob, status: crawlAllJob.status === 'running' ? 'cancelling' : 'idle' };
    return res.json({ ...crawlAllJob, progress: alibabaCrawlProgress });
  }
  if (crawlAllJob.status === 'running' || crawlAllJob.status === 'cancelling') return res.json(crawlAllJob);
  const since = req.body?.full || req.body?.since === 'all' ? 'all' : (req.body?.since || PUBLIC_SINCE_DEFAULT);
  const alibabaPages = Number(req.body?.alibabaPages || 100);
  const sources = Array.isArray(req.body?.sources) ? req.body.sources : undefined;
  alibabaCrawlProgress.created = 0;
  crawlAllJob = { status: 'running', since, startedAt: new Date().toISOString(), createdCount: 0, reports: [] };
  crawlAllAndImport({ since, alibabaPages, govLimit: 80, doImport: true, sources })
    .then((r) => {
      applyTextCompanyHints();
      enqueuePendingResearch({ limit: 80 });
      kickResearch();
      const ali = (r.reports || []).find((x) => x.key === 'alibaba_public') || {};
      crawlAllJob = {
        status: r.aborted ? 'cancelled' : 'done',
        since: r.since,
        startedAt: crawlAllJob.startedAt,
        finishedAt: new Date().toISOString(),
        fetched: ali.kept || r.createdCount,
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
    const { items, created, updated, propagated } = ingestCommercial(req.body || {});
    const toQueue = [...created, ...(updated || [])];
    if (toQueue.length) enqueueResearch(toQueue);
    res.json({ accepted: items.length, created, updated: (updated || []).length, propagated });
  } catch (err) {
    res.status(400).json({ error: `导入失败：${err.message}` });
  }
});

app.get('/api/research/tools', (req, res) => res.json({ tools: GITHUB_TOOLS }));

app.get('/api/paid-sources', (req, res) => {
  res.json(paidSourceStatus({
    alibabaReady: alibabaReady(),
    companiesHouseReady: companiesHouseReady(),
    openCorporatesReady: openCorporatesReady(),
  }));
});

app.get('/api/search/status', (req, res) => {
  res.json({
    ...googleSearchStatus(),
    alibabaReady: alibabaReady(),
    companiesHouseReady: companiesHouseReady(),
    openCorporatesReady: openCorporatesReady(),
    docs: {
      cse: 'https://developers.google.com/custom-search/v1/overview',
      cseGithub: 'https://github.com/googleapis/google-api-nodejs-client',
      program: 'https://programmablesearchengine.google.com/',
      serper: 'https://serper.dev/',
      alibaba: 'https://open.taobao.com/',
      companiesHouse: 'https://developer.company-information.service.gov.uk/',
      openCorporates: 'https://opencorporates.com/api_accounts/new',
    },
  });
});

app.get('/api/data/status', async (_req, res) => {
  try {
    const cloud = await cloudDbStatus();
    res.json({
      local: db.customers.length,
      object: objectStoreStatus(),
      cloud,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rfq/leads/:id/identify', async (req, res) => {
  try {
    const result = await identifyLead(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '补主体失败' });
  }
});

app.post('/api/search/settings', (req, res) => {
  const status = saveSearchSettings({
    apiKey: req.body?.apiKey,
    cseId: req.body?.cseId,
    serperKey: req.body?.serperKey,
    searchEngine: req.body?.searchEngine,
    companiesHouseKey: req.body?.companiesHouseKey,
    openCorporatesKey: req.body?.openCorporatesKey,
    clear: Boolean(req.body?.clear),
  });
  res.json(status);
});

app.post('/api/search/google/test', async (req, res) => {
  const query = String(req.body?.query || '"NMG TECHNICAL SERVICE" Dubai (website OR contact)').slice(0, 240);
  const company = String(req.body?.company || 'NMG TECHNICAL SERVICE L.L.C');
  const country = String(req.body?.country || 'United Arab Emirates');
  try {
    const raw = await searchOfficialJson(query);
    if (!raw.engine) {
      return res.status(raw.status || 400).json({ error: raw.error || '搜索失败', ...googleSearchStatus() });
    }
    const parsed = raw.engine === 'google-cse'
      ? parseGoogleCse(raw.json, company, { query, country })
      : parseSerper(raw.json, company, { query, country });
    res.json({
      query,
      engine: raw.engine,
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
app.get('/api/rfq/kyb-plan', (req, res) => res.json(kybPlanStats({ force: true })));
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
    postedOn: String(req.query.postedOn || ''),
    category: String(req.query.category || ''),
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
  res.json({
    customer,
    research: customer.research || null,
    searchLinks,
    imageSearchLinks: imageSearchLinks(customer.imageUrl),
    peopleSearchLinks: isPersonLikeLead(customer) ? peopleSearchLinks(customer) : [],
    searchStatus: googleSearchStatus(),
    path: customer.research?.path || null,
    dossier: isAlibabaLead(customer)
      ? buildAlibabaDossier(customer, { siblings: alibabaSiblings(db.customers, customer), research: customer.research })
      : null,
  });
});

app.post('/api/rfq/leads/research-queue', (req, res) => {
  const all = Boolean(req.body?.all);
  if (req.body?.signal) {
    if (googleSearchReady()) config.pipeline.researchDelayMs = Math.min(config.pipeline.researchDelayMs, 2500);
    const pass = startSignalPass({ limit: Number(req.body?.limit || 800) });
    return res.json({ ...getPipelineState(), ...pass });
  }
  if (all) {
    if (googleSearchReady()) config.pipeline.researchDelayMs = Math.min(config.pipeline.researchDelayMs, 2500);
    const pass = startFullKybPass();
    return res.json({ ...getPipelineState(), ...pass });
  }
  const limit = Number(req.body?.limit || 800);
  const added = enqueuePendingResearch({ limit });
  const state = kickResearch();
  res.json({ promoted: 0, stamped: 0, added, ...state });
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
    const research = await runLeadResearch(customer, { peopleProbe: true });
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
app.post('/api/agent/rewrite', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  res.json(rewriteOutreach(ids));
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
    await hydrateInquiry(customer);

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

app.post('/api/batch/cancel', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const cancelled = cancelScheduledFor(ids);
  res.json({ cancelled, agent: getAgentState() });
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

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[OutreachAI] server listening on http://0.0.0.0:${config.port}`);
  startLeadPipeline();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[OutreachAI] ${signal}: flushing durable backup`);
  server.close();
  try {
    await flushCloudSync();
    if (db.customers.length && process.env.MONGODB_URI) {
      await pushCloudDatabase(db, { customers: false, state: true });
    }
  } catch (error) {
    console.error('[data] final MongoDB sync failed:', error.message);
  }
  try {
    await flushRemoteBackup();
  } catch (error) {
    console.error('[data] final backup failed:', error.message);
  }
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

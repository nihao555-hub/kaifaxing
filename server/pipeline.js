import { config } from './config.js';
import { db, save, getCustomer, isRfqLead, isDemoCustomer, logActivity } from './store.js';
import { crawlAllAndImport } from './rfq.js';
import { researchLead, isPersonLikeLead, isPlausibleEmail, skippedLeadReport, applyLeadIdentity } from './research.js';
import { extractCompanyHintFromText } from './rfqHints.js';
import { extractRfqClues, rfqCorpus, classifyResearchPath } from './researchPath.js';
import { VERIFIED_SOURCES } from './openSources.js';
import { isForwarderName, isOutreachEmail } from './kyb.js';

export function researchPriority(customer = {}) {
  const src = String(customer.source || '');
  if (/World Bank/i.test(src)) return 90;
  if (/TED|Contracts Finder/i.test(src)) return 0;
  if (/USASpending|SAM/i.test(src)) return 1;
  const name = `${customer.company || ''} ${customer.name || ''}`;
  if (/\b(limited|ltd|inc|gmbh|plc|llc|b\.?v|sarl|pty|pvt|college|university|hospital|council|politechnika|nemocnice)\b/i.test(name)) {
    return 2;
  }
  return 8;
}

let tickTimer = null;
let researchingId = null;
let researchLoop = false;

export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.pipeline.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function beijingHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.pipeline.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now)
  );
}

export function ensurePipeline() {
  if (!db.pipeline) {
    db.pipeline = {
      queue: [],
      lastDailyDate: '',
      lastDailyAt: '',
      lastIntradayAt: '',
      syncStatus: 'idle',
      lastError: '',
      lastSync: null,
      researchedToday: 0,
      appliedToday: 0,
      backlogDate: '',
      backlogEnqueued: 0,
    };
  }
  if (!Array.isArray(db.pipeline.queue)) db.pipeline.queue = [];
  return db.pipeline;
}

export function pickAutoEmail(research) {
  if (!research?.emails?.length) return null;
  if (research.kyb?.grade === 'C' || (research.kyb?.sanctions || []).length) return null;
  if (!['high', 'medium'].includes(research.confidence)) return null;
  const verified = (research.facts || []).some((f) => VERIFIED_SOURCES.has(f.source));
  if (!verified) return null;
  return (
    research.emails.find((e) => isOutreachEmail(e) && (e.score || 0) >= 70) ||
    null
  );
}

export { isForwarderName };

function ownInbox(email) {
  return String(email || '').toLowerCase() === String(config.smtp.user || '').toLowerCase();
}

export function stampLeadPath(c) {
  const clues = extractRfqClues(rfqCorpus(c));
  const path = classifyResearchPath(c, { personLike: isPersonLikeLead(c), clues });
  const changed = c.researchPath !== path.key;
  c.researchPath = path.key;
  return { path, changed };
}

export function applyTextCompanyHints() {
  let promoted = 0;
  let dirty = false;
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    const clues = extractRfqClues(rfqCorpus(c));
    if (!c.website && clues.websites[0]) {
      c.website = clues.websites[0];
      dirty = true;
    }
    if (c.forceCompany) {
      if (stampLeadPath(c).changed) dirty = true;
      continue;
    }
    if (!isPersonLikeLead(c)) {
      if (stampLeadPath(c).changed) dirty = true;
      continue;
    }
    const hint = clues.companyHint || extractCompanyHintFromText(`${c.painPoints || ''} ${c.title || ''}`);
    if (!hint) {
      if (stampLeadPath(c).changed) dirty = true;
      continue;
    }
    try {
      applyLeadIdentity(c, { company: hint, website: clues.websites[0] });
      c.identitySource = c.identitySource || 'rfq_text';
      c.research = null;
      stampLeadPath(c);
      promoted += 1;
    } catch {
      if (stampLeadPath(c).changed) dirty = true;
    }
  }
  if (promoted || dirty) save();
  return promoted;
}

export function stampPersonLikeLeads() {
  let stamped = 0;
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'running') c.research = { ...(c.research || {}), status: null };
    if (!isPersonLikeLead(c)) continue;
    if (c.researchPath === 'clues' || c.researchPath === 'crosspost') continue;
    if (c.research?.status === 'done') continue;
    c.research = skippedLeadReport(c);
    stamped += 1;
  }
  if (stamped) save();
  return stamped;
}

export function pruneResearchQueue() {
  const p = ensurePipeline();
  const before = p.queue.length;
  p.queue = p.queue.filter((id) => {
    const c = getCustomer(id);
    if (!c) return false;
    if (isPersonLikeLead(c) && c.researchPath !== 'clues' && c.researchPath !== 'crosspost') return false;
    if (c.research?.status === 'done') return false;
    return true;
  });
  if (p.queue.length !== before) save();
  return before - p.queue.length;
}

export function enqueuePendingResearch({ limit = 800 } = {}) {
  pruneResearchQueue();
  const pending = [];
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'done' || c.research?.status === 'running') continue;
    if (isPersonLikeLead(c) && c.researchPath !== 'clues' && c.researchPath !== 'crosspost') continue;
    if (/World Bank/i.test(c.source || '')) continue;
    pending.push(c);
  }
  pending.sort((a, b) => researchPriority(a) - researchPriority(b));
  return enqueueResearch(pending.slice(0, Math.min(Math.max(Number(limit) || 800, 1), 4000)));
}

export function kickResearch() {
  pumpResearch();
  return getPipelineState();
}

export function enqueueResearch(customers = []) {
  const p = ensurePipeline();
  const seen = new Set(p.queue);
  let added = 0;
  for (const c of customers) {
    const id = c?.id || c;
    if (!id || seen.has(id)) continue;
    const row = typeof c === 'object' ? c : getCustomer(id);
    if (!row) continue;
    if (row.research?.status === 'done' || row.research?.status === 'running') continue;
    p.queue.push(id);
    seen.add(id);
    added += 1;
  }
  if (added) save();
  return added;
}

function enqueueDailyBacklog() {
  const p = ensurePipeline();
  const today = beijingDate();
  if (p.backlogDate === today) return 0;
  const pending = [];
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'done' || c.research?.status === 'running') continue;
    if (isPersonLikeLead(c) && c.researchPath !== 'clues' && c.researchPath !== 'crosspost') continue;
    if (/World Bank/i.test(c.source || '')) continue;
    pending.push(c);
    if (pending.length >= config.pipeline.backlogPerDay * 3) break;
  }
  pending.sort((a, b) => researchPriority(a) - researchPriority(b));
  const added = enqueueResearch(pending.slice(0, config.pipeline.backlogPerDay));
  p.backlogDate = today;
  p.backlogEnqueued = added;
  save();
  return added;
}

export async function identifyLead(id, payload = {}) {
  const customer = getCustomer(id);
  if (!customer) {
    const err = new Error('线索不存在');
    err.status = 404;
    throw err;
  }
  applyLeadIdentity(customer, payload);
  save();
  logActivity({
    customerId: customer.id,
    action: '补主体',
    detail: `${customer.buyerAlias || customer.name} → ${customer.company}${customer.regNo ? `，登记号 ${customer.regNo}` : ''}`,
  });
  const research = await runLeadResearch(customer, { useAi: false, autoApply: true });
  return { customer, research };
}

export function applyPublicContact(customer, email, extra = {}) {
  const addr = String(email || '').trim().toLowerCase();
  if (!isPlausibleEmail(addr) || ownInbox(addr)) return false;
  customer.email = addr;
  if (extra.website) customer.website = extra.website;
  if (extra.company) customer.company = extra.company;
  customer.contactSource = extra.contactSource || 'public_research';
  if (customer.agentPhase === 'need_email') customer.agentPhase = null;
  return true;
}

export async function runLeadResearch(customer, { useAi = true, autoApply = false } = {}) {
  if (researchingId === customer.id) {
    const err = new Error('正在背调中');
    err.status = 409;
    throw err;
  }
  researchingId = customer.id;
  customer.research = { ...(customer.research || {}), status: 'running', updatedAt: new Date().toISOString() };
  try {
    const personLike = isPersonLikeLead(customer);
    const report = await researchLead(customer, { useAi: useAi && !personLike });
    customer.research = report;
    if (report.website && !customer.website) customer.website = report.website;
    if (report.legalName && report.legalName !== customer.company) customer.legalName = report.legalName;

    let applied = null;
    if (autoApply && !customer.email && !isForwarderName(customer.company || customer.name)) {
      const picked = pickAutoEmail(report);
      if (picked && applyPublicContact(customer, picked.email, {
        website: report.website,
        company: report.legalName || customer.company,
        contactSource: 'auto_research',
      })) {
        applied = picked.email;
        const p = ensurePipeline();
        if (p.appliedDate !== beijingDate()) {
          p.appliedDate = beijingDate();
          p.appliedToday = 0;
        }
        p.appliedToday = (p.appliedToday || 0) + 1;
      }
    }

    const p = ensurePipeline();
    if (p.researchDate !== beijingDate()) {
      p.researchDate = beijingDate();
      p.researchedToday = 0;
    }
    p.researchedToday = (p.researchedToday || 0) + 1;
    save();
    logActivity({
      customerId: customer.id,
      action: applied ? '自动背调并写入公开邮箱' : '公开背调',
      detail: applied
        ? `${customer.company || customer.name}：自动写入 ${applied}，Agent 可按开发信流程联系该公开角色邮箱`
        : report.emails?.length
          ? `${customer.company || customer.name}：核到 ${report.emails.map((e) => e.email).join('、')}`
          : `${customer.company || customer.name}：${report.steps?.find((s) => s.key === 'contact')?.detail || '未找到公开邮箱'}`,
    });
    return report;
  } catch (err) {
    customer.research = { status: 'failed', error: String(err.message || err), updatedAt: new Date().toISOString() };
    save();
    throw err;
  } finally {
    researchingId = null;
  }
}

async function pumpResearch() {
  if (researchLoop) return;
  researchLoop = true;
  try {
    while (true) {
      const p = ensurePipeline();
      const id = p.queue.shift();
      if (!id) break;
      save();
      const customer = getCustomer(id);
      if (!customer) continue;
      try {
        await runLeadResearch(customer, { useAi: false, autoApply: true });
      } catch (err) {
        if (err.status !== 409) {
          p.lastError = String(err.message || err);
          save();
        }
      }
      await new Promise((r) => setTimeout(r, config.pipeline.researchDelayMs));
    }
  } finally {
    researchLoop = false;
  }
}

export async function runDailySync({ reason = 'scheduled' } = {}) {
  const p = ensurePipeline();
  if (p.syncStatus === 'running') return { ...getPipelineState(), skipped: true };
  const since = beijingDate();
  p.syncStatus = 'running';
  p.lastError = '';
  p.syncStartedAt = new Date().toISOString();
  p.syncReason = reason;
  save();
  logActivity({ action: '询盘日报', detail: `开始拉取 ${since} 起的新询盘（${reason}）` });
  try {
    const result = await crawlAllAndImport({
      since,
      alibabaPages: config.pipeline.alibabaPages,
      govLimit: config.pipeline.govLimit,
      doImport: true,
      fanout: false,
    });
    const created = result.created || [];
    applyTextCompanyHints();
    enqueueResearch(created);
    enqueueDailyBacklog();
    p.syncStatus = 'done';
    p.lastDailyDate = since;
    p.lastDailyAt = new Date().toISOString();
    p.lastIntradayAt = p.lastDailyAt;
    p.lastSync = {
      since,
      reason,
      fetched: result.items.length,
      createdCount: result.createdCount,
      reports: result.reports,
      queued: p.queue.length,
    };
    save();
    logActivity({
      action: '询盘日报',
      detail: `${since} 抓到 ${result.items.length} 条，新入库 ${result.createdCount} 条，背调队列 ${p.queue.length}`,
    });
    pumpResearch();
    return getPipelineState();
  } catch (err) {
    p.syncStatus = 'error';
    p.lastError = String(err.message || err);
    save();
    throw err;
  }
}

function dueForDaily(now = new Date()) {
  const p = ensurePipeline();
  const today = beijingDate(now);
  if (p.syncStatus === 'running') return false;
  if (p.lastDailyDate === today) return false;
  return beijingHour(now) >= config.pipeline.dailyHour;
}

function dueForRefresh(now = new Date()) {
  const p = ensurePipeline();
  const today = beijingDate(now);
  if (p.syncStatus === 'running') return false;
  if (p.lastDailyDate !== today) return false;
  if (!p.lastIntradayAt) return true;
  const elapsed = Date.now() - new Date(p.lastIntradayAt).getTime();
  return elapsed >= config.pipeline.refreshHours * 3600 * 1000;
}

export function getPipelineState() {
  const p = ensurePipeline();
  const today = beijingDate();
  let todayNew = 0;
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.ingestedAt && String(c.ingestedAt).startsWith(today)) todayNew += 1;
  }
  return {
    timezone: config.pipeline.timezone,
    dailyHour: config.pipeline.dailyHour,
    today,
    todayNew,
    syncStatus: p.syncStatus || 'idle',
    lastDailyDate: p.lastDailyDate || '',
    lastDailyAt: p.lastDailyAt || '',
    lastIntradayAt: p.lastIntradayAt || '',
    lastError: p.lastError || '',
    lastSync: p.lastSync || null,
    queue: p.queue.length,
    researchingId,
    researchedToday: p.researchDate === today ? p.researchedToday || 0 : 0,
    appliedToday: p.appliedDate === today ? p.appliedToday || 0 : 0,
    nextDaily: p.lastDailyDate === today ? `明天 ${String(config.pipeline.dailyHour).padStart(2, '0')}:00` : `今天 ${String(config.pipeline.dailyHour).padStart(2, '0')}:00 后`,
  };
}

export async function promoteLeads(ids = [], { researchLimit = 6 } = {}) {
  const promoted = [];
  const skipped = [];
  let researched = 0;
  for (const id of ids.slice(0, 50)) {
    const customer = getCustomer(id);
    if (!customer) {
      skipped.push({ id, reason: '线索不存在' });
      continue;
    }
    const personLike = isPersonLikeLead(customer);
    if (!customer.email && !customer.research?.emails?.[0]?.email && researched < researchLimit && !personLike) {
      try {
        await runLeadResearch(customer, { useAi: false, autoApply: false });
        researched += 1;
      } catch (err) {
        skipped.push({ id, company: customer.company || customer.name, reason: `背调失败：${err.message || err}` });
        continue;
      }
    }
    if (!customer.email) {
      const picked = pickAutoEmail(customer.research) || (customer.research?.outreach?.email
        ? { email: customer.research.outreach.email }
        : null);
      if (picked?.email) {
        applyPublicContact(customer, picked.email, {
          website: customer.research.website,
          company: customer.research.legalName || customer.company,
          contactSource: 'public_research',
        });
      }
    }
    if (customer.research?.kyb?.grade === 'C' || (customer.research?.kyb?.sanctions || []).length) {
      skipped.push({
        id,
        company: customer.company || customer.name,
        reason: customer.research.kyb?.nextAction || '分级为停，不能录入开发信',
      });
      continue;
    }
    const email = String(customer.email || '').toLowerCase();
    if (!email || customer.agentPhase === 'need_email' || isDemoCustomer(customer)) {
      skipped.push({
        id,
        company: customer.company || customer.name,
        reason: personLike ? '只有个人昵称，公开库核不到公司，不能录入开发信' : '还没有可发信的公开角色邮箱',
      });
      continue;
    }
    if (email === String(config.smtp.user || '').toLowerCase()) {
      skipped.push({ id, company: customer.company || customer.name, reason: '不能用自己的发件箱当客户' });
      continue;
    }
    customer.inOutreach = true;
    customer.status = customer.status === 'replied' ? customer.status : 'uncontacted';
    customer.agentPhase = null;
    promoted.push({ id, company: customer.company || customer.name, email: customer.email });
    logActivity({
      customerId: customer.id,
      action: '录入开发信',
      detail: `${customer.company || customer.name} 已进入开发信名单，Agent 将自动研究、写信并按时区发送。`,
    });
  }
  save();
  return { promoted, skipped };
}

export function startLeadPipeline() {
  const p = ensurePipeline();
  applyTextCompanyHints();
  pruneResearchQueue();
  enqueueDailyBacklog();
  pumpResearch();
  if (tickTimer) clearInterval(tickTimer);
  const tick = () => {
    if (dueForDaily()) {
      runDailySync({ reason: 'daily' }).catch((err) => {
        p.lastError = String(err.message || err);
        save();
      });
      return;
    }
    if (dueForRefresh()) {
      runDailySync({ reason: 'intraday' }).catch((err) => {
        p.lastError = String(err.message || err);
        save();
      });
    }
    if (!researchLoop && p.queue.length) pumpResearch();
  };
  tickTimer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 4000);
  return getPipelineState();
}

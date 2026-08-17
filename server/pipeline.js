import { config, googleSearchReady } from './config.js';
import { db, save, getCustomer, isRfqLead, isDemoCustomer, logActivity } from './store.js';
import { crawlAllAndImport, importRfqItems } from './rfq.js';
import { researchLead, isPersonLikeLead, isPlausibleEmail, applyLeadIdentity, compactSkippedReport, cleanOfficialBuyerName } from './research.js';
import { extractCompanyHintFromText } from './rfqHints.js';
import { extractRfqClues, rfqCorpus, classifyResearchPath } from './researchPath.js';
import { EMAIL_GUESS_REFUSAL, isEmailGuessRequest } from './peopleProbe.js';
import { clusterDemandKeywords, searchDemandPeers } from './demandPeers.js';
import { VERIFIED_SOURCES } from './openSources.js';
import { isForwarderName, isOutreachEmail } from './kyb.js';
import { summarizeAlibabaPlan, propagateAlibabaIdentity } from './alibabaIntel.js';
import { PLAYBOOK_STEPS, bestNext } from './playbook.js';

export function researchPriority(customer = {}) {
  const src = String(customer.source || '');
  if (/World Bank/i.test(src)) return 90;
  if (/TED|Contracts Finder/i.test(src)) return 0;
  if (/USASpending|SAM/i.test(src)) return 1;
  const name = `${customer.company || ''} ${customer.name || ''}`;
  if (/\b(limited|ltd|inc|gmbh|plc|llc|b\.?v|sarl|pty|pvt|college|university|hospital|council|politechnika|nemocnice)\b/i.test(name)) {
    return 2;
  }
  if (customer.researchPath === 'clues' || customer.website || customer.email) return 3;
  if (customer.researchPath === 'crosspost') return 5;
  return 8;
}

let tickTimer = null;
const researchingIds = new Set();
let researchLoop = false;
let saveLock = Promise.resolve();

function saveExclusive() {
  saveLock = saveLock.then(() => save(), () => save());
  return saveLock;
}

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
    research.emails.find((e) => e.evidence?.ready) ||
    research.emails.find((e) => isOutreachEmail(e) && (e.evidence?.score || e.score || 0) >= 80) ||
    null
  );
}

export { isForwarderName };

function ownInbox(email) {
  return String(email || '').toLowerCase() === String(config.smtp.user || '').toLowerCase();
}

export function stampLeadPath(c) {
  const clues = extractRfqClues(rfqCorpus(c), c);
  const path = classifyResearchPath(c, { personLike: isPersonLikeLead(c), clues });
  const changed = c.researchPath !== path.key;
  c.researchPath = path.key;
  return { path, changed };
}

function identityNeedsRefresh(customer = {}) {
  const name = String(customer.company || '');
  if (!name) return false;
  if (/^(contacting|looking|seeking|reaching|writing|interested|executive director|director|manager)\b/i.test(name)) return true;
  if (/\bon behalf of\b/i.test(name)) return true;
  if (/\.\s*We$/i.test(name)) return true;
  return false;
}

export function applyTextCompanyHints() {
  let promoted = 0;
  let dirty = false;
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (/TED|Contracts Finder|USASpending|SAM/i.test(c.source || '')) {
      const cleaned = cleanOfficialBuyerName(c.company || c.name);
      if (cleaned && cleaned !== c.company) {
        c.company = cleaned;
        dirty = true;
      }
    }
    const clues = extractRfqClues(rfqCorpus(c), c);
    if (!c.website && clues.websites[0]) {
      c.website = clues.websites[0];
      dirty = true;
    }
    if (c.forceCompany && !identityNeedsRefresh(c)) {
      if (stampLeadPath(c).changed) dirty = true;
      continue;
    }
    if (!isPersonLikeLead(c) && !identityNeedsRefresh(c)) {
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
  const cluster = propagateAlibabaIdentity(db.customers);
  if (cluster.propagated) dirty = true;
  if (promoted || dirty) save();
  if (promoted || dirty) invalidateKybPlan();
  return promoted;
}

export function stampPersonLikeLeads() {
  let stamped = 0;
  const now = new Date().toISOString();
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'running' || c.research?.status === 'done') continue;
    if (/World Bank/i.test(c.source || '')) {
      c.research = compactSkippedReport(c, 'project');
      c.research.updatedAt = now;
      c.researchPath = 'import';
      stamped += 1;
      continue;
    }
    if (!isPersonLikeLead(c)) continue;
    if (c.researchPath === 'clues' || c.researchPath === 'crosspost') continue;
    c.research = compactSkippedReport(c);
    c.research.updatedAt = now;
    c.researchPath = c.researchPath || 'import';
    stamped += 1;
  }
  if (stamped) save();
  return stamped;
}

let kybPass = { status: 'idle' };
let kybPlanCache = { at: 0, value: null };

export function getKybPassState() {
  return kybPass;
}

export function summarizeKybPlan(customers = []) {
  const counts = {
    total: 0,
    auto: 0,
    clues: 0,
    crosspost: 0,
    import: 0,
    government: 0,
    hasEmail: 0,
    hasWebsite: 0,
    textHint: 0,
    person: 0,
    live: 0,
    alibaba: null,
  };
  for (const c of customers) {
    if (!isRfqLead(c)) continue;
    counts.total += 1;
    if (c.email) counts.hasEmail += 1;
    if (c.website) counts.hasWebsite += 1;
    if (c.identitySource === 'rfq_text') counts.textHint += 1;
    if (/TED|Contracts Finder|USASpending|SAM/i.test(c.source || '')) counts.government += 1;
    const person = isPersonLikeLead(c);
    if (person) counts.person += 1;
    const key = c.researchPath || (person ? 'import' : 'auto');
    if (key === 'auto' || key === 'clues' || key === 'crosspost' || key === 'import') counts[key] += 1;
    else counts.import += 1;
  }
  counts.live = counts.auto + counts.clues + counts.crosspost;
  counts.alibaba = summarizeAlibabaPlan(customers);
  return counts;
}

export function kybPlanStats({ force = false } = {}) {
  if (!force && kybPlanCache.value && Date.now() - kybPlanCache.at < 15000) return kybPlanCache.value;
  const value = summarizeKybPlan(db.customers);
  kybPlanCache = { at: Date.now(), value };
  return value;
}

function invalidateKybPlan() {
  kybPlanCache = { at: 0, value: null };
}

/** Promote text hints, compact-stamp nicknames/projects, queue the rest for live KYB. */
export function prepareFullKybPass() {
  let promoted = 0;
  let stamped = 0;
  let live = 0;
  const now = new Date().toISOString();
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'done' || c.research?.status === 'running') continue;

    if (/World Bank/i.test(c.source || '')) {
      c.research = compactSkippedReport(c, 'project');
      c.research.updatedAt = now;
      c.researchPath = 'import';
      stamped += 1;
      continue;
    }

    const clues = extractRfqClues(rfqCorpus(c), c);
    if (!c.website && clues.websites[0]) c.website = clues.websites[0];

    if (isPersonLikeLead(c) && !c.forceCompany) {
      const hint = clues.companyHint || extractCompanyHintFromText(`${c.painPoints || ''} ${c.title || ''}`);
      if (hint) {
        try {
          applyLeadIdentity(c, { company: hint, website: clues.websites[0] });
          c.identitySource = c.identitySource || 'rfq_text';
          c.research = null;
          stampLeadPath(c);
          promoted += 1;
          live += 1;
          continue;
        } catch {
          /* still a nickname */
        }
      }
      if (clues.websites[0] || clues.emails[0]) {
        c.researchPath = 'clues';
        live += 1;
        continue;
      }
      if (clues.fingerprints.length) {
        c.researchPath = 'crosspost';
        live += 1;
        continue;
      }
      c.research = compactSkippedReport(c);
      c.research.updatedAt = now;
      c.researchPath = 'import';
      stamped += 1;
      continue;
    }

    stampLeadPath(c);
    live += 1;
  }
  if (promoted || stamped) save();
  invalidateKybPlan();
  return { promoted, stamped, live, plan: summarizeKybPlan(db.customers) };
}

function isCompactNicknameReport(r) {
  return r?.status === 'done' && r?.grade === 'C' && !r?.steps
    && /个人显示名/.test(String(r?.brief || ''));
}

export function reopenSignalLeads({ limit = 2500 } = {}) {
  const canSearch = googleSearchReady();
  const candidates = [];
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'running') continue;
    if (c.research?.status === 'done' && !isCompactNicknameReport(c.research)) continue;
    const text = rfqCorpus(c);
    const hint = extractCompanyHintFromText(text);
    const clues = extractRfqClues(text);
    let score = 0;
    if (hint) score += 100;
    if (clues.websites[0] || clues.emails[0]) score += 80;
    if (clues.fingerprints.length) score += 40;
    if (score < 20) continue;
    if (!hint && !canSearch && !clues.websites[0] && !clues.emails[0] && !clues.fingerprints.length) continue;
    candidates.push({ c, score, hint });
  }
  candidates.sort((a, b) => b.score - a.score);
  let promoted = 0;
  let reopened = 0;
  const toQueue = [];
  for (const { c, hint } of candidates.slice(0, Math.min(Math.max(Number(limit) || 2500, 1), 8000))) {
    if (hint) {
      try {
        applyLeadIdentity(c, { company: hint, website: extractRfqClues(rfqCorpus(c)).websites[0] });
      } catch {
        c.buyerAlias = c.buyerAlias || c.company || c.name;
        c.company = hint;
        c.forceCompany = true;
        c.research = null;
      }
      c.identitySource = c.identitySource || 'rfq_text';
      c.research = null;
      stampLeadPath(c);
      promoted += 1;
      toQueue.push(c);
      continue;
    }
    if (!canSearch) continue;
    c.research = null;
    c.researchPath = 'crosspost';
    reopened += 1;
    toQueue.push(c);
  }
  const added = enqueueResearch(toQueue);
  if (promoted || reopened) save();
  return { promoted, reopened, added, considered: candidates.length };
}

export async function importDemandPeerClusters({ maxClusters = 12, perCluster = 6 } = {}) {
  const compact = db.customers.filter((c) => isRfqLead(c) && isCompactNicknameReport(c.research));
  const clusters = clusterDemandKeywords(compact, { maxClusters });
  let fetched = 0;
  const items = [];
  for (const cluster of clusters) {
    const rows = await searchDemandPeers(cluster.sample, { limit: perCluster });
    fetched += rows.length;
    items.push(...rows);
  }
  const created = importRfqItems(items, { quiet: true });
  const added = enqueueResearch(created);
  return { clusters: clusters.length, fetched, created: created.length, added };
}

let signalPass = { status: 'idle' };

export function getSignalPassState() {
  return signalPass;
}

export function startSignalPass({ limit = 800 } = {}) {
  if (signalPass.status === 'running') return signalPass;
  signalPass = { status: 'running', startedAt: new Date().toISOString(), limit };
  setImmediate(async () => {
    try {
      const reopened = reopenSignalLeads({ limit });
      const peers = await importDemandPeerClusters({ maxClusters: 8, perCluster: 4 });
      kickResearch();
      signalPass = {
        status: 'done',
        startedAt: signalPass.startedAt,
        finishedAt: new Date().toISOString(),
        ...reopened,
        peers,
      };
    } catch (err) {
      signalPass = {
        status: 'error',
        startedAt: signalPass.startedAt,
        error: String(err.message || err),
      };
    }
  });
  return signalPass;
}

export function startFullKybPass() {
  if (kybPass.status === 'running') return kybPass;
  kybPass = { status: 'running', startedAt: new Date().toISOString() };
  setImmediate(() => {
    try {
      const prep = prepareFullKybPass();
      const added = enqueuePendingResearch({ limit: 50000 });
      kickResearch();
      kybPass = {
        status: 'done',
        startedAt: kybPass.startedAt,
        finishedAt: new Date().toISOString(),
        ...prep,
        added,
      };
    } catch (err) {
      kybPass = {
        status: 'error',
        startedAt: kybPass.startedAt,
        error: String(err.message || err),
      };
    }
  });
  return kybPass;
}

export function pruneResearchQueue() {
  const p = ensurePipeline();
  const before = p.queue.length;
  p.queue = p.queue.filter((id) => {
    const c = getCustomer(id);
    if (!c) return false;
    if (isPersonLikeLead(c) && c.researchPath !== 'clues' && c.researchPath !== 'crosspost') return false;
    if (/World Bank/i.test(c.source || '')) return false;
    if (c.research?.status === 'done') return false;
    return true;
  });
  if (p.queue.length !== before) save();
  return before - p.queue.length;
}

export function leadQueuePath(customer = {}) {
  return customer.researchPath || (isPersonLikeLead(customer) ? 'import' : 'auto');
}

export function enqueuePendingResearch({ limit = 800, paths } = {}) {
  pruneResearchQueue();
  const allow = Array.isArray(paths) && paths.length ? new Set(paths) : null;
  const pending = [];
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    if (c.research?.status === 'done' || c.research?.status === 'running') continue;
    if (isPersonLikeLead(c) && c.researchPath !== 'clues' && c.researchPath !== 'crosspost') continue;
    if (/World Bank/i.test(c.source || '')) continue;
    if (allow && !allow.has(leadQueuePath(c))) continue;
    pending.push(c);
  }
  pending.sort((a, b) => researchPriority(a) - researchPriority(b));
  const cap = Math.min(Math.max(Number(limit) || 800, 1), 50000);
  return enqueueResearch(pending.slice(0, cap));
}

/**
 * Best next-step pass: promote text hints, then research only official-search +
 * clue harvest (no 12k SKU crosspost). Humans still unlock Alibaba seller emails.
 */
export function startBestPass({ limit = 400, wait = false } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 400, 1), 2000);
  const p = ensurePipeline();
  if (p.playbook?.status === 'running') {
    return { ...p.playbook, limit: cap, steps: PLAYBOOK_STEPS, skipped: true };
  }
  p.playbook = {
    status: 'running',
    startedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    promoted: 0,
    queued: 0,
    limit: cap,
    paths: ['auto', 'clues'],
  };
  save();
  const run = () => {
    try {
      const promoted = applyTextCompanyHints();
      const queued = enqueuePendingResearch({ limit: cap, paths: ['auto', 'clues'] });
      p.playbook = {
        status: 'done',
        startedAt: p.playbook.startedAt,
        lastRunAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        promoted,
        queued,
        limit: cap,
        paths: ['auto', 'clues'],
      };
      save();
      kickResearch();
    } catch (err) {
      p.playbook = {
        status: 'error',
        startedAt: p.playbook?.startedAt,
        lastRunAt: new Date().toISOString(),
        error: String(err.message || err),
        limit: cap,
        paths: ['auto', 'clues'],
      };
      save();
    }
  };
  if (wait) run();
  else setImmediate(run);
  return { ...p.playbook, steps: PLAYBOOK_STEPS };
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
  if (isEmailGuessRequest(payload)) {
    const err = new Error(EMAIL_GUESS_REFUSAL);
    err.status = 400;
    throw err;
  }
  applyLeadIdentity(customer, payload);
  save();
  logActivity({
    customerId: customer.id,
    action: '补主体',
    detail: `${customer.buyerAlias || customer.name} → ${customer.company}${customer.regNo ? `，登记号 ${customer.regNo}` : ''}`,
  });
  const research = await runLeadResearch(customer, { useAi: false, autoApply: true, peopleProbe: true });
  return { customer, research, playbook: bestNext(customer) };
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

export async function runLeadResearch(customer, { useAi = true, autoApply = false, peopleProbe = false } = {}) {
  if (researchingIds.has(customer.id)) {
    const err = new Error('正在背调中');
    err.status = 409;
    throw err;
  }
  researchingIds.add(customer.id);
  customer.research = { ...(customer.research || {}), status: 'running', updatedAt: new Date().toISOString() };
  try {
    const personLike = isPersonLikeLead(customer);
    const report = await researchLead(customer, { useAi: useAi && !personLike, peopleProbe });
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
    await saveExclusive();
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
    await saveExclusive();
    throw err;
  } finally {
    researchingIds.delete(customer.id);
  }
}

async function pumpOne() {
  while (true) {
    const p = ensurePipeline();
    const id = p.queue.shift();
    if (!id) break;
    const customer = getCustomer(id);
    if (!customer || /World Bank/i.test(customer.source || '')) continue;
    try {
      await runLeadResearch(customer, { useAi: false, autoApply: true });
    } catch (err) {
      if (err.status !== 409) {
        p.lastError = String(err.message || err);
      }
    }
    await new Promise((r) => setTimeout(r, config.pipeline.researchDelayMs));
  }
}

async function pumpResearch() {
  if (researchLoop) return;
  researchLoop = true;
  try {
    const n = Math.min(Math.max(Number(config.pipeline.researchConcurrency) || 1, 1), 4);
    await Promise.all(Array.from({ length: n }, () => pumpOne()));
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
    researchingId: [...researchingIds][0] || null,
    researchingIds: [...researchingIds],
    researchedToday: p.researchDate === today ? p.researchedToday || 0 : 0,
    appliedToday: p.appliedDate === today ? p.appliedToday || 0 : 0,
    nextDaily: p.lastDailyDate === today ? `明天 ${String(config.pipeline.dailyHour).padStart(2, '0')}:00` : `今天 ${String(config.pipeline.dailyHour).padStart(2, '0')}:00 后`,
    kybPass,
    signalPass,
    kybPlan: kybPlanStats(),
    playbook: p.playbook || null,
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
    if ((customer.research?.kyb?.sanctions || []).length) {
      skipped.push({
        id,
        company: customer.company || customer.name,
        reason: customer.research.kyb?.nextAction || '制裁名单命中，不能录入开发信',
      });
      continue;
    }
    if (customer.research?.kyb?.grade === 'C' && customer.contactSource !== 'alibaba_seller') {
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
    const sellerUnlocked = customer.contactSource === 'alibaba_seller';
    if (/@(gmail|yahoo|ymail|hotmail|outlook|live\.com|icloud|proton|qq\.com|163\.com|126\.com|mail\.ru)/i.test(email) && !sellerUnlocked) {
      skipped.push({ id, company: customer.company || customer.name, reason: '私人邮箱不能进开发信' });
      continue;
    }
    if (/lawrencetheband\.com|washington\.org|civilsolutionsva\.com/i.test(email)) {
      skipped.push({ id, company: customer.company || customer.name, reason: '撞名域名，不是这家主体的官网邮箱' });
      continue;
    }
    if (customer.research?.kyb?.grade && customer.research.kyb.grade !== 'A' && !sellerUnlocked) {
      skipped.push({ id, company: customer.company || customer.name, reason: '开发信只收录 A 级可发信主体' });
      continue;
    }
    customer.inOutreach = true;
    if (customer.status !== 'replied' && customer.status !== 'following') customer.status = 'uncontacted';
    if (!['scheduled', 'waiting', 'working'].includes(customer.agentPhase)) {
      customer.agentPhase = null;
    }
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
  setImmediate(() => {
    try {
      applyTextCompanyHints();
      enqueuePendingResearch({
        limit: Math.min(config.pipeline.backlogPerDay || 80, 400),
        paths: ['auto', 'clues'],
      });
      if (!researchLoop && p.queue.length) pumpResearch();
    } catch (err) {
      p.lastError = String(err.message || err);
      save();
    }
  });
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

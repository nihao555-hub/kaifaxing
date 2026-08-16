import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCustomers, seedThreads, seedAiPanel } from './data/seed.js';
import { isPersonLikeLead } from './research.js';
import { config, googleSearchStatus } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {
      customers: seedCustomers,
      threads: seedThreads,
      aiPanel: seedAiPanel,
      sentLog: [], // { customerId, sentAt } 用于每日发送上限统计
      activities: [], // 写入现有「活动记录」Tab，供人工监控
    };
  }
}

export const db = load();

function ensureSearchSettings() {
  if (!db.settings) db.settings = {};
  if (!db.settings.search) db.settings.search = {};
}

export function applyStoredSearchSettings() {
  ensureSearchSettings();
  const saved = db.settings.search;
  if (!process.env.GOOGLE_API_KEY && saved.apiKey) config.google.apiKey = saved.apiKey;
  if (!process.env.GOOGLE_CSE_ID && !process.env.GOOGLE_CX && saved.cseId) config.google.cseId = saved.cseId;
  if (!process.env.SERPER_API_KEY && saved.serperKey) config.google.serperKey = saved.serperKey;
  if (!process.env.COMPANIES_HOUSE_API_KEY && saved.companiesHouseKey) {
    config.companiesHouse.apiKey = saved.companiesHouseKey;
  }
  if (!process.env.OPENCORPORATES_API_KEY && saved.openCorporatesKey) {
    config.openCorporates.apiKey = saved.openCorporatesKey;
  }
}

export function saveSearchSettings({
  apiKey, cseId, serperKey, companiesHouseKey, openCorporatesKey, clear,
} = {}) {
  ensureSearchSettings();
  if (clear) {
    db.settings.search = {};
    if (!process.env.GOOGLE_API_KEY) config.google.apiKey = '';
    if (!process.env.GOOGLE_CSE_ID && !process.env.GOOGLE_CX) config.google.cseId = '';
    if (!process.env.SERPER_API_KEY) config.google.serperKey = '';
    if (!process.env.COMPANIES_HOUSE_API_KEY) config.companiesHouse.apiKey = '';
    if (!process.env.OPENCORPORATES_API_KEY) config.openCorporates.apiKey = '';
    save();
    return googleSearchStatus();
  }
  if (typeof apiKey === 'string' && apiKey.trim()) {
    db.settings.search.apiKey = apiKey.trim();
    if (!process.env.GOOGLE_API_KEY) config.google.apiKey = apiKey.trim();
  }
  if (typeof cseId === 'string' && cseId.trim()) {
    db.settings.search.cseId = cseId.trim();
    if (!process.env.GOOGLE_CSE_ID && !process.env.GOOGLE_CX) config.google.cseId = cseId.trim();
  }
  if (typeof serperKey === 'string' && serperKey.trim()) {
    db.settings.search.serperKey = serperKey.trim();
    if (!process.env.SERPER_API_KEY) config.google.serperKey = serperKey.trim();
  }
  if (typeof companiesHouseKey === 'string' && companiesHouseKey.trim()) {
    db.settings.search.companiesHouseKey = companiesHouseKey.trim();
    if (!process.env.COMPANIES_HOUSE_API_KEY) config.companiesHouse.apiKey = companiesHouseKey.trim();
  }
  if (typeof openCorporatesKey === 'string' && openCorporatesKey.trim()) {
    db.settings.search.openCorporatesKey = openCorporatesKey.trim();
    if (!process.env.OPENCORPORATES_API_KEY) config.openCorporates.apiKey = openCorporatesKey.trim();
  }
  save();
  return googleSearchStatus();
}

applyStoredSearchSettings();

export function isDemoCustomer(c) {
  const email = String(c?.email || '').toLowerCase();
  const id = String(c?.id || '');
  const own = String(config.smtp?.user || '').toLowerCase();
  if (own && email === own) return true;
  if (/\.example(\.com)?$/.test(email) || email.endsWith('@example.com') || email.endsWith('@example')) return true;
  if (/^c\d{1,2}$/.test(id)) return true;
  return false;
}

export function purgeDemoCustomers() {
  const keep = [];
  const removed = new Set();
  for (const c of db.customers) {
    if (isDemoCustomer(c)) removed.add(c.id);
    else keep.push(c);
  }
  if (!removed.size) return 0;
  db.customers = keep;
  for (const id of removed) {
    if (db.threads) delete db.threads[id];
    if (db.aiPanel) delete db.aiPanel[id];
  }
  save();
  return removed.size;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }, 200);
}

purgeDemoCustomers();
backfillOutreachFlag();

export function getCustomer(id) {
  return db.customers.find((c) => c.id === id);
}

function hasUsableEmail(c) {
  return Boolean(c?.email) && c.agentPhase !== 'need_email';
}

export function backfillOutreachFlag() {
  const sentIds = new Set((db.sentLog || []).map((s) => s.customerId));
  let changed = 0;
  for (const c of db.customers) {
    const sent = sentIds.has(c.id) || (db.threads?.[c.id] || []).length > 0;
    const human = ['following', 'replied'].includes(c.status);
    if (c.inOutreach && !sent && !human) {
      c.inOutreach = false;
      if (['working', 'scheduled', 'paused'].includes(c.agentPhase)) c.agentPhase = null;
      changed += 1;
      continue;
    }
    if (c.inOutreach || isDemoCustomer(c) || !hasUsableEmail(c)) continue;
    if (!sent && !human) continue;
    c.inOutreach = true;
    changed += 1;
  }
  if (changed) save();
  return changed;
}

export function isRfqLead(c) {
  return Boolean(c?.source || c?.awardId || c?.sourceUrl || c?.agentPhase === 'need_email');
}

function leadRank(c) {
  const person = isPersonLikeLead(c);
  if (person) return 2;
  const src = c.source || '';
  if (/阿里|Alibaba|GoldSupplier|TradeIndia/i.test(src)) return 0;
  if (/USASpending|Contracts Finder|TED|World Bank|SAM/.test(src)) return 1;
  return 1;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listCustomers({
  view = 'inbox',
  q = '',
  source = '',
  country = '',
  contact = '',
  quality = '',
  research = '',
  ingestedOn = '',
  postedOn = '',
  category = '',
  limit = 200,
  offset = 0,
} = {}) {
  const kw = String(q || '').trim().toLowerCase();
  const srcList = splitCsv(source);
  const ctryList = splitCsv(country);
  const items = [];
  for (const c of db.customers) {
    if (view === 'inbox' && !(hasUsableEmail(c) && c.inOutreach)) continue;
    if (view === 'leads' && !isRfqLead(c)) continue;
    if (srcList.length && !srcList.includes(c.source || '')) continue;
    if (ctryList.length) {
      const raw = String(c.country || '').trim() || '未标注';
      if (!ctryList.some((x) => raw === x || raw.toLowerCase() === x.toLowerCase())) continue;
    }
    if (contact === 'missing' && c.email) continue;
    if (contact === 'found' && !c.email) continue;
    if (contact === 'researched' && c.research?.status !== 'done') continue;
    if (contact === 'pending' && (c.email || c.research?.status === 'done')) continue;
    if (research === 'done' && c.research?.status !== 'done') continue;
    if (research === 'none' && c.research?.status === 'done') continue;
    if (ingestedOn && !String(c.ingestedAt || '').startsWith(ingestedOn)) continue;
    if (postedOn) {
      const days = splitCsv(postedOn);
      const day = String(c.postedDate || c.postedAt || '').slice(0, 10);
      if (!days.some((d) => day === d || day.startsWith(d))) continue;
    }
    if (category) {
      const cats = splitCsv(category);
      const name = String(c.categoryName || '').trim();
      if (!cats.some((x) => name === x || name.toLowerCase() === x.toLowerCase())) continue;
    }
    if (quality === 'company' || quality === 'person' || quality === 'auto' || quality === 'import') {
      const person = isPersonLikeLead(c);
      const path = c.researchPath || (person ? 'import' : 'auto');
      if (quality === 'company' && person) continue;
      if (quality === 'person' && !person) continue;
      if (quality === 'auto' && path === 'import') continue;
      if (quality === 'import' && path !== 'import') continue;
    }
    if (kw) {
      const hay = [c.name, c.company, c.email, c.country, c.source, c.painPoints, c.rfq?.title, c.buyer]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      if (!hay.includes(kw)) continue;
    }
    items.push(c);
  }
  if (view === 'leads') {
    items.sort((a, b) => {
      const d = leadRank(a) - leadRank(b);
      if (d) return d;
      return String(b.ingestedAt || b.lastActivity || '').localeCompare(String(a.ingestedAt || a.lastActivity || ''));
    });
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    total: items.length,
    offset: safeOffset,
    limit: safeLimit,
    items: items.slice(safeOffset, safeOffset + safeLimit),
  };
}

export function leadFacets() {
  const sources = {};
  const countries = {};
  const dates = {};
  const categories = {};
  let total = 0;
  let needEmail = 0;
  let hasEmail = 0;
  let researched = 0;
  for (const c of db.customers) {
    if (!isRfqLead(c)) continue;
    total += 1;
    const key = c.source || '未知';
    sources[key] = (sources[key] || 0) + 1;
    const country = String(c.country || '').trim() || '未标注';
    countries[country] = (countries[country] || 0) + 1;
    const day = String(c.postedDate || c.postedAt || '').slice(0, 10) || '未标注';
    dates[day] = (dates[day] || 0) + 1;
    const cat = String(c.categoryName || '').trim() || '未标注';
    categories[cat] = (categories[cat] || 0) + 1;
    if (c.email) hasEmail += 1;
    else needEmail += 1;
    if (c.research?.status === 'done') researched += 1;
  }
  return { total, needEmail, hasEmail, researched, sources, countries, dates, categories };
}

export function appendThread(customerId, entry) {
  if (!db.threads[customerId]) db.threads[customerId] = [];
  db.threads[customerId].push(entry);
  save();
}

export function sentToday() {
  const today = new Date().toISOString().slice(0, 10);
  return db.sentLog.filter((s) => s.sentAt.startsWith(today)).length;
}

export function logActivity({ customerId, action, detail }) {
  if (!db.activities) db.activities = [];
  db.activities.unshift({
    id: `a${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    customerId: customerId || null,
    action,
    detail,
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
  });
  db.activities = db.activities.slice(0, 400);
  save();
}

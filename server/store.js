import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCustomers, seedThreads, seedAiPanel } from './data/seed.js';
import { isPersonLikeDisplayName } from './research.js';

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

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }, 200);
}

export function getCustomer(id) {
  return db.customers.find((c) => c.id === id);
}

function hasUsableEmail(c) {
  return Boolean(c?.email) && c.agentPhase !== 'need_email';
}

export function isRfqLead(c) {
  return Boolean(c?.source || c?.awardId || c?.sourceUrl || c?.agentPhase === 'need_email');
}

function leadRank(c) {
  const person = isPersonLikeDisplayName(c.company || c.name) && (!c.company || c.company === c.name);
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
  limit = 200,
  offset = 0,
} = {}) {
  const kw = String(q || '').trim().toLowerCase();
  const srcList = splitCsv(source);
  const ctryList = splitCsv(country);
  const items = [];
  for (const c of db.customers) {
    if (view === 'inbox' && !hasUsableEmail(c)) continue;
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
    if (quality === 'company' || quality === 'person') {
      const person = isPersonLikeDisplayName(c.company || c.name) && (!c.company || c.company === c.name);
      if (quality === 'company' && person) continue;
      if (quality === 'person' && !person) continue;
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
    if (c.email) hasEmail += 1;
    else needEmail += 1;
    if (c.research?.status === 'done') researched += 1;
  }
  return { total, needEmail, hasEmail, researched, sources, countries };
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

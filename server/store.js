import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCustomers, seedThreads, seedAiPanel } from './data/seed.js';

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

export function appendThread(customerId, entry) {
  if (!db.threads[customerId]) db.threads[customerId] = [];
  db.threads[customerId].push(entry);
  save();
}

export function sentToday() {
  const today = new Date().toISOString().slice(0, 10);
  return db.sentLog.filter((s) => s.sentAt.startsWith(today)).length;
}

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { compactCustomer, DB_PATH } from './dataPersistence.js';
import { loadDotEnv } from './loadEnv.js';

loadDotEnv();

const BATCH = Math.max(100, Number(process.env.MONGODB_BATCH || 500));

export function mongoUri() {
  return String(process.env.MONGODB_URI || process.env.MONGO_URL || '').trim();
}

export function cloudDbReady() {
  return Boolean(mongoUri());
}

export function customerToDoc(customer) {
  const row = compactCustomer(customer);
  if (!row.id) return null;
  return { ...row, _id: row.id };
}

export function bulkReplaceOps(customers) {
  const ops = [];
  for (const customer of customers || []) {
    const doc = customerToDoc(customer);
    if (!doc) continue;
    ops.push({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: doc,
        upsert: true,
      },
    });
  }
  return ops;
}

let clientPromise = null;

async function getClient() {
  const uri = mongoUri();
  if (!uri) return null;
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 8,
      serverSelectionTimeoutMS: 12_000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function getCloudDb() {
  const client = await getClient();
  if (!client) return null;
  return client.db(process.env.MONGODB_DB || 'outreachai');
}

export async function ensureCloudIndexes(db) {
  const col = db.collection('customers');
  await Promise.all([
    col.createIndex({ source: 1 }),
    col.createIndex({ awardId: 1 }),
    col.createIndex({ country: 1 }),
    col.createIndex({ ingestedAt: -1 }),
  ]);
}

export async function cloudCustomerCount() {
  if (!cloudDbReady()) return 0;
  const db = await getCloudDb();
  if (!db) return 0;
  return db.collection('customers').countDocuments();
}

export async function cloudDbStatus() {
  if (!cloudDbReady()) {
    return { ready: false, configured: false, count: 0, db: '' };
  }
  try {
    const db = await getCloudDb();
    const count = await db.collection('customers').countDocuments();
    return {
      ready: true,
      configured: true,
      count,
      db: db.databaseName,
    };
  } catch (error) {
    return {
      ready: false,
      configured: true,
      count: 0,
      error: error.message,
    };
  }
}

export async function upsertCustomers(customers = []) {
  if (!cloudDbReady() || !customers.length) {
    return { ok: false, skipped: true, count: customers.length };
  }
  const db = await getCloudDb();
  const ops = bulkReplaceOps(customers);
  if (!ops.length) return { ok: true, count: 0 };
  const col = db.collection('customers');
  let upserted = 0;
  let modified = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const result = await col.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    upserted += result.upsertedCount || 0;
    modified += result.modifiedCount || 0;
  }
  return { ok: true, count: ops.length, upserted, modified };
}

export async function replaceAppState(database = {}) {
  if (!cloudDbReady()) return { ok: false, skipped: true };
  const db = await getCloudDb();
  const state = {
    _id: 'main',
    threads: database.threads || {},
    aiPanel: database.aiPanel || {},
    sentLog: database.sentLog || [],
    activities: (database.activities || []).slice(0, 400),
    settings: { search: { searchEngine: database.settings?.search?.searchEngine || 'google' } },
    agent: database.agent || { running: false },
    jobs: [],
    customerCount: (database.customers || []).length,
    updatedAt: new Date().toISOString(),
  };
  await db.collection('app_state').replaceOne({ _id: 'main' }, state, { upsert: true });
  return { ok: true };
}

export async function pushCloudDatabase(database, { customers = true, state = true } = {}) {
  if (!cloudDbReady()) return { ok: false, skipped: true, reason: 'MONGODB_URI is not set' };
  const db = await getCloudDb();
  await ensureCloudIndexes(db);
  const result = { ok: true, customers: 0 };
  if (customers) {
    const pushed = await upsertCustomers(database.customers || []);
    result.customers = pushed.count || 0;
    result.upserted = pushed.upserted;
    result.modified = pushed.modified;
  }
  if (state) await replaceAppState(database);
  result.count = await db.collection('customers').countDocuments();
  return result;
}

export async function pullCloudDatabase() {
  if (!cloudDbReady()) return { ok: false, skipped: true, reason: 'MONGODB_URI is not set' };
  const db = await getCloudDb();
  const customers = await db.collection('customers')
    .find({}, { projection: { _id: 0 } })
    .toArray();
  const state = await db.collection('app_state').findOne({ _id: 'main' }) || {};
  return {
    ok: true,
    database: {
      customers,
      threads: state.threads || {},
      aiPanel: state.aiPanel || {},
      sentLog: state.sentLog || [],
      activities: state.activities || [],
      settings: state.settings || { search: { searchEngine: 'google' } },
      agent: state.agent || { running: false },
      jobs: [],
    },
  };
}

function localCustomerCount() {
  try {
    if (!fs.existsSync(DB_PATH)) return 0;
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return Array.isArray(parsed.customers) ? parsed.customers.length : 0;
  } catch {
    return 0;
  }
}

export async function restoreCloudDatabaseToFile({ force = false } = {}) {
  if (!cloudDbReady()) return { ok: false, skipped: true, reason: 'MONGODB_URI is not set' };
  try {
    const remoteCount = await cloudCustomerCount();
    const localCount = localCustomerCount();
    if (!remoteCount) return { ok: true, empty: true, localCount, remoteCount: 0 };
    if (!force && localCount >= remoteCount) {
      return { ok: true, skipped: true, reason: 'local database is newer or equal', localCount, remoteCount };
    }
    const pulled = await pullCloudDatabase();
    const tmp = `${DB_PATH}.mongo.tmp`;
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(pulled.database));
    fs.renameSync(tmp, DB_PATH);
    console.log(`[data] restored ${pulled.database.customers.length} leads from MongoDB`);
    return { ok: true, restored: pulled.database.customers.length, localCount, remoteCount };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

let pushTimer = null;
let queuedCustomers = [];
let queuedState = null;
let pushChain = Promise.resolve();

export function scheduleCustomerPush(customers = []) {
  if (!cloudDbReady() || !customers.length) return;
  queuedCustomers.push(...customers);
  schedulePush();
}

export function scheduleStatePush(database) {
  if (!cloudDbReady() || !database) return;
  queuedState = database;
  schedulePush();
}

function schedulePush() {
  clearTimeout(pushTimer);
  const delay = Math.max(800, Number(process.env.MONGODB_SYNC_DEBOUNCE_MS || 2000));
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushChain = pushChain.then(flushQueuedPush).catch((error) => {
      console.error('[cloud-db] sync failed:', error.message);
    });
  }, delay);
  pushTimer.unref?.();
}

async function flushQueuedPush() {
  const customers = queuedCustomers;
  const state = queuedState;
  queuedCustomers = [];
  queuedState = null;
  if (customers.length) await upsertCustomers(customers);
  if (state) await replaceAppState(state);
}

export async function flushCloudSync() {
  clearTimeout(pushTimer);
  pushTimer = null;
  await pushChain;
  await flushQueuedPush();
}

export async function closeCloudDb() {
  await flushCloudSync();
  if (!clientPromise) return;
  try {
    const client = await clientPromise;
    await client.close();
  } catch {
    // ignore
  }
  clientPromise = null;
}

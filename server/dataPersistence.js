import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadDotEnv } from './loadEnv.js';

const require = createRequire(import.meta.url);

loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.join(__dirname, 'data');

export const DATA_DIR = path.resolve(process.env.DATA_DIR || defaultDataDir);
export const DB_PATH = path.resolve(process.env.DATA_FILE || path.join(DATA_DIR, 'db.json'));
export const BOOTSTRAP_PATH = path.resolve(
  process.env.DATA_BOOTSTRAP_FILE || path.join(DATA_DIR, 'public-rfq.snapshot.json.gz'),
);
export const SECRETS_PATH = path.resolve(process.env.DATA_SECRETS_FILE || path.join(DATA_DIR, 'secrets.json'));

export function normalizeOssRegion(raw) {
  const v = String(raw || '').trim();
  if (!v) return 'oss-cn-hangzhou';
  const host = v.replace(/^https?:\/\//, '');
  const fromHost = host.match(/oss-([a-z0-9-]+)\.aliyuncs\.com/i);
  if (fromHost) return `oss-${fromHost[1]}`;
  if (v.startsWith('oss-')) return v;
  return `oss-${v}`;
}

function objectStoreConfig() {
  const key = process.env.OSS_KEY || process.env.DATA_S3_KEY || 'outreach-ai/db.json.gz';
  const secretsKey = process.env.OSS_SECRETS_KEY || process.env.DATA_S3_SECRETS_KEY || 'outreach-ai/secrets.json';
  const metaKey = process.env.OSS_META_KEY || process.env.DATA_S3_META_KEY || 'outreach-ai/meta.json';

  const ossBucket = process.env.OSS_BUCKET || process.env.OSS_BUCKET_NAME || '';
  const ossId = process.env.OSS_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || '';
  const ossSecret = process.env.OSS_ACCESS_KEY_SECRET
    || process.env.OSS_ACCESS_KEY
    || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
    || '';
  if (ossBucket && ossId && ossSecret) {
    return {
      kind: 'oss',
      bucket: ossBucket,
      key,
      secretsKey,
      metaKey,
      region: normalizeOssRegion(process.env.OSS_REGION || process.env.OSS_ENDPOINT || ''),
      endpoint: String(process.env.OSS_ENDPOINT || '').replace(/^https?:\/\//, ''),
      accessKeyId: ossId,
      accessKeySecret: ossSecret,
    };
  }

  const bucket = process.env.DATA_S3_BUCKET || '';
  const accessKeyId = process.env.DATA_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.DATA_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
  if (bucket && accessKeyId && secretAccessKey) {
    return {
      kind: 's3',
      bucket,
      key,
      secretsKey,
      metaKey,
      region: process.env.DATA_S3_REGION || 'auto',
      endpoint: process.env.DATA_S3_ENDPOINT || '',
      accessKeyId,
      accessKeySecret: secretAccessKey,
    };
  }
  return null;
}

export function objectStoreStatus() {
  const cfg = objectStoreConfig();
  if (!cfg) return { ready: false, kind: '' };
  return {
    ready: true,
    kind: cfg.kind,
    bucket: cfg.bucket,
    key: cfg.key,
    region: cfg.region || '',
  };
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function parseDatabase(buffer, compressed = false) {
  const raw = compressed ? zlib.gunzipSync(buffer) : buffer;
  const value = JSON.parse(raw.toString('utf8'));
  if (!value || !Array.isArray(value.customers)) throw new Error('备份缺少 customers 数组');
  value.threads ||= {};
  value.aiPanel ||= {};
  value.sentLog ||= [];
  value.activities ||= [];
  return value;
}

export function loadLocalDatabase(fallback) {
  try {
    return parseDatabase(fs.readFileSync(DB_PATH));
  } catch (dbError) {
    try {
      const restored = parseDatabase(fs.readFileSync(BOOTSTRAP_PATH), true);
      ensureParent(DB_PATH);
      fs.writeFileSync(DB_PATH, JSON.stringify(restored));
      console.log(`[data] restored ${restored.customers.length} leads from repository snapshot`);
      return restored;
    } catch {
      if (fs.existsSync(DB_PATH)) console.error('[data] local database is unreadable:', dbError.message);
      return fallback;
    }
  }
}

export function remoteBackupReady() {
  return Boolean(objectStoreConfig());
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

function s3Client(cfg) {
  const options = {
    region: cfg.region || 'auto',
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.accessKeySecret,
    },
  };
  if (cfg.endpoint) {
    options.endpoint = cfg.endpoint.startsWith('http') ? cfg.endpoint : `https://${cfg.endpoint}`;
    options.forcePathStyle = true;
  }
  return new S3Client(options);
}

function ossClient(cfg) {
  const OSS = require('ali-oss');
  const options = {
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    timeout: 180_000,
  };
  if (cfg.endpoint) options.endpoint = cfg.endpoint;
  else options.region = cfg.region || 'oss-cn-hangzhou';
  return new OSS(options);
}

async function streamToBuffer(body) {
  if (typeof body?.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function storeGet(cfg, key) {
  if (cfg.kind === 'oss') {
    try {
      const result = await ossClient(cfg).get(key);
      return Buffer.from(result.content);
    } catch (error) {
      const code = String(error.code || error.name || error.status || '');
      if (error.status === 404 || /NoSuchKey|NotFound/i.test(code)) return null;
      throw error;
    }
  }
  try {
    const result = await s3Client(cfg).send(new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }));
    return streamToBuffer(result.Body);
  } catch (error) {
    const code = String(error.Code || error.name || error.$metadata?.httpStatusCode || '');
    if (/NoSuchKey|NotFound|404/.test(code)) return null;
    throw error;
  }
}

async function storePut(cfg, key, body, contentType) {
  if (cfg.kind === 'oss') {
    await ossClient(cfg).put(key, body, {
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
    });
    return;
  }
  await s3Client(cfg).send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  }));
}

function writeDatabaseFile(database) {
  ensureParent(DB_PATH);
  const tmp = `${DB_PATH}.remote.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(database));
  fs.renameSync(tmp, DB_PATH);
}

export async function restoreRemoteBackup({ force = false } = {}) {
  const cfg = objectStoreConfig();
  if (!cfg) return { ok: false, skipped: true, reason: 'OSS/S3 backup is not configured' };

  if (!fs.existsSync(SECRETS_PATH)) {
    try {
      const raw = await storeGet(cfg, cfg.secretsKey);
      if (raw) {
        ensureParent(SECRETS_PATH);
        fs.writeFileSync(SECRETS_PATH, raw);
      }
    } catch {
      // Secrets backup is optional.
    }
  }

  const localCount = localCustomerCount();
  let remoteCount = 0;
  try {
    const metaBuf = await storeGet(cfg, cfg.metaKey);
    if (metaBuf) remoteCount = Number(JSON.parse(metaBuf.toString('utf8')).customers) || 0;
  } catch {
    remoteCount = 0;
  }

  if (!force && localCount && remoteCount && localCount >= remoteCount) {
    return { ok: true, skipped: true, reason: 'local database is newer or equal', localCount, remoteCount, kind: cfg.kind };
  }

  const compressed = await storeGet(cfg, cfg.key);
  if (!compressed) return { ok: true, empty: true, localCount, remoteCount, kind: cfg.kind };

  const database = parseDatabase(compressed, true);
  remoteCount = database.customers.length;
  if (!force && localCount >= remoteCount) {
    return { ok: true, skipped: true, reason: 'local database is newer or equal', localCount, remoteCount, kind: cfg.kind };
  }

  writeDatabaseFile(database);
  console.log(`[data] restored ${remoteCount} leads from ${cfg.kind === 'oss' ? 'Aliyun OSS' : 'S3'}`);
  return { ok: true, restored: remoteCount, localCount, remoteCount, kind: cfg.kind };
}

export async function uploadRemoteBackup(file = DB_PATH) {
  const cfg = objectStoreConfig();
  if (!cfg) return { ok: false, skipped: true, reason: 'OSS/S3 backup is not configured' };
  if (!fs.existsSync(file)) throw new Error(`database not found: ${file}`);

  const database = JSON.parse(fs.readFileSync(file, 'utf8'));
  const compact = stripSecrets(database);
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(compact)), { level: zlib.constants.Z_BEST_SPEED });
  await storePut(cfg, cfg.key, body, 'application/gzip');
  await storePut(cfg, cfg.metaKey, Buffer.from(JSON.stringify({
    customers: compact.customers.length,
    bytes: body.length,
    kind: cfg.kind,
    updatedAt: new Date().toISOString(),
  })), 'application/json');
  if (fs.existsSync(SECRETS_PATH)) {
    await storePut(cfg, cfg.secretsKey, fs.readFileSync(SECRETS_PATH), 'application/json');
  }
  return {
    ok: true,
    kind: cfg.kind,
    bucket: cfg.bucket,
    key: cfg.key,
    customers: compact.customers.length,
    bytes: body.length,
  };
}

let backupTimer = null;
let backupPromise = Promise.resolve();

export function scheduleRemoteBackup(file = DB_PATH) {
  if (!remoteBackupReady()) return;
  clearTimeout(backupTimer);
  const delay = Math.max(5_000, Number(process.env.DATA_BACKUP_DEBOUNCE_MS || 60_000));
  backupTimer = setTimeout(() => {
    backupTimer = null;
    backupPromise = backupPromise
      .then(() => uploadRemoteBackup(file))
      .catch((error) => console.error('[data] remote backup failed:', error.message));
  }, delay);
  backupTimer.unref?.();
}

export async function flushRemoteBackup(file = DB_PATH) {
  clearTimeout(backupTimer);
  backupTimer = null;
  await backupPromise;
  if (remoteBackupReady() && fs.existsSync(file)) return uploadRemoteBackup(file);
  return { ok: false, skipped: true };
}

function compactResearch(research) {
  if (!research || typeof research !== 'object') return research || null;
  return {
    status: research.status || '',
    grade: research.grade || research.kyb?.grade || '',
    brief: research.brief || '',
    website: research.website || '',
    emails: Array.isArray(research.emails) ? research.emails.slice(0, 8) : [],
    phones: Array.isArray(research.phones) ? research.phones.slice(0, 6) : [],
    address: research.address || '',
    kyb: research.kyb || null,
    intel: research.intel || null,
    outreach: research.outreach || null,
    officers: Array.isArray(research.officers) ? research.officers.slice(0, 12) : [],
    socials: Array.isArray(research.socials) ? research.socials.slice(0, 8) : [],
  };
}

export function compactPublicCard(card) {
  if (!card || typeof card !== 'object') return null;
  return {
    rfqId: card.rfqId || '',
    subject: card.subject || '',
    buyerName: card.buyerName || '',
    country: card.country || card.countrySimple || '',
    quantity: card.quantity || '',
    quantityUnit: card.quantityUnit || '',
    openTimeStr: card.openTimeStr || '',
    postedAt: card.postedAt || '',
    url: card.url || '',
    imageUrl: card.imageUrl || '',
    description: String(card.description || '').slice(0, 800),
    categoryId: card.categoryId || '',
    categoryName: card.categoryName || '',
    haveAnnexes: Boolean(card.haveAnnexes),
  };
}

export function compactCustomer(customer) {
  const row = customer && typeof customer === 'object' ? customer : {};
  return {
    id: row.id,
    name: row.name || '',
    company: row.company || '',
    title: row.title || row.titleRole || '',
    email: row.email || '',
    country: row.country || '',
    timezone: row.timezone || '',
    industry: row.industry || '',
    painPoints: String(row.painPoints || '').slice(0, 1200),
    status: row.status || 'uncontacted',
    source: row.source || '',
    sourceType: row.sourceType || '',
    sourceUrl: row.sourceUrl || row.url || '',
    awardId: row.awardId || '',
    amount: row.amount || 0,
    postedAt: row.postedAt || '',
    postedDate: row.postedDate || '',
    categoryId: row.categoryId || '',
    categoryName: row.categoryName || '',
    imageUrl: row.imageUrl || '',
    haveAnnexes: Boolean(row.haveAnnexes),
    identitySource: row.identitySource || '',
    ingestedAt: row.ingestedAt || '',
    website: row.website || '',
    agentPhase: row.agentPhase || null,
    inOutreach: Boolean(row.inOutreach),
    lastActivity: row.lastActivity || '',
    researchPath: row.researchPath || '',
    buyerAlias: row.buyerAlias || '',
    publicCard: compactPublicCard(row.publicCard),
    research: compactResearch(row.research),
  };
}

function stripSecrets(database) {
  return {
    customers: (database.customers || []).map(compactCustomer),
    threads: {},
    aiPanel: {},
    sentLog: [],
    activities: [],
    settings: { search: { searchEngine: database.settings?.search?.searchEngine || 'google' } },
    agent: { running: false },
    jobs: [],
  };
}

export function loadSecrets() {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function saveSecrets(values = {}) {
  const current = loadSecrets();
  const next = { ...current };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === null || value === '') delete next[key];
    else next[key] = value;
  }
  ensureParent(SECRETS_PATH);
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function writeRepositorySnapshot(database, output = BOOTSTRAP_PATH) {
  const snapshot = stripSecrets(database);
  ensureParent(output);
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 9 });
  fs.writeFileSync(output, body);
  return { customers: snapshot.customers.length, bytes: body.length, output };
}

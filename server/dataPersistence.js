import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadDotEnv } from './loadEnv.js';

loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.join(__dirname, 'data');

export const DATA_DIR = path.resolve(process.env.DATA_DIR || defaultDataDir);
export const DB_PATH = path.resolve(process.env.DATA_FILE || path.join(DATA_DIR, 'db.json'));
export const BOOTSTRAP_PATH = path.resolve(
  process.env.DATA_BOOTSTRAP_FILE || path.join(DATA_DIR, 'public-rfq.snapshot.json.gz'),
);
export const SECRETS_PATH = path.resolve(process.env.DATA_SECRETS_FILE || path.join(DATA_DIR, 'secrets.json'));

function remoteConfig() {
  return {
    bucket: process.env.DATA_S3_BUCKET || '',
    key: process.env.DATA_S3_KEY || 'outreach-ai/db.json.gz',
    secretsKey: process.env.DATA_S3_SECRETS_KEY || 'outreach-ai/secrets.json',
    region: process.env.DATA_S3_REGION || 'auto',
    endpoint: process.env.DATA_S3_ENDPOINT || '',
    accessKeyId: process.env.DATA_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.DATA_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
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
  const remote = remoteConfig();
  return Boolean(remote.bucket && remote.accessKeyId && remote.secretAccessKey);
}

function s3Client() {
  const remote = remoteConfig();
  const options = {
    region: remote.region,
    credentials: {
      accessKeyId: remote.accessKeyId,
      secretAccessKey: remote.secretAccessKey,
    },
  };
  if (remote.endpoint) {
    options.endpoint = remote.endpoint;
    options.forcePathStyle = true;
  }
  return new S3Client(options);
}

async function streamToBuffer(body) {
  if (typeof body?.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function restoreRemoteBackup({ force = false } = {}) {
  if (!remoteBackupReady()) return { ok: false, skipped: true, reason: 'S3 backup is not configured' };
  const remote = remoteConfig();
  const client = s3Client();
  if (!fs.existsSync(SECRETS_PATH)) {
    try {
      const secretsObj = await client.send(new GetObjectCommand({
        Bucket: remote.bucket,
        Key: remote.secretsKey,
      }));
      const raw = await streamToBuffer(secretsObj.Body);
      ensureParent(SECRETS_PATH);
      fs.writeFileSync(SECRETS_PATH, raw);
    } catch {
      // Secrets backup is optional.
    }
  }
  if (!force && fs.existsSync(DB_PATH)) {
    return { ok: true, skipped: true, reason: 'local database already exists' };
  }
  const result = await client.send(new GetObjectCommand({
    Bucket: remote.bucket,
    Key: remote.key,
  }));
  const compressed = await streamToBuffer(result.Body);
  const database = parseDatabase(compressed, true);
  ensureParent(DB_PATH);
  const tmp = `${DB_PATH}.remote.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(database));
  fs.renameSync(tmp, DB_PATH);
  return { ok: true, restored: database.customers.length };
}

export async function uploadRemoteBackup(file = DB_PATH) {
  if (!remoteBackupReady()) return { ok: false, skipped: true, reason: 'S3 backup is not configured' };
  const remote = remoteConfig();
  const client = s3Client();
  const body = zlib.gzipSync(fs.readFileSync(file), { level: zlib.constants.Z_BEST_SPEED });
  await client.send(new PutObjectCommand({
    Bucket: remote.bucket,
    Key: remote.key,
    Body: body,
    ContentType: 'application/json',
    ContentEncoding: 'gzip',
    Metadata: { updatedAt: new Date().toISOString() },
  }));
  if (fs.existsSync(SECRETS_PATH)) {
    await client.send(new PutObjectCommand({
      Bucket: remote.bucket,
      Key: remote.secretsKey,
      Body: fs.readFileSync(SECRETS_PATH),
      ContentType: 'application/json',
    }));
  }
  return { ok: true, bytes: body.length };
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

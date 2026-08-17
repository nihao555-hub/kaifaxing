import fs from 'node:fs';
import {
  BOOTSTRAP_PATH,
  DB_PATH,
  objectStoreStatus,
  remoteBackupReady,
  uploadRemoteBackup,
  writeRepositorySnapshot,
} from './dataPersistence.js';
import {
  cloudDbReady,
  cloudDbStatus,
  flushCloudSync,
  pushCloudDatabase,
} from './cloudDb.js';
import { hydrateDurableDatabase } from './hydrate.js';

const DEFAULT_RECRAWL_SOURCES = ['usaspending', 'uk', 'ted', 'worldbank'];

const command = process.argv[2] || 'status';
const flags = new Set(process.argv.slice(3).filter((value) => value.startsWith('--')));
const args = process.argv.slice(3).filter((value) => !value.startsWith('--'));

async function main() {
  if (command === 'restore') {
    const result = await hydrateDurableDatabase();
    console.log(`[data] restore: ${JSON.stringify(result)}`);
    return;
  }

  if (command === 'promote') {
    const { db, saveNow } = await import('./store.js');
    const { applyTextCompanyHints, kybPlanStats } = await import('./pipeline.js');
    const promoted = applyTextCompanyHints();
    saveNow();
    const plan = kybPlanStats({ force: true });
    console.log(`[data] promote: ${JSON.stringify({ promoted, local: db.customers.length, plan })}`);
    return;
  }

  if (command === 'kyb') {
    const { db, saveNow, isRfqLead } = await import('./store.js');
    const { applyTextCompanyHints, kybPlanStats, researchPriority } = await import('./pipeline.js');
    const { researchLead, isPersonLikeLead } = await import('./research.js');
    applyTextCompanyHints();
    const limitFlag = args.find((a) => /^\d+$/.test(a));
    const limit = Math.min(Math.max(Number(limitFlag || process.env.KYB_LIMIT || 80), 1), 2000);
    const wantCrosspost = flags.has('--crosspost');
    const pending = db.customers.filter((c) => {
      if (!isRfqLead(c)) return false;
      if (c.research?.status === 'done' || c.research?.status === 'running') return false;
      if (/World Bank/i.test(c.source || '')) return false;
      if (c.researchPath === 'auto') return true;
      if (c.researchPath === 'clues') return true;
      if (wantCrosspost && c.researchPath === 'crosspost') return true;
      if (!c.researchPath && !isPersonLikeLead(c)) return true;
      return false;
    });
    pending.sort((a, b) => researchPriority(a) - researchPriority(b));
    const batch = pending.slice(0, limit);
    const summary = { tried: 0, ok: 0, failed: 0, gradeA: 0, gradeB: 0, gradeC: 0, emails: 0, websites: 0 };
    const started = Date.now();
    for (const c of batch) {
      summary.tried += 1;
      try {
        const report = await researchLead(c, { useAi: false });
        c.research = report;
        if (report.website && !c.website) c.website = report.website;
        summary.ok += 1;
        if (report.kyb?.grade === 'A') summary.gradeA += 1;
        else if (report.kyb?.grade === 'B') summary.gradeB += 1;
        else summary.gradeC += 1;
        if (report.emails?.length) summary.emails += 1;
        if (report.website) summary.websites += 1;
        console.log(`[kyb] ${summary.tried}/${batch.length} ${report.kyb?.grade || '?'} ${c.company} emails=${report.emails?.length || 0} site=${report.website || '-'}`);
      } catch (err) {
        summary.failed += 1;
        c.research = { status: 'failed', error: String(err.message || err), updatedAt: new Date().toISOString() };
        console.log(`[kyb] ${summary.tried}/${batch.length} FAIL ${c.company}: ${err.message || err}`);
      }
      if (summary.tried % 5 === 0) saveNow();
    }
    saveNow();
    summary.ms = Date.now() - started;
    summary.pendingLeft = pending.length - batch.length;
    summary.plan = kybPlanStats({ force: true });
    console.log(`[data] kyb: ${JSON.stringify(summary)}`);
    return;
  }

  if (command === 'backup') {
    if (!fs.existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);
    const result = await uploadRemoteBackup();
    console.log(`[data] remote backup: ${JSON.stringify(result)}`);
    return;
  }

  if (command === 'snapshot') {
    if (!fs.existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);
    const database = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const result = writeRepositorySnapshot(database);
    console.log(`[data] repository snapshot: ${JSON.stringify(result)}`);
    return;
  }

  if (command === 'push') {
    const { db } = await import('./store.js');
    const result = await pushCloudDatabase(db);
    console.log(`[data] mongodb push: ${JSON.stringify(result)}`);
    return;
  }

  if (command === 'pull') {
    const { restoreCloudDatabaseToFile } = await import('./cloudDb.js');
    const result = await restoreCloudDatabaseToFile({ force: true });
    console.log(`[data] mongodb pull: ${JSON.stringify(result)}`);
    return;
  }

  if (command === 'recrawl') {
    const full = flags.has('--full');
    const { crawlAllAndImport, PUBLIC_SINCE_DEFAULT } = await import('./rfq.js');
    const { db, saveNow } = await import('./store.js');
    const sources = args.length ? args : (full ? ['alibaba_public', ...DEFAULT_RECRAWL_SOURCES] : DEFAULT_RECRAWL_SOURCES);
    const result = await crawlAllAndImport({
      sources,
      since: full ? 'all' : PUBLIC_SINCE_DEFAULT,
      govLimit: Number(process.env.SNAPSHOT_GOV_LIMIT || (full ? 80 : 80)),
      alibabaPages: Number(process.env.SNAPSHOT_ALIBABA_PAGES || (full ? 100 : 2)),
      fanout: full,
      doImport: true,
    });
    saveNow();
    let snapshot = null;
    if (!full) snapshot = writeRepositorySnapshot(db);
    let object = null;
    if (remoteBackupReady()) {
      object = await uploadRemoteBackup();
    }
    let cloud = null;
    if (cloudDbReady()) {
      cloud = await pushCloudDatabase(db);
      await flushCloudSync();
    }
    console.log(`[data] recrawl: ${JSON.stringify({
      created: result.createdCount,
      local: db.customers.length,
      reports: result.reports,
      snapshot,
      object,
      cloud,
    })}`);
    return;
  }

  const cloud = await cloudDbStatus();
  const object = objectStoreStatus();
  let localCount = 0;
  if (fs.existsSync(DB_PATH)) {
    localCount = (JSON.parse(fs.readFileSync(DB_PATH, 'utf8')).customers || []).length;
  }
  console.log(JSON.stringify({
    database: DB_PATH,
    databaseExists: fs.existsSync(DB_PATH),
    localCount,
    repositorySnapshot: BOOTSTRAP_PATH,
    repositorySnapshotExists: fs.existsSync(BOOTSTRAP_PATH),
    object,
    remoteReady: remoteBackupReady(),
    cloud,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[data] ${command} failed:`, error);
  process.exitCode = 1;
});

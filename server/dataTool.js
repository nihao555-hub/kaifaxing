import fs from 'node:fs';
import {
  BOOTSTRAP_PATH,
  DB_PATH,
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
      cloud,
    })}`);
    return;
  }

  const cloud = await cloudDbStatus();
  console.log(JSON.stringify({
    database: DB_PATH,
    databaseExists: fs.existsSync(DB_PATH),
    localCount: fs.existsSync(DB_PATH)
      ? (JSON.parse(fs.readFileSync(DB_PATH, 'utf8')).customers || []).length
      : 0,
    repositorySnapshot: BOOTSTRAP_PATH,
    repositorySnapshotExists: fs.existsSync(BOOTSTRAP_PATH),
    remoteReady: remoteBackupReady(),
    cloud,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[data] ${command} failed:`, error);
  process.exitCode = 1;
});

import fs from 'node:fs';
import {
  BOOTSTRAP_PATH,
  DB_PATH,
  remoteBackupReady,
  restoreRemoteBackup,
  uploadRemoteBackup,
  writeRepositorySnapshot,
} from './dataPersistence.js';

const DEFAULT_RECRAWL_SOURCES = ['usaspending', 'uk', 'ted', 'worldbank'];

const command = process.argv[2] || 'status';

async function main() {
  if (command === 'restore') {
    if (fs.existsSync(DB_PATH)) {
      console.log(`[data] using local database: ${DB_PATH}`);
      return;
    }
    if (remoteBackupReady()) {
      try {
        const result = await restoreRemoteBackup();
        console.log(`[data] remote restore: ${JSON.stringify(result)}`);
        return;
      } catch (error) {
        console.warn(`[data] remote restore failed, trying repository snapshot: ${error.message}`);
      }
    }
    if (fs.existsSync(BOOTSTRAP_PATH)) {
      const { loadLocalDatabase } = await import('./dataPersistence.js');
      const restored = loadLocalDatabase({ customers: [], threads: {}, aiPanel: {}, sentLog: [], activities: [] });
      console.log(`[data] repository restore: ${restored.customers.length} leads`);
      return;
    }
    console.log('[data] no backup found; server will initialize an empty database');
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

  if (command === 'recrawl') {
    const { crawlAllAndImport } = await import('./rfq.js');
    const { db, saveNow } = await import('./store.js');
    const sources = process.argv.slice(3).filter((value) => !value.startsWith('--'));
    const result = await crawlAllAndImport({
      sources: sources.length ? sources : DEFAULT_RECRAWL_SOURCES,
      govLimit: Number(process.env.SNAPSHOT_GOV_LIMIT || 80),
      alibabaPages: Number(process.env.SNAPSHOT_ALIBABA_PAGES || 2),
      fanout: false,
      doImport: true,
    });
    saveNow();
    const snapshot = writeRepositorySnapshot(db);
    console.log(`[data] recrawl: ${JSON.stringify({
      created: result.createdCount,
      reports: result.reports,
      snapshot,
    })}`);
    return;
  }

  console.log(JSON.stringify({
    database: DB_PATH,
    databaseExists: fs.existsSync(DB_PATH),
    repositorySnapshot: BOOTSTRAP_PATH,
    repositorySnapshotExists: fs.existsSync(BOOTSTRAP_PATH),
    remoteReady: remoteBackupReady(),
  }, null, 2));
}

main().catch((error) => {
  console.error(`[data] ${command} failed:`, error);
  process.exitCode = 1;
});

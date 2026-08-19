import fs from 'node:fs';
import { restoreCloudDatabaseToFile } from './cloudDb.js';
import {
  BOOTSTRAP_PATH,
  DB_PATH,
  loadLocalDatabase,
  restoreRemoteBackup,
} from './dataPersistence.js';

export async function hydrateDurableDatabase() {
  try {
    const objectStore = await restoreRemoteBackup();
    if (objectStore.restored) {
      return { source: objectStore.kind || 'oss', ...objectStore };
    }
  } catch (error) {
    console.warn(`[data] OSS/S3 restore failed: ${error.message}`);
  }

  const cloud = await restoreCloudDatabaseToFile();
  if (cloud.restored) return { source: 'mongodb', ...cloud };
  if (cloud.error) console.warn(`[data] MongoDB restore failed: ${cloud.error}`);

  if (!fs.existsSync(DB_PATH) && fs.existsSync(BOOTSTRAP_PATH)) {
    const restored = loadLocalDatabase({
      customers: [],
      threads: {},
      aiPanel: {},
      sentLog: [],
      activities: [],
    });
    return { source: 'snapshot', restored: restored.customers.length };
  }

  return {
    source: fs.existsSync(DB_PATH) ? 'local' : 'empty',
    skipped: true,
  };
}

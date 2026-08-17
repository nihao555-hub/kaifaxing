import { loadDotEnv } from './loadEnv.js';
import { restoreRemoteBackup } from './dataPersistence.js';

loadDotEnv();

try {
  const result = await restoreRemoteBackup();
  if (result.restored) console.log(`[data] restored ${result.restored} records from remote backup`);
} catch (error) {
  console.warn(`[data] remote restore unavailable: ${error.message}`);
}

await import('./index.js');

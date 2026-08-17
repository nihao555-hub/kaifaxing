import { loadDotEnv } from './loadEnv.js';
import { hydrateDurableDatabase } from './hydrate.js';

loadDotEnv();

try {
  const result = await hydrateDurableDatabase();
  if (result.restored) {
    console.log(`[data] restored ${result.restored} records from ${result.source}`);
  } else if (result.source) {
    console.log(`[data] hydrate source: ${result.source}`);
  }
} catch (error) {
  console.warn(`[data] durable restore unavailable: ${error.message}`);
}

await import('./index.js');

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

  if (command === 'playbook') {
    const { startBestPass, getPipelineState } = await import('./pipeline.js');
    const limit = Math.min(Math.max(Number(args[0] || 400), 1), 2000);
    const result = startBestPass({ limit, wait: true });
    console.log(`[data] playbook: ${JSON.stringify({ ...result, pipeline: getPipelineState() })}`);
    return;
  }

  if (command === 'yp' || command === 'yellowpages') {
    const { db, saveNow, isRfqLead, isDemoCustomer } = await import('./store.js');
    const { applyTextCompanyHints } = await import('./pipeline.js');
    const { isPersonLikeLead } = await import('./research.js');
    const { lookupYellowPages, directoryTld } = await import('./yellowPages.js');
    applyTextCompanyHints();
    const limit = Math.min(Math.max(Number(args[0] || 12), 1), 40);
    const junkName = /^(abc|acme|test|demo|sample|foo|bar)\b/i;
    const pending = db.customers.filter((c) => {
      if (!isRfqLead(c)) return false;
      if (isDemoCustomer(c)) return false;
      if (c.email) return false;
      if (!directoryTld(c.country)) return false;
      if (isPersonLikeLead(c) && !c.forceCompany) return false;
      const name = String(c.company || c.name || '').trim();
      if (name.length < 10 || junkName.test(name)) return false;
      return true;
    });
    pending.sort((a, b) => {
      const geo = (c) => {
        const tld = directoryTld(c.country);
        if (tld === 'de') return 0;
        if (tld === 'fi' || tld === 'fr' || tld === 'uk' || tld === 'at' || tld === 'ch') return 1;
        return 2;
      };
      if (geo(a) !== geo(b)) return geo(a) - geo(b);
      const gov = (c) => (/TED|Contracts Finder/i.test(c.source || '') ? 0 : 1);
      if (gov(a) !== gov(b)) return gov(a) - gov(b);
      return String(b.company || '').length - String(a.company || '').length;
    });
    const batch = pending.slice(0, limit);
    const summary = { tried: 0, phones: 0, emails: 0, websites: 0, addresses: 0 };
    const rows = [];
    for (const c of batch) {
      summary.tried += 1;
      const hit = await lookupYellowPages(c.company || c.name, c.country);
      if (hit.phones.length) summary.phones += 1;
      if (hit.emails.length) summary.emails += 1;
      if (hit.website) summary.websites += 1;
      if (hit.address) summary.addresses += 1;
      if (hit.website && !c.website) c.website = hit.website;
      c.research = {
        ...(c.research || {}),
        yellowPages: hit,
        updatedAt: new Date().toISOString(),
      };
      if (hit.phones.length) {
        c.research.phones = [...new Set([...(c.research.phones || []), ...hit.phones])].slice(0, 8);
      }
      if (hit.emails.length) {
        const extra = hit.emails.map((email) => ({ email, role: email.split('@')[0], source: hit.source || '黄页' }));
        const seen = new Set((c.research.emails || []).map((e) => e.email));
        c.research.emails = [...(c.research.emails || []), ...extra.filter((e) => !seen.has(e.email))].slice(0, 8);
      }
      rows.push({
        company: c.company,
        country: c.country,
        source: hit.source || '-',
        phones: hit.phones,
        emails: hit.emails,
        website: hit.website || '',
        address: hit.address || '',
      });
      console.log(`[yp] ${summary.tried}/${batch.length} ${c.company} tel=${hit.phones[0] || '-'} mail=${hit.emails[0] || '-'} site=${hit.website || '-'} src=${hit.source || '-'}`);
      if (summary.tried % 4 === 0) saveNow({ remote: false });
    }
    saveNow({ remote: false });
    const out = new URL('./data/yellowpages-round.json', import.meta.url);
    fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
    console.log(`[data] yp: ${JSON.stringify({ ...summary, file: out.pathname })}`);
    return;
  }

  if (command === 'kyb') {
    const { db, saveNow, isRfqLead } = await import('./store.js');
    const { applyTextCompanyHints, kybPlanStats, researchPriority } = await import('./pipeline.js');
    const { researchLead, isPersonLikeLead } = await import('./research.js');
    const { bestNext } = await import('./playbook.js');
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
        const report = await researchLead(c, { useAi: false, inferEmail: true });
        c.research = report;
        if (report.website && !c.website) c.website = report.website;
        summary.ok += 1;
        if (report.kyb?.grade === 'A') summary.gradeA += 1;
        else if (report.kyb?.grade === 'B') summary.gradeB += 1;
        else summary.gradeC += 1;
        if (report.emails?.length) summary.emails += 1;
        if (report.website) summary.websites += 1;
        const next = bestNext(c);
        const mail = (report.emails || []).map((e) => e.email).slice(0, 2).join(',') || '-';
        console.log(`[kyb] ${summary.tried}/${batch.length} ${report.kyb?.grade || '?'} ${c.company} emails=${report.emails?.length || 0} ${mail} site=${report.website || '-'} next=${next.key}`);
      } catch (err) {
        summary.failed += 1;
        c.research = { status: 'failed', error: String(err.message || err), updatedAt: new Date().toISOString() };
        console.log(`[kyb] ${summary.tried}/${batch.length} FAIL ${c.company}: ${err.message || err}`);
      }
      if (summary.tried % 5 === 0) saveNow({ remote: false });
    }
    saveNow({ remote: false });
    summary.ms = Date.now() - started;
    summary.pendingLeft = pending.length - batch.length;
    summary.plan = kybPlanStats({ force: true });
    console.log(`[data] kyb: ${JSON.stringify(summary)}`);
    return;
  }

  if (command === 'guess-sample') {
    const { db } = await import('./store.js');
    const { runGuessSample } = await import('./guessSample.js');
    const size = Math.min(Math.max(Number(args[0] || 10000), 1), 20000);
    const smtpLimit = Math.min(Math.max(Number(process.env.GUESS_SMTP_LIMIT || 20), 0), 100);
    const started = Date.now();
    const report = await runGuessSample(db.customers, { size, smtpLimit });
    report.ms = Date.now() - started;
    report.pool = db.customers.length;
    const out = new URL('./data/guess-sample-report.json', import.meta.url);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`[data] guess-sample: ${JSON.stringify({ file: out.pathname, ...report.counts, ms: report.ms })}`);
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

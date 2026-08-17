import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { remoteBackupReady, writeRepositorySnapshot } from './dataPersistence.js';

describe('repository snapshot', () => {
  it('writes gzip JSON without drafts or search secrets', () => {
    const output = path.join(os.tmpdir(), `public-rfq.snapshot.${process.pid}.json.gz`);
    const result = writeRepositorySnapshot({
      customers: [{
        id: 'rfq1',
        name: 'Acme',
        company: 'Acme Ltd',
        email: 'procurement@acme.example',
        source: 'USASpending.gov',
        sourceUrl: 'https://example.com/award/1',
        research: { status: 'done', grade: 'A', brief: 'verified', emails: ['procurement@acme.example'] },
      }],
      threads: { rfq1: [{ body: 'draft that must not ship' }] },
      aiPanel: { rfq1: { email: 'secret draft' } },
      sentLog: [{ customerId: 'rfq1' }],
      activities: [{ action: 'sent' }],
      settings: { search: { apiKey: 'AIza-secret', cseId: 'cx-secret', searchEngine: 'google' } },
      agent: { running: true },
      jobs: [{ id: 'job1' }],
    }, output);

    try {
      assert.equal(result.customers, 1);
      assert.ok(result.bytes > 0);
      const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(output)).toString('utf8'));
      assert.equal(parsed.customers[0].company, 'Acme Ltd');
      assert.equal(parsed.customers[0].sourceUrl, 'https://example.com/award/1');
      assert.equal(parsed.customers[0].research.grade, 'A');
      assert.deepEqual(parsed.threads, {});
      assert.deepEqual(parsed.aiPanel, {});
      assert.deepEqual(parsed.sentLog, []);
      assert.deepEqual(parsed.activities, []);
      assert.deepEqual(parsed.jobs, []);
      assert.equal(parsed.agent.running, false);
      assert.equal(parsed.settings.search.searchEngine, 'google');
      assert.equal(parsed.settings.search.apiKey, undefined);
      assert.equal(parsed.settings.search.cseId, undefined);
      const raw = fs.readFileSync(output);
      assert.equal(raw.includes('AIza-secret'), false);
    } finally {
      fs.rmSync(output, { force: true });
    }
  });

  it('does not treat S3 as ready without credentials', () => {
    assert.equal(remoteBackupReady(), Boolean(
      process.env.DATA_S3_BUCKET
      && (process.env.DATA_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)
      && (process.env.DATA_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY),
    ));
  });
});

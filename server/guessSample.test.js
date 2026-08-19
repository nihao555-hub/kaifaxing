import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  strideSample,
  classifyGuessLead,
  reachabilityOf,
  roleCandidatesFor,
  runGuessSample,
} from './guessSample.js';

describe('guess sample funnel', () => {
  it('takes an even stride and refuses gmail domains', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    assert.deepEqual(strideSample(items, 5), [0, 2, 4, 6, 8]);
    const glued = classifyGuessLead({
      name: 'Kutumb Ecommerceprivatelimited',
      buyerAlias: 'Kutumb Ecommerceprivatelimited',
      country: 'India',
      painPoints: 'Need solar panels',
    });
    assert.equal(glued.glued, 'Kutumb Ecommerce Private Limited');
    assert.equal(glued.domain, '');
    const gmail = classifyGuessLead({
      name: 'Linda N',
      website: 'https://gmail.com',
      email: 'linda@gmail.com',
    });
    assert.equal(gmail.domain, '');
    assert.equal(gmail.personalExisting, true);
    assert.equal(gmail.existingEmail, '');
  });

  it('maps Reacher-style reachability and only builds role@company', () => {
    assert.equal(reachabilityOf({ hasMx: true, role: true, smtp: 'accepted' }), 'safe');
    assert.equal(reachabilityOf({ hasMx: true, smtp: 'catch_all' }), 'risky');
    assert.equal(reachabilityOf({ free: true, hasMx: true }), 'invalid');
    assert.deepEqual(roleCandidatesFor({ domain: 'acme.example' }).every((e) => e.endsWith('@acme.example')), true);
    assert.ok(roleCandidatesFor({ domain: 'acme.example' }).some((e) => e.startsWith('info@')));
    assert.deepEqual(roleCandidatesFor({ domain: '' }), []);
  });

  it('runs a tiny sample with mocked MX/SMTP', async () => {
    const report = await runGuessSample([
      { name: 'Linda N', country: 'NL', source: '阿里国际站公开 RFQ' },
      {
        name: 'Kutumb Ecommerceprivatelimited',
        buyerAlias: 'Kutumb Ecommerceprivatelimited',
        country: 'India',
        website: 'https://kutumb.example',
        painPoints: 'looking for solar',
      },
    ], {
      size: 2,
      smtpLimit: 2,
      lookup: async (domain) => (domain === 'kutumb.example' ? [{ exchange: 'mx.kutumb.example', priority: 10 }] : []),
      verify: async (emails) => ({
        catchAll: false,
        mx: 'mx.kutumb.example',
        results: emails.map((email) => ({ email, status: 'accepted' })),
      }),
    });
    assert.equal(report.counts.sample, 2);
    assert.equal(report.counts.gluedCompany, 1);
    assert.equal(report.counts.hasDomain, 1);
    assert.equal(report.counts.mxYes, 1);
    assert.equal(report.counts.smtpAccepted, 1);
    assert.equal(report.tool.name, 'check-if-email-exists');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mailDomainFromWebsite,
  heuristicRoleLocals,
  filterRankedLocals,
  buildRoleCandidates,
  rankRoleLocals,
  inferAndVerifyEmails,
} from './inferEmail.js';

describe('infer role mailboxes', () => {
  it('uses the company registrable domain and refuses personal inboxes', () => {
    assert.equal(mailDomainFromWebsite('https://www.nmguae.com/contact'), 'nmguae.com');
    assert.equal(mailDomainFromWebsite('https://gmail.com'), '');
    assert.equal(mailDomainFromWebsite('https://mail.yahoo.com'), '');
    assert.deepEqual(buildRoleCandidates('https://www.nmguae.com', ['info', 'procurement', 'ajay.vaishnavi', 'gmail']), [
      'info@nmguae.com',
      'procurement@nmguae.com',
    ]);
  });

  it('prefers procurement locals on RFQ copy', () => {
    const locals = heuristicRoleLocals({ painPoints: 'Need a quote for 500 drills', product: 'Cordless drill' });
    assert.equal(locals[0], 'procurement');
    assert.deepEqual(filterRankedLocals(['first.last', 'gmail', 'procurement', 'info'], ['sales']), [
      'procurement',
      'info',
      'sales',
    ]);
  });

  it('keeps only allow-listed locals from the model', async () => {
    const locals = await rankRoleLocals(
      { product: 'O-rings', country: 'Germany' },
      {
        chatFn: async () => '{"locals":["procurement","info","ajay.vaishnavi","gmail"]}',
      },
    );
    assert.deepEqual(locals, ['procurement', 'info']);
  });

  it('returns SMTP-accepted role mail and ignores catch-all / gmail', async () => {
    const hit = await inferAndVerifyEmails({
      website: 'https://acme.example',
      company: 'Acme Ltd',
      customer: { painPoints: 'looking for silicone o-rings' },
      knownEmails: [],
      chatFn: async () => '{"locals":["info","procurement"]}',
      verify: async (emails) => ({
        catchAll: false,
        mx: 'mx.acme.example',
        results: emails.map((email) => ({
          email,
          status: email.startsWith('info@') ? 'accepted' : 'rejected',
        })),
      }),
    });
    assert.deepEqual(hit.accepted.map((e) => e.email), ['info@acme.example']);
    assert.equal(hit.accepted[0].source, 'inferred_smtp');
    assert.match(hit.notes[0], /SMTP/);

    const personal = await inferAndVerifyEmails({
      website: 'https://gmail.com',
      company: 'Linda N',
      customer: { name: 'Linda N' },
    });
    assert.equal(personal.domain, '');
    assert.deepEqual(personal.accepted, []);
    assert.match(personal.notes[0], /Gmail/);
  });
});

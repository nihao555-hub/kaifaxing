import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contactGap, leadHasWebsite, leadHasRoleEmail, summarizeContactLine } from './contactLine.js';

describe('contact line gaps', () => {
  it('sends legal names to the site/phone wave before email', () => {
    assert.equal(contactGap({
      source: 'TED Europa',
      company: 'HOWOGE Wohnungsbaugesellschaft mbH',
      forceCompany: true,
    }), 'site');
    assert.equal(contactGap({
      source: 'TED Europa',
      company: 'LMBV',
      forceCompany: true,
      website: 'https://www.lmbv.de',
    }), 'email');
    assert.equal(contactGap({
      source: 'TED Europa',
      company: 'LMBV',
      forceCompany: true,
      website: 'https://www.lmbv.de',
      research: { emails: [{ email: 'info@lmbv.de', role: 'info' }] },
    }), 'done');
  });

  it('does not re-queue a finished site miss, and parks nicknames on seller/identity', () => {
    assert.equal(contactGap({
      source: 'TED Europa',
      company: 'Unknown GmbH',
      forceCompany: true,
      research: { status: 'done', contactStage: 'need-site' },
    }), 'stuck');
    assert.equal(contactGap({
      source: '阿里国际站公开 RFQ',
      company: 'Linda N',
      name: 'Linda N',
    }), 'seller');
    assert.equal(contactGap({
      source: '阿里国际站公开 RFQ',
      company: 'Abdi Muse',
      researchPath: 'crosspost',
      painPoints: 'Need SKU ABC-12345 replacement',
    }), 'crosspost');
  });

  it('counts website and role mail helpers', () => {
    assert.equal(leadHasWebsite({ website: 'https://nmguae.com' }), true);
    assert.equal(leadHasRoleEmail({ research: { emails: [{ email: 'info@nmguae.com', role: 'info' }] } }), true);
    assert.equal(leadHasRoleEmail({ email: 'linda.n@gmail.com' }), false);
    const plan = summarizeContactLine([
      { source: 'TED', company: 'HOWOGE Wohnungsbaugesellschaft mbH', forceCompany: true },
      { source: 'TED', company: 'LMBV', forceCompany: true, website: 'https://www.lmbv.de' },
      { source: '阿里国际站公开 RFQ', company: 'Linda N', name: 'Linda N' },
    ]);
    assert.equal(plan.site, 1);
    assert.equal(plan.email, 1);
    assert.equal(plan.seller, 1);
    assert.equal(plan.runnable, 2);
  });
});

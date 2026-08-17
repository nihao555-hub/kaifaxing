import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerClusterKey,
  applySellerExportToLead,
  findAlibabaMatch,
  mergeAlibabaSellerExport,
  propagateAlibabaIdentity,
  buildAlibabaDossier,
  summarizeAlibabaPlan,
  peopleSearchLinks,
} from './alibabaIntel.js';

describe('alibaba seller unlock', () => {
  it('matches a public card by rfq id and writes company + email', () => {
    const card = {
      id: 'rfq1',
      source: '阿里国际站公开 RFQ',
      awardId: '1684056292',
      company: 'Wilfried',
      name: 'Wilfried',
      country: 'Burkina Faso',
      publicCard: { rfqId: '1684056292', buyerName: 'Wilfried', subject: '20v Cordless Drill' },
    };
    const { updated, touched } = mergeAlibabaSellerExport([card], [{
      buyer_company_name: 'Sahel Tools Ltd',
      buyer_name: 'Wilfried',
      buyer_email: 'buy@sahel.example',
      rfq_id: '1684056292',
    }]);
    assert.equal(updated, 1);
    assert.equal(touched[0].company, 'Sahel Tools Ltd');
    assert.equal(touched[0].email, 'buy@sahel.example');
    assert.equal(touched[0].contactSource, 'alibaba_seller');
    assert.equal(touched[0].forceCompany, true);
  });

  it('propagates a legal name to other RFQs from the same nickname', () => {
    const a = {
      source: '阿里国际站公开 RFQ',
      company: 'Sahel Tools Ltd',
      name: 'Wilfried',
      buyerAlias: 'Wilfried',
      country: 'Burkina Faso',
      forceCompany: true,
      identitySource: 'alibaba_seller',
      publicCard: { buyerName: 'Wilfried' },
    };
    const b = {
      source: '阿里国际站公开 RFQ',
      company: 'Wilfried',
      name: 'Wilfried',
      country: 'Burkina Faso',
      publicCard: { buyerName: 'Wilfried', subject: 'Angle grinder' },
    };
    const { propagated } = propagateAlibabaIdentity([a, b]);
    assert.equal(propagated, 1);
    assert.equal(b.company, 'Sahel Tools Ltd');
    assert.equal(b.forceCompany, true);
    assert.equal(b.email || '', '');
  });

  it('tells nickname cards to quote then export', () => {
    const dossier = buildAlibabaDossier({
      source: '阿里国际站公开 RFQ',
      company: 'Linda N',
      name: 'Linda N',
      country: 'Netherlands',
      publicCard: { buyerName: 'Linda N', subject: 'hoodies' },
    });
    assert.match(dossier.next, /报价|后台导出/);
    assert.equal(dossier.unlocked, false);
    assert.equal(dossier.legalName, '');
    assert.ok(dossier.peopleSearchLinks.some((l) => /linkedin\.com/.test(l.url)));
  });

  it('builds people-search URLs and skips empty nicknames', () => {
    const links = peopleSearchLinks({ name: 'Ajay Vaishnavi', country: 'India' });
    assert.ok(links.some((l) => /google\.com\/search/.test(l.url) && /Ajay/.test(l.url)));
    assert.deepEqual(peopleSearchLinks({ name: 'Alibaba buyer' }), []);
  });
});

describe('alibaba plan', () => {
  it('counts public cards separately from seller-unlocked rows', () => {
    const plan = summarizeAlibabaPlan([
      { source: '阿里国际站公开 RFQ', researchPath: 'import', name: 'A', country: 'US', publicCard: { buyerName: 'A' } },
      { source: '阿里国际站公开 RFQ', researchPath: 'auto', identitySource: 'rfq_text', company: 'Eco Ltd', name: 'A', country: 'US' },
      {
        source: '阿里国际站公开 RFQ',
        researchPath: 'auto',
        contactSource: 'alibaba_seller',
        identitySource: 'alibaba_seller',
        email: 'buy@sahel.example',
        name: 'B',
        country: 'BF',
        publicCard: { buyerName: 'B' },
      },
    ]);
    assert.equal(plan.total, 3);
    assert.equal(plan.import, 1);
    assert.equal(plan.auto, 2);
    assert.equal(plan.textHint, 1);
    assert.equal(plan.sellerUnlocked, 1);
    assert.equal(plan.hasEmail, 1);
  });

  it('clusters the same display name and country', () => {
    assert.equal(
      buyerClusterKey({ name: 'Wilfried', country: 'Burkina Faso', publicCard: { buyerName: 'Wilfried' } }),
      'wilfried|burkina faso',
    );
    assert.equal(findAlibabaMatch([], { rfq_id: '1' }), null);
    const c = { source: '阿里国际站公开 RFQ', awardId: '1', company: 'X' };
    assert.equal(applySellerExportToLead(c, { company: 'X Ltd' }), true);
  });
});

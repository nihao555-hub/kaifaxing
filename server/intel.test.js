import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreEmailEvidence,
  attachEmailEvidence,
  classifyCompanySocial,
  extractCompanySocials,
  extractLeadership,
  extractTenderPeople,
  parseCompaniesHouseOfficers,
  companyNumberFromFacts,
  mergeOfficers,
  buildIntel,
} from './intel.js';

describe('email evidence', () => {
  it('scores a same-domain procurement mailbox as outreach-ready', () => {
    const ev = scoreEmailEvidence(
      { email: 'procurement@orau.org', role: 'procurement', source: '官网公开页', pages: ['https://www.orau.org/contact'] },
      { website: 'https://www.orau.org/', sameDomain: true, countryFit: false, verifiedEntity: true },
    );
    assert.ok(ev.score >= 80);
    assert.equal(ev.ready, true);
  });

  it('rejects IR and off-domain mail', () => {
    assert.equal(scoreEmailEvidence({ email: 'ir@kier.co.uk', role: 'ir' }, {
      website: 'https://www.kier.co.uk/',
      sameDomain: true,
      verifiedEntity: true,
    }).ready, false);
    assert.equal(scoreEmailEvidence({ email: 'info@washington.org', role: 'info' }, {
      website: 'https://www.goprimegroup.com/',
      sameDomain: false,
      verifiedEntity: true,
    }).score, 0);
  });

  it('does not mark a weak sales footer as ready', () => {
    const ev = scoreEmailEvidence(
      { email: 'sales@example.com', role: 'sales', source: '搜索摘要' },
      { website: 'https://www.example.com/', sameDomain: true, verifiedEntity: true },
    );
    assert.ok(ev.score < 80);
    assert.equal(ev.ready, false);
  });

  it('sorts ready mail first when attaching evidence', () => {
    const rows = attachEmailEvidence(
      [
        { email: 'ir@stc.ac.uk', role: 'ir', source: '官网公开页' },
        { email: 'info@stc.ac.uk', role: 'info', source: '官网公开页', pages: ['https://www.stc.ac.uk/contact-us'] },
      ],
      {
        website: 'https://www.stc.ac.uk/',
        country: 'UK',
        verifiedEntity: true,
        sameDomainFn: (e) => String(e.email).endsWith('@stc.ac.uk'),
      },
    );
    assert.equal(rows[0].email, 'info@stc.ac.uk');
    assert.equal(rows[0].evidence.ready, true);
    assert.equal(rows[1].evidence.ready, false);
  });
});

describe('company socials', () => {
  it('keeps company LinkedIn and drops personal /in/ links', () => {
    assert.equal(classifyCompanySocial('https://www.linkedin.com/company/kier-group'), 'LinkedIn');
    assert.equal(classifyCompanySocial('https://www.linkedin.com/in/jane-doe'), '');
    const found = extractCompanySocials(
      '<a href="https://www.linkedin.com/company/tyne-coast-college">LI</a><a href="https://www.linkedin.com/in/someone">p</a><a href="https://www.facebook.com/tynecoastcollege">fb</a>',
      'https://www.stc.ac.uk/',
    );
    assert.ok(found.some((s) => s.label === 'LinkedIn'));
    assert.ok(found.some((s) => s.label === 'Facebook'));
    assert.ok(found.every((s) => !/\/in\//.test(s.url)));
  });
});

describe('public officers', () => {
  it('reads names and titles from a leadership page', () => {
    const html = `
      <title>Leadership - Tyne Coast College</title>
      <p>Dr Audrey Kingham, Principal and Chief Executive</p>
      <p>John Smith, Vice Principal</p>
    `;
    const people = extractLeadership(html, { pageUrl: 'https://www.stc.ac.uk/about/leadership', title: 'Leadership' });
    assert.ok(people.some((p) => /Kingham/i.test(p.name) && /Principal/i.test(p.title)));
    assert.ok(people.some((p) => /Smith/i.test(p.name)));
  });

  it('reads a tender contact line without inventing an email', () => {
    const people = extractTenderPeople('Contact: Jane Doe, Procurement Officer. Quote by Friday.');
    assert.equal(people[0].name, 'Jane Doe');
    assert.match(people[0].title, /Procurement/);
  });

  it('parses active Companies House officers and skips resigned', () => {
    const rows = parseCompaniesHouseOfficers({
      items: [
        { name: 'BIRCH, Andrew', officer_role: 'director' },
        { name: 'OLD, Pat', officer_role: 'secretary', resigned_on: '2020-01-01' },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'BIRCH, Andrew');
    assert.equal(rows[0].title, 'director');
  });

  it('reads a UK company number from facts', () => {
    assert.equal(companyNumberFromFacts([
      { label: '英国公司登记', value: 'KIER GROUP PLC · 02708030 · active', source: 'Companies House' },
    ]), '02708030');
  });

  it('builds an intel card for the outreach module', () => {
    const intel = buildIntel({
      legalName: 'Tyne Coast College',
      website: 'https://www.stc.ac.uk/',
      facts: [{ label: 'LEI', value: '213800M46TEWGGT9PZ57' }],
      emails: [{ email: 'info@stc.ac.uk', role: 'info', evidence: { score: 90, ready: true, reasons: [] } }],
      officers: [{ name: 'Dr Audrey Kingham', title: 'Principal' }],
      socials: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/company/tyne-coast-college' }],
    });
    assert.equal(intel.outreachEmail, 'info@stc.ac.uk');
    assert.equal(intel.officers[0].title, 'Principal');
    assert.equal(intel.lei, '213800M46TEWGGT9PZ57');
  });

  it('dedupes officers by name', () => {
    const merged = mergeOfficers(
      [{ name: 'Jane Doe', title: 'director' }],
      [{ name: 'Jane Doe', title: 'Director' }, { name: 'John Smith', title: 'secretary' }],
    );
    assert.equal(merged.length, 2);
  });
});

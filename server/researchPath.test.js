import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRfqClues,
  classifyResearchPath,
  crosspostQueries,
  companiesFromSnippets,
  parseAlibabaExportRow,
  distinctiveSubjectPhrase,
} from './researchPath.js';

describe('extractRfqClues', () => {
  it('keeps attributed company, role email, website, sku; drops gmail and alibaba urls', () => {
    const clues = extractRfqClues(
      '公开询盘：oil。I work for NMG TECHNICAL SERVICE L.L.C. Need TRANE OIL00048. Email info@nmguae.com or nmgtech2006@gmail.com https://nmguae.com/contact https://sourcing.alibaba.com/rfq',
    );
    assert.equal(clues.companyHint, 'NMG TECHNICAL SERVICE L.L.C');
    assert.ok(clues.emails.includes('info@nmguae.com'));
    assert.ok(!clues.emails.some((e) => e.includes('gmail')));
    assert.ok(clues.websites.some((u) => u.includes('nmguae.com')));
    assert.ok(!clues.websites.some((u) => u.includes('alibaba')));
    assert.ok(clues.fingerprints.some((f) => /OIL00048/i.test(f)));
  });

  it('does not treat cordless drill copy as a fingerprint', () => {
    const clues = extractRfqClues('Hi, I found this product. Blue Kids Electric Motorcycle Battery 6V Motor 20V OEM.');
    assert.equal(clues.companyHint, '');
    assert.ok(!clues.fingerprints.includes('20V'));
    assert.ok(!clues.fingerprints.includes('OEM'));
  });
});

describe('classifyResearchPath', () => {
  it('sends legal-name leads to auto research', () => {
    const path = classifyResearchPath(
      { company: 'Tyne Coast College', country: 'UK' },
      { personLike: false },
    );
    assert.equal(path.key, 'auto');
  });

  it('uses fingerprints for nickname cards instead of searching the person', () => {
    const clues = extractRfqClues('Need TRANE OIL00048 for chiller in Dubai');
    const path = classifyResearchPath(
      { company: 'Abdi Muse', name: 'Abdi Muse', country: 'UAE' },
      { personLike: true, clues },
    );
    assert.equal(path.key, 'crosspost');
    assert.match(path.next, /不搜/);
    const qs = crosspostQueries(clues, 'UAE');
    assert.ok(qs.some((q) => q.includes('OIL00048')));
    assert.ok(qs.every((q) => !/Abdi/i.test(q)));
  });

  it('does not google a generic product title just because it has a weight', () => {
    const customer = {
      company: 'Yash Kumar',
      name: 'Yash Kumar',
      country: 'Palau',
      publicCard: { subject: 'Custom Logo PP Woven Sack Plastic 50kg Copra Meal Packaging Bags' },
    };
    const phrase = distinctiveSubjectPhrase(customer.publicCard.subject);
    assert.match(phrase, /Woven Sack/);
    const path = classifyResearchPath(customer, { personLike: true, clues: extractRfqClues('Need bags') });
    assert.equal(path.key, 'import');
    const qs = crosspostQueries({}, 'Palau', customer);
    assert.ok(qs.every((q) => !/Yash/i.test(q)));
  });

  it('asks for seller-backend identity when the card is only a nickname', () => {
    const path = classifyResearchPath(
      { company: 'Linda N', painPoints: 'Need hoodies' },
      { personLike: true, clues: extractRfqClues('Need hoodies') },
    );
    assert.equal(path.key, 'import');
  });
});

describe('companiesFromSnippets', () => {
  it('keeps a country-matching legal name and drops Alibaba', () => {
    const found = companiesFromSnippets([
      { title: 'NMG TECHNICAL SERVICE L.L.C Dubai HVAC', desc: 'Chiller oil TRANE OIL00048' },
      { title: 'Alibaba.com Gold Supplier', desc: 'Trade Assurance' },
    ], { country: 'UAE' });
    assert.equal(found[0].name, 'NMG TECHNICAL SERVICE L.L.C');
    assert.ok(found.every((x) => !/alibaba/i.test(x.name)));
  });
});

describe('parseAlibabaExportRow', () => {
  it('reads seller-backend company columns', () => {
    const row = parseAlibabaExportRow({
      buyer_company_name: 'Sahel Tools Ltd',
      buyer_name: 'Wilfried',
      buyer_email: 'buy@sahel.example',
      Country: 'Burkina Faso',
      'RFQ ID': '1684',
    });
    assert.equal(row.company, 'Sahel Tools Ltd');
    assert.equal(row.email, 'buy@sahel.example');
    assert.equal(row.awardId, '1684');
  });
});

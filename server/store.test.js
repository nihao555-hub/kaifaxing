import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { leadFacets, listCustomers, isDemoCustomer } from './store.js';

describe('demo customers', () => {
  it('flags seed example.com rows', () => {
    assert.equal(isDemoCustomer({ id: 'c1', email: 'a@acme-corp.example.com' }), true);
    assert.equal(isDemoCustomer({ id: 'rfq1', email: 'info@stc.ac.uk' }), false);
    assert.equal(isDemoCustomer({ id: 'x', email: 'procurement@acme.example' }), true);
    assert.equal(isDemoCustomer({ id: 'x', email: '15571870062@163.com' }), true);
  });
});

describe('leadFacets', () => {
  it('returns country counts for RFQ leads', () => {
    const facets = leadFacets();
    assert.equal(typeof facets.countries, 'object');
    assert.equal(typeof facets.sources, 'object');
    const countryTotal = Object.values(facets.countries).reduce((n, c) => n + c, 0);
    assert.equal(countryTotal, facets.total);
  });
});

describe('listCustomers lead filters', () => {
  it('filters RFQ leads by country and today ingest date', () => {
    const all = listCustomers({ view: 'leads', limit: 5 });
    assert.ok(all.total >= 0);
    if (!all.items.length) return;
    const country = all.items.find((c) => c.country)?.country;
    if (country) {
      const filtered = listCustomers({ view: 'leads', country, limit: 20 });
      assert.ok(filtered.items.every((c) => (c.country || '').trim() === country));
    }
    const noneToday = listCustomers({ view: 'leads', ingestedOn: '1999-01-01', limit: 5 });
    assert.equal(noneToday.total, 0);
  });

  it('accepts comma-separated sources', () => {
    const facets = leadFacets();
    const names = Object.keys(facets.sources).slice(0, 2);
    if (names.length < 2) return;
    const result = listCustomers({ view: 'leads', source: names.join(','), limit: 30 });
    assert.ok(result.items.every((c) => names.includes(c.source || '')));
  });
});

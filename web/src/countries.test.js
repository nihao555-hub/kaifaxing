import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countryIso, countryLabel, groupCountryFacets } from './countries.js';

describe('country mapping', () => {
  it('maps English, Chinese and ISO aliases to the same flag', () => {
    assert.equal(countryIso('United States'), 'us');
    assert.equal(countryIso('美国'), 'us');
    assert.equal(countryIso('USA'), 'us');
    assert.equal(countryIso('United Kingdom'), 'gb');
    assert.equal(countryIso('英国'), 'gb');
    assert.equal(countryIso('Hong Kong S.A.R.'), 'hk');
    assert.equal(countryIso('BGR'), 'bg');
  });

  it('shows Chinese labels', () => {
    assert.equal(countryLabel('United States'), '美国');
    assert.equal(countryLabel('Germany'), '德国');
    assert.equal(countryLabel('未标注'), '未标注');
  });

  it('merges US aliases in facets', () => {
    const groups = groupCountryFacets({ 'United States': 10, 美国: 3, USA: 1, India: 5 });
    const us = groups.find((g) => g.iso === 'us');
    assert.equal(us.count, 14);
    assert.equal(us.label, '美国');
    assert.ok(us.names.includes('United States'));
  });
});

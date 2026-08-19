import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PAID_SOURCE_MODELS, paidSourceStatus, normalizePaidExportRow } from './paidSources.js';

describe('paid source models', () => {
  it('covers platform, license, crm and guess', () => {
    assert.deepEqual(PAID_SOURCE_MODELS.map((m) => m.key), ['platform', 'license', 'crm', 'guess']);
    const st = paidSourceStatus({ alibabaReady: true, companiesHouseReady: false });
    assert.equal(st.connectors.find((c) => c.key === 'alibaba').ready, true);
    assert.equal(st.connectors.find((c) => c.key === 'companies_house').ready, false);
  });

  it('reads Apollo / customs-style export columns', () => {
    const row = normalizePaidExportRow({
      organization_name: 'Tyne Coast College',
      work_email: 'info@stc.ac.uk',
      company_number: '10005999',
      country: 'UK',
    });
    assert.equal(row.company, 'Tyne Coast College');
    assert.equal(row.email, 'info@stc.ac.uk');
    assert.equal(row.regNo, '10005999');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { topSign, beijingTimestamp, extractRfqList, normalizeAlibabaRfq } from './alibaba.js';
import { parseIngestPayload, listSources } from './rfq.js';

describe('TOP sign', () => {
  it('hmac matches official sorted concat', () => {
    const sign = topSign(
      { app_key: '123', method: 'alibaba.icbu.rfq.search', v: '2.0' },
      'secret',
      'hmac'
    );
    assert.match(sign, /^[A-F0-9]{32}$/);
    const again = topSign(
      { v: '2.0', method: 'alibaba.icbu.rfq.search', app_key: '123' },
      'secret',
      'hmac'
    );
    assert.equal(sign, again);
  });

  it('beijing timestamp is yyyy-MM-dd HH:mm:ss', () => {
    assert.match(beijingTimestamp(new Date('2026-08-16T05:00:00.000Z')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('Alibaba RFQ parse', () => {
  it('unwraps open_rfq_d_t_o list', () => {
    const list = extractRfqList({
      alibaba_icbu_rfq_search_response: {
        result: { rfq_list: { open_rfq_d_t_o: [{ rfq_id: '9', subject: 'drills', buyer_country: 'DE' }] } },
      },
    });
    assert.equal(list.length, 1);
    const n = normalizeAlibabaRfq(list[0]);
    assert.equal(n.id, 'ali_9');
    assert.equal(n.kind, 'commercial');
    assert.equal(n.source, '阿里国际站 RFQ');
  });
});

describe('commercial ingest', () => {
  it('accepts {source, items} and aliases', () => {
    const items = parseIngestPayload({
      source: 'TendersOnTime',
      items: [{ companyName: 'Acme', contactEmail: 'a@b.com', countryName: '德国', description: 'drills' }],
    });
    assert.equal(items[0].company, 'Acme');
    assert.equal(items[0].email, 'a@b.com');
    assert.equal(items[0].source, 'TendersOnTime');
    assert.equal(items[0].kind, 'commercial');
    assert.equal(items[0].timezone, 'Europe/Berlin');
  });
});

describe('source catalog', () => {
  it('marks alibaba commercial and not ready without keys', () => {
    const ali = listSources().find((s) => s.key === 'alibaba');
    assert.equal(ali.kind, 'commercial');
    assert.equal(ali.ready, false);
    assert.ok(listSources().some((s) => s.kind === 'government' && s.ready));
  });
});

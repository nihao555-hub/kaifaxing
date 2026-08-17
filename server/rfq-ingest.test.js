import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { topSign, beijingTimestamp, extractRfqList, normalizeAlibabaRfq } from './alibaba.js';
import { parseIngestPayload, listSources, pickLang } from './rfq.js';

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

  it('reads Alibaba seller-backend company columns', () => {
    const items = parseIngestPayload({
      source: '阿里国际站后台导出',
      items: [{ buyer_company_name: 'Sahel Tools Ltd', buyer_email: 'buy@sahel.example', Country: 'Burkina Faso', rfq_id: '1684056292' }],
    });
    assert.equal(items[0].company, 'Sahel Tools Ltd');
    assert.equal(items[0].email, 'buy@sahel.example');
    assert.equal(items[0].awardId, '1684056292');
  });

  it('reads Apollo / customs-style paid export columns', () => {
    const items = parseIngestPayload({
      source: 'Apollo 导出',
      items: [{ organization_name: 'Tyne Coast College', work_email: 'info@stc.ac.uk', country: 'UK' }],
    });
    assert.equal(items[0].company, 'Tyne Coast College');
    assert.equal(items[0].email, 'info@stc.ac.uk');
  });
});

describe('TED title language', () => {
  it('does not take the first character of an English title string', () => {
    assert.equal(pickLang({ eng: 'Cleaning of windows and communal areas' }), 'Cleaning of windows and communal areas');
    assert.equal(pickLang({ deu: 'A', eng: 'Supply of workshop tools' }), 'Supply of workshop tools');
  });
});

describe('source catalog', () => {
  it('marks official alibaba not ready and public list ready', () => {
    const ali = listSources().find((s) => s.key === 'alibaba');
    const pub = listSources().find((s) => s.key === 'alibaba_public');
    assert.equal(ali.kind, 'commercial');
    assert.equal(ali.ready, false);
    assert.equal(pub.ready, true);
    assert.ok(listSources().some((s) => s.kind === 'government' && s.ready));
  });
});

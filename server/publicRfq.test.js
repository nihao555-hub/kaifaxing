import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAlibabaPublicHtml, parseOpenTime, extractAlibabaPublicBlocks } from './publicRfq.js';

const SAMPLE = `
window.PAGE_DATA["index"].data.push({
  url: "\\x2f\\x2fsourcing.alibaba.com\\x2frfq_detail.htm\\x3fp\\x3dABC",
  id: "1684056292",
  rfqId: "1684056292",
  subject: "20v\\x20Cordless\\x20Drill",
  description: "Need\\x20drills",
  country: "Burkina Faso",
  countrySimple: "BF",
  quantity:  '20' ,
  quantityUnit: "Pieces",
  openTimeStr: "2 days ago",
  haveAnnexes: true,
  rfqStarLevel: parseInt("3" || 0),
  buyerName: 'Wilfried\\x20Kiendrebeogo',
});
pageView.totalPages = '100';
pageView.currentPage = '1';
pageView.totalItems = '2228';
`;

describe('alibaba public parser', () => {
  it('extracts public card fields without email', () => {
    assert.equal(extractAlibabaPublicBlocks(SAMPLE).length, 1);
    const { items, totalItems, currentPage } = parseAlibabaPublicHtml(SAMPLE);
    assert.equal(items.length, 1);
    assert.equal(items[0].rfqId, '1684056292');
    assert.equal(items[0].subject, '20v Cordless Drill');
    assert.equal(items[0].buyerName, 'Wilfried Kiendrebeogo');
    assert.equal(items[0].country, 'Burkina Faso');
    assert.equal(items[0].quantity, '20');
    assert.equal(items[0].url, 'https://sourcing.alibaba.com/rfq_detail.htm?p=ABC');
    assert.equal(totalItems, 2228);
    assert.equal(currentPage, 1);
    assert.equal(items[0].email, undefined);
  });

  it('reads country filter counts', () => {
    const { countries } = parseAlibabaPublicHtml('{"count":49420,"item":"US"}{"count":8095,"item":"IN"}');
    assert.equal(countries[0].code, 'US');
    assert.equal(countries[0].count, 49420);
  });

  it('parses relative open time', () => {
    const now = new Date('2026-08-16T12:00:00Z');
    const d = parseOpenTime('13 days ago', now);
    assert.ok(d);
    assert.equal(d.toISOString().slice(0, 10), '2026-08-03');
  });
});

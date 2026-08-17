import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoldSupplier, parseTradeIndia } from './b2bPublic.js';

describe('GoldSupplier public parser', () => {
  it('reads title country and posted time', () => {
    const html = `
      <div class="inquiry-item">
        <div class="truncate inquiry-title">
          <a href="https://www.goldsupplier.com/3D-Glasses/inquiry_7805379.html">Inquiry about Paper 3D Glasses <i class="icon-new">NEW</i></a>
        </div>
        <div class="text-base text-neutral-3 line-clamp-2 details">Need 300000 pieces</div>
        <span class="text-neutral-3">United States</span>
        <div class="text-neutral-6 datetime">Posted at: 2026-08-13 21:34:14</div>
      </div>`;
    const items = parseGoldSupplier(html);
    assert.equal(items.length, 1);
    assert.equal(items[0].rfqId, '7805379');
    assert.match(items[0].title, /3D Glasses/);
    assert.equal(items[0].country, 'United States');
    assert.ok(items[0].postedAt.startsWith('2026-08-13'));
  });
});

describe('TradeIndia public parser', () => {
  it('reads buyoffer card', () => {
    const html = `
      <div class="blBuyLeadsBox"><div> <a href="/buyoffer/17947147/Glass-Roll.html" class="blTitle"> Glass Roll </a> </div>
      <div class="blCountry"><img alt="map"> India </div>
      <div class="blPostedDate">Date posted : <span class="blDate">14 August 2026</span></div>
      <div class="blBuyrLooking">Buyer is looking for <span class="blLookingName">Glass Roll</span></div></div>`;
    const items = parseTradeIndia(html);
    assert.equal(items[0].rfqId, '17947147');
    assert.equal(items[0].title, 'Glass Roll');
    assert.equal(items[0].country, 'India');
    assert.ok(items[0].postedAt.startsWith('2026-08-14'));
  });
});

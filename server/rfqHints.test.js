import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buyerFacingText, extractCompanyHintFromText, imageSearchLinks } from './rfqHints.js';

describe('extractCompanyHintFromText', () => {
  it('keeps attributed legal names in the buyer message', () => {
    assert.equal(
      extractCompanyHintFromText('公开询盘：Lawn mower，数量 5。I work for Cornerstone Consultants Limited and need mowers.'),
      'Cornerstone Consultants Limited',
    );
    assert.equal(
      extractCompanyHintFromText('Our company is NMG TECHNICAL SERVICE L.L.C based in Dubai.'),
      'NMG TECHNICAL SERVICE L.L.C',
    );
    assert.equal(
      extractCompanyHintFromText('Hello, we are representing Star Foods Ltd for this purchase.'),
      'Star Foods Ltd',
    );
    assert.equal(
      extractCompanyHintFromText('I am from Auxel SA and need electrical parts.'),
      'Auxel SA',
    );
    assert.equal(
      extractCompanyHintFromText('On behalf of Apache S.A we need packaging.'),
      'Apache S.A',
    );
    assert.equal(
      extractCompanyHintFromText('writing on behalf of Tobago Healthcare Equipment and Supplies.We need towels'),
      'Tobago Healthcare Equipment and Supplies',
    );
    assert.equal(
      extractCompanyHintFromText('MY COMPANY NAME IS AEVI DESIGNS Polish furniture'),
      'AEVI DESIGNS',
    );
    assert.equal(
      extractCompanyHintFromText('on behalf of SBDC Bahamas we need LED tables'),
      'SBDC Bahamas',
    );
    assert.equal(
      extractCompanyHintFromText('Our company is looking for 10,000 bags Material:PP woven'),
      '',
    );
    assert.equal(
      extractCompanyHintFromText('We are contacting you on behalf of Titanlink Industrial LLC(USA) regarding sourcing.'),
      'Titanlink Industrial LLC',
    );
    assert.equal(
      extractCompanyHintFromText('Good day, I represent Eco Solutions Ltd.,focusing on sustainable operations.'),
      'Eco Solutions Ltd',
    );
    assert.equal(
      extractCompanyHintFromText('I am Roshan More from Sea Everest Co.,Ltd,established in Myanmar since 2005.'),
      'Sea Everest Co.,Ltd',
    );
    assert.equal(
      extractCompanyHintFromText('This is Reaksa from Positron Multiverse Co.,Ltd.,a leading system integrator.'),
      'Positron Multiverse Co.,Ltd',
    );
    assert.equal(
      extractCompanyHintFromText('Our company Trade Bridge Ltd is located in Trinidad and Tobago.'),
      'Trade Bridge Ltd',
    );
    assert.equal(
      extractCompanyHintFromText('Signal Technologies Inc.is currently implementing a project that requires Wi-Fi gear.'),
      'Signal Technologies Inc',
    );
  });

  it('ignores we-are-seeking and product titles that happen to end in Limited', () => {
    assert.equal(
      extractCompanyHintFromText('公开询盘：Toyota Fortuner Limited Edition。We are seeking a supplier.'),
      '',
    );
    assert.equal(
      extractCompanyHintFromText('We are a company from the Netherlands and we sell on Bol.'),
      '',
    );
    assert.equal(
      extractCompanyHintFromText('We are looking for luxury car seats. SOLO Clothing LLC catalog attached.'),
      '',
    );
    assert.equal(extractCompanyHintFromText('Kartik Sharma wants spark plugs'), '');
    assert.equal(
      extractCompanyHintFromText('We are considering procuring computer hardware from your company.'),
      '',
    );
    assert.equal(
      extractCompanyHintFromText('I am reaching out from XYZ Company about this RFQ.'),
      '',
    );
    assert.equal(
      extractCompanyHintFromText("I'm interested in Samsung galaxy Ltd screens"),
      '',
    );
    assert.equal(
      extractCompanyHintFromText('Hello, we are an industrial company looking for parts.'),
      '',
    );
  });

  it('reads the description after the public-list prefix', () => {
    const text = buyerFacingText('公开询盘：Battery BMS，数量 3，Australia。I am from Perth Battery Ltd 列表页无邮箱，入库后补公司采购邮箱再发信。');
    assert.match(text, /Perth Battery Ltd/);
    assert.equal(extractCompanyHintFromText('公开询盘：Battery BMS。I am from Perth Battery Ltd'), 'Perth Battery Ltd');
  });
});

describe('imageSearchLinks', () => {
  it('builds browser reverse-image links and skips empty urls', () => {
    const links = imageSearchLinks('https://sc04.alicdn.com/kf/A77a.jpg_140x140.jpg');
    assert.equal(links.length, 4);
    assert.ok(links.every((l) => l.url.includes(encodeURIComponent('https://sc04.alicdn.com/kf/A77a.jpg_140x140.jpg'))));
    assert.deepEqual(imageSearchLinks(''), []);
    assert.deepEqual(imageSearchLinks('javascript:alert(1)'), []);
  });
});

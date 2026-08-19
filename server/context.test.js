import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWriterBrief, buildConversationBrief } from './context.js';

describe('buildWriterBrief', () => {
  it('feeds verified KYB facts into the outreach writer, not just the name card', () => {
    const brief = buildWriterBrief({
      name: 'LiveWest Homes Limited',
      company: 'LIVEWEST HOMES LIMITED',
      legalName: 'LIVEWEST HOMES LIMITED',
      title: 'Contract',
      country: '英国',
      timezone: 'Europe/London',
      industry: 'Cleaning services',
      email: 'enquiries@livewest.co.uk',
      website: 'https://www.livewest.co.uk/',
      source: 'UK Contracts Finder',
      sourceUrl: 'https://www.contractsfinder.service.gov.uk/Notice/fd02361c',
      painPoints: 'Window and Communal Cleaning at various LiveWest Locations. 截止 2026-09-07',
      research: {
        grade: 'A',
        brief: '主体核验指向 LIVEWEST HOMES LIMITED。官网：https://www.livewest.co.uk/',
        legalName: 'LIVEWEST HOMES LIMITED',
        website: 'https://www.livewest.co.uk/',
        outreachAdvice: '可向 enquiries@livewest.co.uk 写开发信',
        facts: [
          { label: 'LEI', value: '213800F3JP6H9MYO5442', source: 'GLEIF' },
          { label: '注册地址', value: '1 WELLINGTON WAY, EXETER, EX5 2FZ, GB', source: 'GLEIF' },
        ],
        intel: { parent: 'LiveWest' },
        kyb: { grade: 'A' },
      },
    });
    assert.match(brief, /enquiries@livewest\.co\.uk/);
    assert.match(brief, /www\.livewest\.co\.uk/);
    assert.match(brief, /213800F3JP6H9MYO5442/);
    assert.match(brief, /UK Contracts Finder/);
    assert.match(brief, /分级：A/);
    assert.match(brief, /Window and Communal Cleaning/);
  });

  it('puts the full Alibaba RFQ card into the writer, not just the name line', () => {
    const brief = buildWriterBrief({
      name: 'MB Service',
      company: 'MB Service',
      email: 'info@wvdw.co.za',
      country: 'Moldova',
      painPoints: '公开询盘：car cover',
      publicCard: {
        subject: 'Four Seasons Universal Hail/Snow/Rain Proof Waterproof UV Protection Polyester Oxford Cloth Sports Car Cover',
        description: 'Hello,i need a car cover for my Denza N9.the car is 5300*2030*1830 mm Function: Waterproof',
        quantity: '1',
        quantityUnit: 'Piece/Pieces',
        buyerName: 'MB Service',
        postedAt: '2026-08-13',
      },
      research: {
        kyb: { grade: 'A' },
        socials: [
          { label: 'LinkedIn', url: 'https://www.linkedin.com/company/willems-van-der-westhuizen/' },
          { label: 'Person', url: 'https://www.linkedin.com/in/someone' },
        ],
        emails: [{ email: 'info@wvdw.co.za' }],
      },
    });
    assert.match(brief, /Denza N9/);
    assert.match(brief, /5300\*2030\*1830/);
    assert.match(brief, /linkedin\.com\/company\/willems-van-der-westhuizen/);
    assert.doesNotMatch(brief, /linkedin\.com\/in\/someone/);
    assert.match(brief, /询盘 \/ 招标原文/);
  });
});

describe('buildConversationBrief', () => {
  it('keeps the KYB card when writing a follow-up', () => {
    const { brief } = buildConversationBrief(
      {
        name: 'CETIN',
        company: 'CETIN',
        email: 'info@cetin.cz',
        research: { brief: '官网 cetin.cz', kyb: { grade: 'A' }, facts: [{ label: '法域', value: 'CZ', source: 'GLEIF' }] },
      },
      [{ type: 'outbound', time: '2026-08-18 09:50', subject: 'CETIN tools', body: 'MOQ 200, 15-day lead time' }],
      { subject: 'Re: CETIN tools', body: 'Please send the spec.' }
    );
    assert.match(brief, /分级：A/);
    assert.match(brief, /法域: CZ/);
    assert.match(brief, /MOQ 200/);
    assert.match(brief, /Please send the spec/);
  });
});

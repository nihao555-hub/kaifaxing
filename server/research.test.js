import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripLegalSuffix,
  significantTokens,
  tokenOverlap,
  isPersonLikeDisplayName,
  isPersonLikeLead,
  isPlausibleEmail,
  scoreEmail,
  extractEmails,
  extractPhones,
  registrableDomain,
  websiteCandidates,
  pickBestHit,
  emailBelongsToCompany,
} from './research.js';

describe('company name helpers', () => {
  it('strips legal suffixes', () => {
    assert.equal(stripLegalSuffix('KIER TRANSPORTATION LIMITED'), 'KIER TRANSPORTATION');
    assert.equal(stripLegalSuffix('HOWOGE Wohnungsbaugesellschaft mbH'), 'HOWOGE Wohnungsbaugesellschaft');
    assert.equal(stripLegalSuffix('L3HARRIS TECHNOLOGIES, INC.'), 'L3HARRIS TECHNOLOGIES');
  });

  it('scores parent-company overlap', () => {
    assert.ok(tokenOverlap('KIER TRANSPORTATION LIMITED', 'Kier Group') >= 0.5);
    assert.ok(tokenOverlap('L3HARRIS TECHNOLOGIES, INC.', 'L3Harris Technologies') >= 0.8);
    assert.equal(tokenOverlap('solo beck', 'Acme Corporation'), 0);
  });

  it('rejects family-name and person Wikidata hits', () => {
    const picked = pickBestHit(
      [
        { label: 'Bueno', description: 'family name' },
        { label: 'Chris Van Allsburg', description: "American children's writer and illustrator" },
      ],
      'CHRIS',
      (h) => h.label
    );
    assert.equal(picked, null);
  });

  it('accepts Kier Group and rejects DE KIER', () => {
    const picked = pickBestHit(
      [
        { label: 'DE KIER', description: 'Wikimedia disambiguation page' },
        { label: 'Kier Group', description: 'British construction, services and property group' },
      ],
      'KIER TRANSPORTATION LIMITED',
      (h) => h.label
    );
    assert.equal(picked.label, 'Kier Group');
  });

  it('treats Alibaba display names as people, not companies', () => {
    assert.equal(isPersonLikeDisplayName('solo beck'), true);
    assert.equal(isPersonLikeDisplayName('Ahmed AlMansouri'), true);
    assert.equal(isPersonLikeDisplayName('CHRIS'), true);
    assert.equal(isPersonLikeDisplayName('H C'), true);
    assert.equal(isPersonLikeDisplayName('Tyne Coast College'), false);
    assert.equal(isPersonLikeDisplayName('KIER TRANSPORTATION LIMITED'), false);
    assert.equal(isPersonLikeDisplayName('L3HARRIS TECHNOLOGIES, INC.'), false);
    assert.equal(isPersonLikeDisplayName('A. Kroeze Beheer B.V.'), false);
    assert.equal(isPersonLikeLead({ company: 'CHRIS', name: 'chris V' }), true);
    assert.equal(isPersonLikeLead({ company: 'L3HARRIS TECHNOLOGIES, INC.', name: 'John' }), false);
  });

  it('keeps distinctive tokens', () => {
    assert.deepEqual(significantTokens('The Kier Group PLC'), ['kier', 'group']);
  });
});

describe('public contact extractors', () => {
  it('keeps role mailboxes and drops image/css junk', () => {
    const html = `
      <title>Contact - South Tyneside College</title>
      <p>Email us at info@stc.ac.uk or careersteam@tynecoast.ac.uk</p>
      <img src="cropped-stc-logo@2x.png" />
      <style>@font-face{src:url(realist-howoge-regular.woff2)}</style>
      <a href="mailto:noreply@stc.ac.uk">no</a>
    `;
    const emails = extractEmails(html, { websiteHost: 'www.stc.ac.uk' });
    assert.deepEqual(emails.map((e) => e.email), ['info@stc.ac.uk', 'careersteam@tynecoast.ac.uk']);
    assert.ok(scoreEmail('info@stc.ac.uk', 'www.stc.ac.uk') > scoreEmail('random@gmail.com', 'www.stc.ac.uk'));
  });

  it('reads German imprint role email', () => {
    const html = '<p>Unternehmenskommunikation uk@howoge.de 030 - 5464-0</p>';
    const emails = extractEmails(html, { websiteHost: 'www.howoge.de' });
    assert.equal(emails[0].email, 'uk@howoge.de');
  });

  it('rejects implausible addresses', () => {
    assert.equal(isPlausibleEmail('cropped-stc-logo@2x.png'), false);
    assert.equal(isPlausibleEmail('noreply@stc.ac.uk'), false);
    assert.equal(isPlausibleEmail('info@stc.ac.uk'), true);
    assert.equal(isPlausibleEmail('5464-0uk@howoge.de'), false);
  });

  it('extracts international phones', () => {
    const phones = extractPhones('<p>Call +44 191 427 3500 or +1 321-727-9100</p>');
    assert.ok(phones.some((p) => p.includes('44')));
  });

  it('reads tel links', () => {
    const phones = extractPhones('<a href="tel:+441914273500">Call us</a>');
    assert.ok(phones.some((p) => p.includes('441914273500') || p.includes('44 191')));
  });

  it('handles multi-part TLDs', () => {
    assert.equal(registrableDomain('www.kier.co.uk'), 'kier.co.uk');
    assert.equal(registrableDomain('www.stc.ac.uk'), 'stc.ac.uk');
    assert.equal(registrableDomain('www.l3harris.com'), 'l3harris.com');
  });

  it('keeps company-domain role mail and drops broker personal mail', () => {
    assert.equal(emailBelongsToCompany('ir@kier.co.uk', 'www.kier.co.uk', 'Kier Group'), true);
    assert.equal(emailBelongsToCompany('uk@howoge.de', 'www.howoge.de', 'HOWOGE Wohnungsbaugesellschaft mbH'), true);
    assert.equal(emailBelongsToCompany('info@howoge-mieterrat.com', 'www.howoge.de', 'HOWOGE Wohnungsbaugesellschaft mbH'), true);
    assert.equal(emailBelongsToCompany('robert.chantry@berenberg.com', 'www.kier.co.uk', 'Kier Group'), false);
  });

  it('tries https www before plain http', () => {
    const urls = websiteCandidates('http://www.stc.ac.uk');
    assert.equal(urls[0], 'https://www.stc.ac.uk/');
    assert.ok(urls.includes('http://www.stc.ac.uk/'));
  });
});

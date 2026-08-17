import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripLegalSuffix,
  cleanOfficialBuyerName,
  significantTokens,
  tokenOverlap,
  isPersonLikeDisplayName,
  isPersonLikeLead,
  skippedLeadReport,
  compactSkippedReport,
  applyLeadIdentity,
  isPlausibleEmail,
  scoreEmail,
  extractEmails,
  extractPhones,
  registrableDomain,
  websiteCandidates,
  pickBestHit,
  emailBelongsToCompany,
  hostLooksLikeCompany,
  queriesFor,
  selectSearchContactUrls,
  mergeSearchSnippetEmails,
} from './research.js';

describe('company name helpers', () => {
  it('strips legal suffixes', () => {
    assert.equal(stripLegalSuffix('KIER TRANSPORTATION LIMITED'), 'KIER TRANSPORTATION');
    assert.equal(stripLegalSuffix('HOWOGE Wohnungsbaugesellschaft mbH'), 'HOWOGE Wohnungsbaugesellschaft');
    assert.equal(stripLegalSuffix('L3HARRIS TECHNOLOGIES, INC.'), 'L3HARRIS TECHNOLOGIES');
  });

  it('strips TED buyer suffixes', () => {
    assert.equal(cleanOfficialBuyerName('Mayo County Council_1127'), 'Mayo County Council');
    assert.equal(cleanOfficialBuyerName('Munster Technological University.'), 'Munster Technological University');
    assert.equal(cleanOfficialBuyerName('BIP SOLUTIONS LIMITED'), 'BIP SOLUTIONS LIMITED');
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

  it('accepts a listed parent for a subsidiary legal name', () => {
    const picked = pickBestHit(
      [
        { label: 'Royal Library of Belgium', description: 'national library of Belgium' },
        { label: 'KBR, Inc.', description: 'American engineering, procurement, and construction company' },
      ],
      'KBR WYLE SERVICES, LLC',
      (h) => h.label
    );
    assert.equal(picked.label, 'KBR, Inc.');
    assert.ok(queriesFor('KIER TRANSPORTATION LIMITED').some((q) => /group|plc/i.test(q)));
  });

  it('treats Alibaba display names as people, not companies', () => {
    assert.equal(isPersonLikeDisplayName('solo beck'), true);
    assert.equal(isPersonLikeDisplayName('Ahmed AlMansouri'), true);
    assert.equal(isPersonLikeDisplayName('CHRIS'), true);
    assert.equal(isPersonLikeDisplayName('H C'), true);
    assert.equal(isPersonLikeDisplayName('Tyne Coast College'), false);
    assert.equal(isPersonLikeDisplayName('Politechnika Warszawska'), false);
    assert.equal(isPersonLikeDisplayName('Fakultní nemocnice Olomouc'), false);
    assert.equal(isPersonLikeLead({ company: 'Politechnika Warszawska', source: 'TED Europa' }), false);
    assert.equal(isPersonLikeLead({ company: 'Fakultní nemocnice Olomouc', source: 'TED Europa' }), false);
    assert.equal(isPersonLikeDisplayName('KIER TRANSPORTATION LIMITED'), false);
    assert.equal(isPersonLikeDisplayName('L3HARRIS TECHNOLOGIES, INC.'), false);
    assert.equal(isPersonLikeDisplayName('A. Kroeze Beheer B.V.'), false);
    assert.equal(isPersonLikeDisplayName('Linda N'), true);
    assert.equal(isPersonLikeDisplayName('J Dykstra'), true);
    assert.equal(isPersonLikeDisplayName('Sam W'), true);
    assert.equal(isPersonLikeDisplayName('NMG TECHNICAL SERVICE L.L.C'), false);
    assert.equal(isPersonLikeDisplayName('Денис Авдеев'), true);
    assert.equal(isPersonLikeDisplayName('José Araya'), true);
    assert.equal(isPersonLikeDisplayName('@gmail.com @gmail.com'), true);
    assert.equal(isPersonLikeDisplayName('AHSN COMPANY'), false);
    assert.equal(isPersonLikeDisplayName('Kutumb Ecommerceprivatelimited'), false);
    assert.equal(isPersonLikeDisplayName('Rohmers Dienstleistungen'), false);
    assert.equal(isPersonLikeLead({ company: 'CHRIS', name: 'chris V' }), true);
    assert.equal(isPersonLikeLead({ company: 'L3HARRIS TECHNOLOGIES, INC.', name: 'John' }), false);
    const skipped = skippedLeadReport({ company: 'Linda N', country: 'Netherlands' });
    assert.equal(skipped.grade, 'C');
    assert.equal(skipped.status, 'done');
    const compact = compactSkippedReport({ company: 'Linda N' });
    assert.equal(compact.grade, 'C');
    assert.equal(compact.status, 'done');
    assert.equal(compact.steps, undefined);
    assert.ok(JSON.stringify(compact).length < 600);
    const project = compactSkippedReport({ company: 'Assam: School Education' }, 'project');
    assert.match(project.brief, /项目/);
    const row = { company: 'Linda N', name: 'Linda N' };
    assert.equal(isPersonLikeLead(row), true);
    applyLeadIdentity(row, { company: 'NMG TECHNICAL SERVICE L.L.C', regNo: '123456' });
    assert.equal(row.forceCompany, true);
    assert.equal(isPersonLikeLead(row), false);
    assert.equal(row.buyerAlias, 'Linda N');
    assert.throws(() => applyLeadIdentity({ company: 'Sam W' }, { company: 'Sam W' }), /昵称/);
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
    assert.equal(isPlausibleEmail('ir@kier.co.uktelephone'), false);
    assert.equal(isPlausibleEmail('buyer@gmail.com'), false);
    assert.equal(isPlausibleEmail('sales@outlook.com'), false);
    assert.equal(isPlausibleEmail('info@qq.com'), false);
    assert.equal(isPlausibleEmail('etunimi.sukunimi@voimia.fi'), false);
    assert.equal(isPlausibleEmail('office@domainname.de'), false);
  });

  it('keeps search-snippet role mail on the company domain and drops personal inboxes', () => {
    const extra = mergeSearchSnippetEmails(
      ['info@stc.ac.uk', 'buyer@gmail.com', 'INFO@stc.ac.uk', 'random@berenberg.com'],
      { websiteHost: 'www.stc.ac.uk', company: 'Tyne Coast College' }
    );
    assert.deepEqual(extra.map((e) => e.email), ['info@stc.ac.uk']);
    assert.equal(extra[0].source, '搜索摘要');
  });

  it('ranks search contact pages above PDFs and homepages', () => {
    const picked = selectSearchContactUrls([
      'https://www.stc.ac.uk/about.pdf',
      'https://www.stc.ac.uk/',
      'https://www.stc.ac.uk/contact-us',
      'https://www.stc.ac.uk/impressum',
    ], { max: 2 });
    assert.ok(picked[0].includes('/contact-us') || picked[0].includes('/impressum'));
    assert.ok(!picked.some((u) => /\.pdf/i.test(u)));
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
    assert.equal(emailBelongsToCompany('info@howoge-mieterrat.com', 'www.howoge.de', 'HOWOGE Wohnungsbaugesellschaft mbH'), false);
    assert.equal(emailBelongsToCompany('robert.chantry@berenberg.com', 'www.kier.co.uk', 'Kier Group'), false);
    assert.equal(hostLooksLikeCompany('https://londonwebcam.co.uk/', 'London Universities Purchasing Consortium'), false);
    assert.equal(hostLooksLikeCompany('https://www.crescenttool.com/', 'Crescent Purchasing Consortium Limited'), false);
    assert.equal(hostLooksLikeCompany('https://www.kier.co.uk/', 'KIER TRANSPORTATION LIMITED'), true);
    assert.ok(!queriesFor('London Universities Purchasing Consortium').some((q) => /London Group/i.test(q)));
    assert.ok(queriesFor('KIER TRANSPORTATION LIMITED').some((q) => /group|plc/i.test(q)));
    const lupc = pickBestHit(
      [{ label: 'LONDON CARDIOLOGY GROUP LIMITED', description: 'company' }],
      'London Universities Purchasing Consortium',
      (h) => h.label,
    );
    assert.equal(lupc, null);
    const glider = pickBestHit(
      [{ label: 'Politechnika Warszawska PW-5', description: 'World Class glider' }],
      'Politechnika Warszawska',
      (h) => h.label,
    );
    assert.equal(glider, null);
  });

  it('tries https www before plain http', () => {
    const urls = websiteCandidates('http://www.stc.ac.uk');
    assert.equal(urls[0], 'https://www.stc.ac.uk/');
    assert.ok(urls.includes('http://www.stc.ac.uk/'));
  });
});

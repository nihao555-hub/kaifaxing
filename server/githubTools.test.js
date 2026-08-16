import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  registrableDomain,
  isAssetUrl,
  contactHrefs,
  parsePhones,
  pageTitle,
  fuseRank,
  wikidataSearchUrl,
} from './githubTools.js';

describe('github tools wrappers', () => {
  it('uses tldts for multi-part public suffixes', () => {
    assert.equal(registrableDomain('www.kier.co.uk'), 'kier.co.uk');
    assert.equal(registrableDomain('www.stc.ac.uk'), 'stc.ac.uk');
    assert.equal(registrableDomain('www.l3harris.com'), 'l3harris.com');
  });

  it('drops stylesheet and font urls', () => {
    assert.equal(isAssetUrl('https://www.stc.ac.uk/wp-content/plugins/contact-form-7/includes/css/styles.css?ver=6'), true);
    assert.equal(isAssetUrl('https://www.stc.ac.uk/contact/'), false);
  });

  it('reads contact links with cheerio and ignores css hrefs', () => {
    const html = `
      <a href="/contact">Contact</a>
      <link href="/wp-content/plugins/contact-form-7/styles.css" rel="stylesheet" />
      <a href="https://other.com/contact">no</a>
    `;
    const hrefs = contactHrefs(html, 'https://www.stc.ac.uk/');
    assert.ok(hrefs.some((u) => u.includes('/contact')));
    assert.ok(hrefs.every((u) => !u.endsWith('.css')));
  });

  it('parses phones with libphonenumber-js', () => {
    const phones = parsePhones('Call +44 191 427 3500', '<a href="tel:+441914273500">x</a>');
    assert.ok(phones.some((p) => p.includes('44') && p.includes('191')));
    const uae = parsePhones('Call 04-2383200 or +971 55 801 5796', '', 'AE');
    assert.ok(uae.some((p) => p.includes('971')));
  });

  it('reads the page title with cheerio', () => {
    assert.equal(pageTitle('<title>Contact - South Tyneside College</title>'), 'Contact - South Tyneside College');
  });

  it('ranks a close company name with Fuse.js', () => {
    const ranked = fuseRank('Kier Group', [{ label: 'Kier Group' }, { label: 'DE KIER' }], (h) => h.label);
    assert.equal(ranked[0].label, 'Kier Group');
  });

  it('builds Wikidata search URLs with wikibase-sdk', () => {
    const url = wikidataSearchUrl('Tyne Coast College');
    assert.match(url, /wikidata\.org/);
    assert.match(url, /Tyne/);
  });
});

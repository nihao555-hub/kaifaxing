import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  directoryTld,
  yellowPagesForCountry,
  isDirectoryHost,
  yellowPagesDorks,
  parseDirectoryListing,
  directorySearchUrls,
  listingLinksFromHtml,
} from './yellowPages.js';
import { researchDorks, pickOfficialSite, scoreResearchUrl } from './searchDorks.js';
import { selectSearchContactUrls } from './research.js';

const GELBE_FIXTURE = `
<html><head><title>Stadt Dornhan | Gelbe Seiten</title></head>
<body>
<script type="application/ld+json">
{"@type":"LocalBusiness","name":"Stadt Dornhan","url":"https://www.dornhan.de","email":"info@dornhan.de","telephone":"+49 7483 123"}
</script>
<a class="company-website" href="https://www.dornhan.de">Website</a>
<a href="mailto:info@gelbeseiten.de">Gelbe Seiten</a>
<p>Contact info@dornhan.de</p>
</body></html>
`;

describe('yellow pages directories', () => {
  it('maps Germany to Gelbe Seiten and keeps Europages', () => {
    assert.equal(directoryTld('Germany'), 'de');
    const dirs = yellowPagesForCountry('Germany');
    assert.equal(dirs[0].host, 'gelbeseiten.de');
    assert.ok(dirs.some((d) => d.host === 'northdata.de'));
    assert.equal(isDirectoryHost('https://www.gelbeseiten.de/gsbiz/stadt-dornhan'), true);
    assert.equal(isDirectoryHost('https://www.webvalid.de/company/Kaarster'), true);
    assert.equal(isDirectoryHost('https://www.dnb.com/business-directory/company-profiles.foo.html'), true);
    assert.equal(isDirectoryHost('https://www.dornhan.de/'), false);
  });

  it('adds a site: yellow-pages formula when the official site is unknown', () => {
    const q = researchDorks('Stadt Dornhan', { country: 'Germany' });
    assert.ok(q.some((s) => /site:gelbeseiten\.de/i.test(s)));
    assert.ok(q.some((s) => /site:northdata\.de/i.test(s)));
    assert.ok(!researchDorks('Stadt Dornhan', { website: 'https://www.dornhan.de', country: 'Germany' }).some((s) => /gelbeseiten/i.test(s)));
    const yp = yellowPagesDorks('NMG TECHNICAL SERVICE L.L.C', 'United Arab Emirates');
    assert.ok(yp.some((s) => /site:yellowpages\.ae/i.test(s)));
  });

  it('does not treat a directory card as the official website', () => {
    const official = pickOfficialSite(
      ['https://www.gelbeseiten.de/gsbiz/dornhan', 'https://www.dornhan.de/'],
      'Stadt Dornhan',
      [
        { url: 'https://www.gelbeseiten.de/gsbiz/dornhan', title: 'Stadt Dornhan | Gelbe Seiten' },
        { url: 'https://www.dornhan.de/', title: 'Stadt Dornhan – Startseite' },
      ],
      { country: 'Germany' },
    );
    assert.equal(official, 'https://www.dornhan.de/');
    assert.ok(scoreResearchUrl('https://www.gelbeseiten.de/gsbiz/dornhan') > scoreResearchUrl('https://www.dornhan.de/news'));
  });

  it('reads website and role mail from a public listing, not the directory inbox', () => {
    const listing = parseDirectoryListing(GELBE_FIXTURE, { pageUrl: 'https://www.gelbeseiten.de/gsbiz/stadt-dornhan' });
    assert.equal(listing.website, 'https://www.dornhan.de');
    assert.ok(listing.emails.includes('info@dornhan.de'));
    assert.ok(!listing.emails.includes('info@gelbeseiten.de'));
    assert.match(listing.phones.join(' '), /\+49|07455|123/);
    const junk = parseDirectoryListing('<p>ihre@firma.de example@example.com</p>', { pageUrl: 'https://www.gelbeseiten.de/x' });
    assert.equal(junk.emails.length, 0);
    assert.equal(listing.source, 'Gelbe Seiten');
    const picked = selectSearchContactUrls([
      'https://www.example.com/about',
      'https://www.gelbeseiten.de/gsbiz/stadt-dornhan',
    ]);
    assert.equal(picked[0], 'https://www.gelbeseiten.de/gsbiz/stadt-dornhan');
  });

  it('builds national directory search URLs and listing card links', () => {
    const urls = directorySearchUrls('Stadt Dornhan', 'Germany');
    assert.ok(urls.some((u) => /gelbeseiten\.de\/suche/i.test(u)));
    const links = listingLinksFromHtml(
      '<a href="/gsbiz/be98e8aa-18c2-478f-a836-ceaad10e0bfb">Stadt Dornhan</a><a href="https://www.surveymonkey.de/r/x">survey</a>',
      'https://www.gelbeseiten.de/suche/stadt%20dornhan/bundesweit',
    );
    assert.equal(links.length, 1);
    assert.match(links[0], /\/gsbiz\/be98e8aa/);
  });
});

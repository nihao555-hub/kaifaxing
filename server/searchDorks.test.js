import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  researchDorks,
  decodeBingUrl,
  isUsefulResearchUrl,
  scoreResearchUrl,
  parseSearchHtml,
  parseBingRss,
  pickOfficialSite,
  resultRelevant,
  emailsFromSnippets,
  countryTld,
  countrySearchTerms,
  rfqProductTerms,
  hostFitsCountry,
  buildSearchLinks,
} from './searchDorks.js';

const BING_FIXTURE = `
<html><body>
  <li class="b_algo">
    <h2><a href="https://www.stc.ac.uk/">Tyne Coast College</a></h2>
    <cite>https://www.stc.ac.uk</cite>
    <div class="b_caption"><p>Official college site. Email info@stc.ac.uk</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="/ck/a?uddg=https%3A%2F%2Fwww.stc.ac.uk%2Fcontact-us">Contact Tyne Coast College</a></h2>
    <cite>https://www.stc.ac.uk › contact-us</cite>
  </li>
  <li class="b_algo">
    <h2><a href="https://en.wikipedia.org/wiki/River_Tyne">River Tyne - Wikipedia</a></h2>
    <cite>https://en.wikipedia.org › wiki › River_Tyne</cite>
  </li>
  <a href="https://www.facebook.com/tynecoast">Facebook</a>
  <p>Email info@stc.ac.uk or procurement@stc.ac.uk</p>
</body></html>
`;

const GOOGLE_FIXTURE = `
<html><body>
  <a href="/url?q=https://www.quazartech.com/contact&amp;sa=U">Quazar Technologies contact</a>
  <a href="/url?q=https://www.linkedin.com/company/quazar&amp;sa=U">LinkedIn</a>
  <a href="/url?q=https://en.wikipedia.org/wiki/Quazar_Technologies&amp;sa=U">Quazar Technologies</a>
</body></html>
`;

const KIER_RSS = `
<rss><channel>
  <item><title>Home | Kier Group plc</title><link>https://www.kier.co.uk/</link><description>Kier Transportation and construction</description></item>
  <item><title>Udo Kier - IMDb</title><link>https://www.imdb.com/name/nm0001424/</link><description>Actor</description></item>
  <item><title>River Tyne - Wikipedia</title><link>https://en.wikipedia.org/wiki/River_Tyne</link><description>A river</description></item>
  <item><title>Kier Careers</title><link>https://jobs.kier.co.uk/</link><description>Jobs at Kier</description></item>
</channel></rss>
`;

const TYNE_JUNK_RSS = `
<rss><channel>
  <item><title>Wordle — The New York Times</title><link>https://www.nytimes.com/games/wordle/index.html</link><description>Daily word game</description></item>
  <item><title>River Tyne - Wikipedia</title><link>https://en.wikipedia.org/wiki/River_Tyne</link><description>The river Tyne</description></item>
  <item><title>The River Tyne | Tyne Rivers Trust</title><link>https://www.tyneriverstrust.org/the-river-tyne</link><description>Iconic river</description></item>
</channel></rss>
`;

describe('research dorks', () => {
  it('builds quoted contact / role-email / pdf formulas without a known site', () => {
    const q = researchDorks('Tyne Coast College');
    assert.ok(q.length >= 4);
    assert.ok(q[0].startsWith('"Tyne Coast College"'));
    assert.ok(/contact us|procurement|impressum/i.test(q[0]));
    assert.ok(/info@|procurement@/i.test(q[1]));
    assert.ok(q.some((s) => /filetype:pdf/i.test(s)));
    assert.ok(q.some((s) => /intitle:contact|email us/i.test(s)));
    assert.deepEqual(researchDorks(''), []);
  });

  it('adds a country TLD formula for Alibaba-style leads', () => {
    assert.equal(countryTld('United Arab Emirates'), 'ae');
    assert.ok(countrySearchTerms('United Arab Emirates').includes('UAE'));
    const q = researchDorks('NMG TECHNICAL SERVICE L.L.C', {
      country: 'United Arab Emirates',
      product: 'Chiller Compressor Refrigeration Spare Parts',
    });
    assert.ok(q[0].includes('UAE') || q[0].includes('Dubai'));
    assert.ok(q[0].startsWith('"NMG TECHNICAL SERVICE"'));
    assert.ok(q.some((s) => /site:\.ae/i.test(s)));
    assert.ok(q.some((s) => /Chiller|Compressor/i.test(s)));
    assert.deepEqual(rfqProductTerms('公开询盘：Chiller Compressor Refrigeration Spare Parts，数量 100 Piece'), ['Chiller', 'Compressor', 'Refrigeration']);
    assert.equal(hostFitsCountry('https://nmguae.com/', 'United Arab Emirates'), true);
    assert.equal(hostFitsCountry('https://www.nmggeo.com/', 'United Arab Emirates'), false);
  });

  it('adds site: and @domain formulas when the official website is known', () => {
    const q = researchDorks('Tyne Coast College', { website: 'https://www.stc.ac.uk' });
    assert.ok(q.some((s) => /site:stc\.ac\.uk/i.test(s)));
    assert.ok(q.some((s) => /"info@"|"sales@"/i.test(s)));
    assert.ok(!q.some((s) => /info@stc\.ac\.uk/i.test(s)));
    assert.ok(q[0].startsWith('site:stc.ac.uk'));
    assert.ok(q.some((s) => /filetype:pdf/i.test(s)));
  });

  it('builds clickable Google links for the same formulas', () => {
    const links = buildSearchLinks({
      company: 'NMG TECHNICAL SERVICE L.L.C',
      country: 'United Arab Emirates',
      product: 'Chiller',
    });
    assert.ok(links.length >= 2);
    assert.ok(links[0].google.startsWith('https://www.google.com/search?q='));
    assert.ok(links[0].query.includes('UAE') || links[0].query.includes('Dubai'));
  });
});

describe('search result URL filters', () => {
  it('keeps official and contact pages, drops social and river wikipedia', () => {
    assert.equal(isUsefulResearchUrl('https://www.stc.ac.uk/contact-us', 'Tyne Coast College'), true);
    assert.equal(isUsefulResearchUrl('https://www.facebook.com/tynecoast', 'Tyne Coast College'), false);
    assert.equal(isUsefulResearchUrl('https://en.wikipedia.org/wiki/River_Tyne', 'Tyne Coast College'), false);
    assert.equal(isUsefulResearchUrl('https://en.wikipedia.org/wiki/Tyne_Coast_College', 'Tyne Coast College'), true);
    assert.equal(isUsefulResearchUrl('https://www.stc.ac.uk/theme.css', 'Tyne Coast College'), false);
    assert.equal(isUsefulResearchUrl('https://www.xvideos.com/tags/oral', 'HOWOGE Wohnungsbaugesellschaft mbH'), false);
    assert.equal(isUsefulResearchUrl('https://sourcing.alibaba.com/rfq_detail.htm?rfqId=1', 'Quazar Technologies'), false);
  });

  it('scores contact pages above homepages', () => {
    assert.ok(scoreResearchUrl('https://www.stc.ac.uk/contact-us') > scoreResearchUrl('https://www.stc.ac.uk/'));
  });

  it('requires company evidence in title or distinctive host', () => {
    assert.equal(resultRelevant({ url: 'https://www.kier.co.uk/', title: 'Home | Kier Group plc' }, 'Kier Transportation Limited'), true);
    assert.equal(resultRelevant({ url: 'https://www.tyneriverstrust.org/', title: 'The River Tyne' }, 'Tyne Coast College'), false);
    assert.equal(resultRelevant({ url: 'https://www.nytimes.com/games/wordle', title: 'Wordle' }, 'Tyne Coast College'), false);
    assert.equal(resultRelevant({ url: 'https://www.stc.ac.uk/', title: 'Tyne Coast College' }, 'Tyne Coast College'), true);
  });
});

describe('bing / google html parse', () => {
  it('decodes bing ck/a and a1-base64 redirects', () => {
    assert.equal(
      decodeBingUrl('/ck/a?uddg=https%3A%2F%2Fwww.stc.ac.uk%2Fcontact-us'),
      'https://www.stc.ac.uk/contact-us'
    );
    const encoded = Buffer.from('https://www.stc.ac.uk/about').toString('base64');
    assert.equal(decodeBingUrl(`/ck/a?u=a1${encoded}`), 'https://www.stc.ac.uk/about');
    assert.equal(
      decodeBingUrl('/url?q=https://www.quazartech.com/contact&sa=U'),
      'https://www.quazartech.com/contact'
    );
    assert.equal(
      decodeBingUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fnmguae.com%2Fcontact'),
      'https://nmguae.com/contact'
    );
  });

  it('parses DuckDuckGo html results', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnmguae.com%2F">NMG Technical Services Dubai</a>
        <a class="result__snippet">HVAC in UAE. Email info@nmguae.com</a>
      </div>`;
    const { urls, snippetEmails } = parseSearchHtml(html, 'NMG TECHNICAL SERVICE L.L.C', {
      country: 'United Arab Emirates',
    });
    assert.ok(urls.includes('https://nmguae.com/'));
    assert.ok(snippetEmails.includes('info@nmguae.com'));
  });

  it('parses bing cites and keeps role emails from snippets', () => {
    const { urls, snippetEmails } = parseSearchHtml(BING_FIXTURE, 'Tyne Coast College');
    assert.ok(urls.includes('https://www.stc.ac.uk/'));
    assert.ok(urls.includes('https://www.stc.ac.uk/contact-us'));
    assert.ok(!urls.some((u) => /wikipedia\.org\/wiki\/River_Tyne/i.test(u)));
    assert.ok(!urls.some((u) => /facebook\.com/i.test(u)));
    assert.ok(snippetEmails.includes('info@stc.ac.uk'));
    assert.ok(snippetEmails.includes('procurement@stc.ac.uk'));
  });

  it('does not treat query-echoed role mail as a search snippet', () => {
    const query = '"Tyne Coast College" (info@stc.ac.uk OR sales@stc.ac.uk)';
    const html = `
      <html><body>
        <form><input value="${query}" /></form>
        <p>Try info@stc.ac.uk or sales@stc.ac.uk</p>
        <li class="b_algo">
          <h2><a href="https://www.stc.ac.uk/contact">Contact</a></h2>
          <div class="b_caption"><p>Write to procurement@stc.ac.uk</p></div>
        </li>
      </body></html>`;
    const { snippetEmails } = parseSearchHtml(html, 'Tyne Coast College', { query });
    assert.ok(snippetEmails.includes('procurement@stc.ac.uk'));
    assert.ok(!snippetEmails.includes('info@stc.ac.uk'));
    assert.ok(!snippetEmails.includes('sales@stc.ac.uk'));
    assert.deepEqual(
      emailsFromSnippets(['Contact info@stc.ac.uk'], { query }),
      []
    );
  });

  it('parses google /url?q= results and drops linkedin', () => {
    const { urls } = parseSearchHtml(GOOGLE_FIXTURE, 'Quazar Technologies');
    assert.ok(urls.includes('https://www.quazartech.com/contact'));
    assert.ok(urls.includes('https://en.wikipedia.org/wiki/Quazar_Technologies'));
    assert.ok(!urls.some((u) => /linkedin/i.test(u)));
  });

  it('picks an official-looking site from mixed hits', () => {
    const guess = pickOfficialSite(
      [
        'https://en.wikipedia.org/wiki/Tyne_Coast_College',
        'https://www.stc.ac.uk/',
        'https://www.stc.ac.uk/contact-us',
      ],
      'Tyne Coast College',
      [
        { url: 'https://www.stc.ac.uk/', title: 'Tyne Coast College' },
        { url: 'https://www.stc.ac.uk/contact-us', title: 'Contact Tyne Coast College' },
        { url: 'https://en.wikipedia.org/wiki/Tyne_Coast_College', title: 'Tyne Coast College - Wikipedia' },
      ]
    );
    assert.equal(guess, 'https://www.stc.ac.uk/');
  });

  it('prefers a country-matching host over a same-brand foreign site', () => {
    const guess = pickOfficialSite(
      ['https://www.nmggeo.com/', 'https://nmguae.com/'],
      'NMG TECHNICAL SERVICE L.L.C',
      [
        { url: 'https://www.nmggeo.com/', title: 'NMG Geo' },
        { url: 'https://nmguae.com/', title: 'NMG Technical Services Dubai UAE' },
      ],
      { country: 'United Arab Emirates' }
    );
    assert.equal(guess, 'https://nmguae.com/');
  });
});

describe('bing rss parse', () => {
  it('keeps Kier official pages and drops actor / river junk', () => {
    const { urls } = parseBingRss(KIER_RSS, 'Kier Transportation Limited');
    assert.ok(urls.includes('https://www.kier.co.uk/'));
    assert.ok(urls.includes('https://jobs.kier.co.uk/'));
    assert.ok(!urls.some((u) => /imdb|River_Tyne/i.test(u)));
  });

  it('drops Wordle and river pages for Tyne Coast College', () => {
    const { urls } = parseBingRss(TYNE_JUNK_RSS, 'Tyne Coast College');
    assert.deepEqual(urls, []);
    assert.equal(pickOfficialSite(urls, 'Tyne Coast College'), '');
  });

  it('keeps a same-site Contact us title when siteHost is known', () => {
    const rss = `
<rss><channel>
  <item><title>Contact us</title><link>https://www.stc.ac.uk/contact</link><description>Get in touch</description></item>
  <item><title>Wordle</title><link>https://www.nytimes.com/games/wordle</link><description>Daily game</description></item>
</channel></rss>`;
    const { urls } = parseBingRss(rss, 'Tyne Coast College', { siteHost: 'stc.ac.uk' });
    assert.ok(urls.includes('https://www.stc.ac.uk/contact'));
    assert.ok(!urls.some((u) => /wordle/i.test(u)));
    const dropped = parseBingRss(rss, 'Tyne Coast College');
    assert.ok(!dropped.urls.includes('https://www.stc.ac.uk/contact'));
  });
});

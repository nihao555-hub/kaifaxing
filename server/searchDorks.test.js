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
  it('builds quoted contact / role-email / official-site formulas', () => {
    const q = researchDorks('Tyne Coast College');
    assert.equal(q.length, 3);
    assert.ok(q[0].startsWith('"Tyne Coast College"'));
    assert.ok(/contact us|procurement|impressum/i.test(q[0]));
    assert.ok(/info@|procurement@/i.test(q[1]));
    assert.ok(/official|about us/i.test(q[2]));
    assert.deepEqual(researchDorks(''), []);
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
});

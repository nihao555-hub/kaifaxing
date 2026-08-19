import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_GUESS_REFUSAL,
  isEmailGuessRequest,
  isDistinctivePersonName,
  snippetMentionsPerson,
  filterNamedHits,
  peopleSearchQueries,
  probePeopleCompany,
} from './peopleProbe.js';

describe('people probe guards', () => {
  it('refuses Hunter-style email guessing', () => {
    assert.equal(isEmailGuessRequest({ guessEmail: true }), true);
    assert.equal(isEmailGuessRequest({ pattern: 'first.last@gmail.com' }), true);
    assert.equal(isEmailGuessRequest({ hunter: true }), true);
    assert.equal(isEmailGuessRequest({ company: 'Sahel Tools Ltd' }), false);
    assert.match(EMAIL_GUESS_REFUSAL, /Hunter/);
  });

  it('only treats 2–4 word distinctive names as people-search candidates', () => {
    assert.equal(isDistinctivePersonName('Ajay Vaishnavi'), true);
    assert.equal(isDistinctivePersonName('Migle Andriuskeviciute'), true);
    assert.equal(isDistinctivePersonName('Linda N'), false);
    assert.equal(isDistinctivePersonName('Linda'), false);
    assert.equal(isDistinctivePersonName('Kutumb Ecommerceprivatelimited'), false);
  });

  it('requires the full name in the snippet before trusting a company', () => {
    assert.equal(
      snippetMentionsPerson('Ajay Vaishnavi', 'Ajay Vaishnavi joined Contoso Ltd in Pune'),
      true,
    );
    assert.equal(
      snippetMentionsPerson('Ajay Vaishnavi', 'Ajay Devgn biography and film career'),
      false,
    );
    const named = filterNamedHits([
      { title: 'Planet Fitness Brooklyn', desc: 'Join now' },
      { title: 'Migle Andriuskeviciute — Contoso Ltd', desc: 'Buyer at Contoso Ltd, United Kingdom' },
    ], 'Migle Andriuskeviciute');
    assert.equal(named.length, 1);
  });
});

describe('probePeopleCompany', () => {
  it('extracts a legal name only from named hits', async () => {
    const probe = await probePeopleCompany(
      { name: 'Migle Andriuskeviciute', country: 'United Kingdom' },
      {
        search: async () => ({
          engine: 'test',
          json: {
            items: [
              { title: 'Planet Fitness', link: 'https://planetfitness.com', snippet: 'Gym in Brooklyn' },
              {
                title: 'Migle Andriuskeviciute | Contoso Kitchen Ltd',
                link: 'https://contoso.example/team',
                snippet: 'Migle Andriuskeviciute, buyer at Contoso Kitchen Ltd in the United Kingdom',
              },
            ],
          },
        }),
      },
    );
    assert.equal(probe.tried, true);
    assert.equal(probe.namedHits, 1);
    assert.equal(probe.company, 'Contoso Kitchen Ltd');
    assert.ok(!JSON.stringify(probe).includes('@gmail'));
  });

  it('returns no company when Bing-like junk has no name overlap', async () => {
    const probe = await probePeopleCompany(
      { name: 'Magnus Brattaberg', country: 'Faroe Islands' },
      {
        search: async () => ({
          engine: 'bing',
          json: {
            items: [
              { title: 'Magnus Health', link: 'https://magnushealth.com', snippet: 'Student health software' },
              { title: 'Magnus Carlsen', link: 'https://chess.com', snippet: 'World champion' },
            ],
          },
        }),
      },
    );
    assert.equal(probe.namedHits, 0);
    assert.equal(probe.company, '');
    assert.match(probe.note, /重名|没有/);
  });

  it('builds quoted people queries and skips common first names', () => {
    const qs = peopleSearchQueries('Ajay Vaishnavi', 'India');
    assert.ok(qs[0].includes('"Ajay Vaishnavi"'));
    assert.ok(qs[0].includes('India'));
    assert.deepEqual(peopleSearchQueries(''), []);
  });
});

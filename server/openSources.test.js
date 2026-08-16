import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSireneHit,
  parseBrregHit,
  parseRorHit,
  pickOpenHit,
  shouldQuerySirene,
  shouldQueryBrreg,
  shouldQueryPrh,
  shouldQueryAres,
  shouldQueryUk,
  parseCompaniesHouseHit,
  countryIs,
} from './openSources.js';

describe('open sources', () => {
  it('parses a Sirene company card', () => {
    const hit = parseSireneHit({
      nom_complet: 'TOTALENERGIES MARKETING FRANCE',
      siren: '531680445',
      siege: { adresse: '562 AVENUE DU PARC DE L ILE', code_postal: '92000', libelle_commune: 'NANTERRE' },
      libelle_activite_principale: 'Commerce de combustibles',
      tranche_effectif_salarie: '50-99',
    });
    assert.equal(hit.siren, '531680445');
    assert.match(hit.address, /NANTERRE/);
    assert.equal(hit.activity, 'Commerce de combustibles');
  });

  it('parses a Brreg company card', () => {
    const hit = parseBrregHit({
      navn: 'EQUINOR ASA',
      organisasjonsnummer: '923609016',
      hjemmeside: 'www.equinor.com',
      antallAnsatte: 21239,
      naeringskode1: { beskrivelse: 'Utvinning av råolje' },
      forretningsadresse: { adresse: ['Forusbeen 50'], postnummer: '4035', poststed: 'STAVANGER', land: 'Norge' },
    });
    assert.equal(hit.orgnr, '923609016');
    assert.equal(hit.website, 'https://www.equinor.com');
    assert.equal(hit.employees, '21239');
  });

  it('parses ROR v2 organization cards', () => {
    const hit = parseRorHit({
      id: 'https://ror.org/00pz2dk38',
      names: [{ types: ['ror_display', 'label'], value: 'Orange Coast College' }],
      links: [{ type: 'website', value: 'https://www.orangecoastcollege.edu' }],
      types: ['education'],
    });
    assert.equal(hit.name, 'Orange Coast College');
    assert.equal(hit.ror, '00pz2dk38');
    assert.equal(hit.website, 'https://www.orangecoastcollege.edu');
  });

  it('rejects a look-alike ROR hit that misses the distinctive token', () => {
    const picked = pickOpenHit(
      [
        { names: [{ types: ['ror_display'], value: 'Orange Coast College' }] },
        { names: [{ types: ['ror_display'], value: 'Coast Mountain College' }] },
      ],
      'Tyne Coast College',
      (h) => parseRorHit(h)?.name || ''
    );
    assert.equal(picked, null);
  });

  it('accepts an exact-enough registry name', () => {
    const picked = pickOpenHit(
      [{ navn: 'EQUINOR ASA' }, { navn: 'EQUINOR ENERGY AS' }],
      'Equinor ASA',
      (h) => h.navn
    );
    assert.equal(picked.navn, 'EQUINOR ASA');
  });

  it('only queries national registers for the matching country', () => {
    assert.equal(shouldQuerySirene('法国', ''), true);
    assert.equal(shouldQuerySirene('Germany', 'DE'), false);
    assert.equal(shouldQuerySirene('', 'FR'), true);
    assert.equal(shouldQueryBrreg('挪威', ''), true);
    assert.equal(shouldQueryBrreg('France', 'FR'), false);
    assert.equal(countryIs('United Kingdom', '', ['uk', 'united kingdom', '英国']), true);
    assert.equal(shouldQueryPrh('芬兰', ''), true);
    assert.equal(shouldQueryPrh('France', 'FR'), false);
    assert.equal(shouldQueryAres('Czechia', ''), true);
    assert.equal(shouldQueryAres('挪威', ''), false);
    assert.equal(shouldQueryUk('英国', ''), true);
    assert.equal(shouldQueryUk('United Kingdom', ''), true);
    assert.equal(shouldQueryUk('UK', ''), true);
    assert.equal(shouldQueryUk('Ukraine', ''), false);
    assert.equal(shouldQueryUk('法国', ''), false);
  });

  it('parses a Companies House search hit', () => {
    const hit = parseCompaniesHouseHit({
      title: 'TYNE COAST COLLEGE',
      company_number: '10005999',
      company_status: 'active',
      address: { address_line_1: 'St Georges Avenue', locality: 'South Shields', postal_code: 'NE34 6ET', country: 'United Kingdom' },
    });
    assert.equal(hit.name, 'TYNE COAST COLLEGE');
    assert.equal(hit.number, '10005999');
    assert.equal(hit.status, 'active');
    assert.match(hit.address, /South Shields/);
  });
});

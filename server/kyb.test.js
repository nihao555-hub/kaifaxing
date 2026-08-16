import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeKyb, hasVerifiedEntity, hasProcurementTrace, isForwarderName } from './kyb.js';
import { matchSanctionNames } from './sanctions.js';
import { parseUsaSpendingHit } from './tradeTraces.js';

describe('kyb grade', () => {
  it('marks nickname leads as C and asks for a registration number', () => {
    const k = gradeKyb({ personLike: true });
    assert.equal(k.grade, 'C');
    assert.equal(k.needRegNo, true);
    assert.match(k.nextAction, /法定全称|登记号/);
  });

  it('stops on sanctions even if a role email exists', () => {
    const k = gradeKyb({
      verified: true,
      website: 'https://rosneft.com',
      emails: [{ email: 'info@rosneft.com' }],
      sanctions: [{ name: 'Rosneft Oil Company', list: 'OFAC SDN' }],
    });
    assert.equal(k.grade, 'C');
    assert.match(k.nextAction, /制裁/);
  });

  it('gives A only when entity, website and role email are all present', () => {
    const a = gradeKyb({
      verified: true,
      website: 'https://www.stc.ac.uk',
      emails: [{ email: 'info@stc.ac.uk' }],
      procurement: true,
    });
    assert.equal(a.grade, 'A');
    const b = gradeKyb({
      verified: true,
      website: 'https://www.l3harris.com',
      emails: [],
    });
    assert.equal(b.grade, 'B');
    assert.match(b.nextAction, /表单/);
    const irOnly = gradeKyb({
      verified: true,
      website: 'https://www.kier.co.uk',
      emails: [{ email: 'ir@kier.co.uk', role: 'ir' }],
      procurement: true,
    });
    assert.equal(irOnly.grade, 'B');
    assert.match(irOnly.nextAction, /表单/);
  });

  it('asks for a registry number when the legal entity is missing', () => {
    const k = gradeKyb({ verified: false, website: '', emails: [], legalName: 'Quest LLC' });
    assert.equal(k.grade, 'C');
    assert.equal(k.needRegNo, true);
  });

  it('flags freight forwarders', () => {
    assert.equal(isForwarderName('ABC Freight Forwarding Ltd'), true);
    assert.equal(hasVerifiedEntity([{ source: 'GLEIF', label: 'LEI', value: '1' }]), true);
    assert.equal(hasProcurementTrace({ source: 'USASpending', sourceUrl: 'https://x' }, []), true);
  });
});

describe('sanctions match', () => {
  const rows = [
    { name: 'Rosneft Oil Company', list: 'OFAC SDN' },
    { name: 'Oil Company Rosneft', list: 'OFAC SDN' },
    { name: 'Myanmar Yatai International Holding Group Co., LTD.', list: 'OFAC SDN' },
  ];

  it('hits a distinctive sanctioned company and ignores short brand tokens', () => {
    const hits = matchSanctionNames('Rosneft Oil Company', rows);
    assert.ok(hits.some((h) => /rosneft/i.test(h.name)));
    assert.deepEqual(matchSanctionNames('Kier Transportation Limited', rows), []);
    assert.deepEqual(matchSanctionNames('Tyne Coast College', rows), []);
    assert.deepEqual(matchSanctionNames('Yatai Smart', rows), []);
    assert.deepEqual(
      matchSanctionNames('Kier Transportation Limited', [
        { name: 'Universal Shipping and Transportation Limited', list: 'OFAC SDN' },
      ]),
      []
    );
    assert.deepEqual(
      matchSanctionNames('NMG TECHNICAL SERVICE L.L.C', [
        { name: 'LIMITED LIABILITY COMPANY TMK TECHNICAL SERVICE', list: 'OFAC SDN' },
        { name: 'AHWAZ STEEL COMMERCIAL & TECHNICAL SERVICE GMBH ASCOTEC', list: 'OFAC SDN' },
      ]),
      []
    );
  });
});

describe('trade traces', () => {
  it('reads a USASpending recipient card', () => {
    const hit = parseUsaSpendingHit({ recipient_name: 'L3HARRIS TECHNOLOGIES, INC.', uei: 'ABC' });
    assert.equal(hit.name, 'L3HARRIS TECHNOLOGIES, INC.');
    assert.match(hit.url, /usaspending\.gov/);
  });
});

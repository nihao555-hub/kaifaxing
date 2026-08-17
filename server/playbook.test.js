import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bestNext, PLAYBOOK_STEPS } from './playbook.js';

describe('bestNext playbook', () => {
  it('sends Alibaba nicknames to seller export, not Gmail guessing', () => {
    const step = bestNext({
      source: '阿里国际站公开 RFQ',
      company: 'Linda N',
      name: 'Linda N',
      country: 'Netherlands',
      publicCard: { buyerName: 'Linda N', subject: 'hoodies' },
      painPoints: 'Need hoodies',
    });
    assert.equal(step.key, 'seller');
    assert.match(step.next, /询盘 ID|后台导出/);
  });

  it('researches a legal name and harvests when a website exists', () => {
    const research = bestNext({
      company: 'NMG TECHNICAL SERVICE L.L.C',
      name: 'NMG TECHNICAL SERVICE L.L.C',
      country: 'United Arab Emirates',
      forceCompany: true,
    });
    assert.equal(research.key, 'research');
    const harvest = bestNext({
      company: 'NMG TECHNICAL SERVICE L.L.C',
      forceCompany: true,
      website: 'https://nmguae.com',
    });
    assert.equal(harvest.key, 'harvest');
    assert.match(harvest.next, /SMTP|角色/);
  });

  it('uses seller-unlocked mail then KYB, and stops on sanctions', () => {
    const unlocked = bestNext({
      source: '阿里国际站公开 RFQ',
      company: 'Sahel Tools Ltd',
      forceCompany: true,
      email: 'buy@sahel.example',
      contactSource: 'alibaba_seller',
      identitySource: 'alibaba_seller',
    });
    assert.equal(unlocked.key, 'kyb');
    const banned = bestNext({
      company: 'Rosneft',
      forceCompany: true,
      research: { kyb: { sanctions: [{ name: 'Rosneft' }] } },
    });
    assert.equal(banned.key, 'stop');
    assert.ok(PLAYBOOK_STEPS.some((s) => s.key === 'seller'));
  });
});

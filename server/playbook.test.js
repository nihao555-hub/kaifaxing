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

  it('finds the official site and phone before harvesting role mail', () => {
    const site = bestNext({
      company: 'NMG TECHNICAL SERVICE L.L.C',
      name: 'NMG TECHNICAL SERVICE L.L.C',
      country: 'United Arab Emirates',
      forceCompany: true,
    });
    assert.equal(site.key, 'site');
    assert.match(site.next, /官网|电话|黄页/);
    const harvest = bestNext({
      company: 'NMG TECHNICAL SERVICE L.L.C',
      forceCompany: true,
      website: 'https://nmguae.com',
    });
    assert.equal(harvest.key, 'harvest');
    assert.match(harvest.next, /SMTP|角色/);
  });
  it('lists site-then-email before Alibaba seller export', () => {
    assert.ok(PLAYBOOK_STEPS.some((s) => s.key === 'site'));
    assert.ok(PLAYBOOK_STEPS.some((s) => s.key === 'email'));
    const keys = PLAYBOOK_STEPS.map((s) => s.key);
    assert.ok(keys.indexOf('site') < keys.indexOf('email'));
    assert.ok(keys.indexOf('email') < keys.indexOf('seller'));
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

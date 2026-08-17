import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { beijingDate, beijingHour, pickAutoEmail, isForwarderName, researchPriority, summarizeKybPlan, leadQueuePath } from './pipeline.js';
import { compactSkippedReport } from './research.js';

describe('pipeline schedule', () => {
  it('formats Beijing calendar date', () => {
    assert.match(beijingDate(new Date('2026-08-16T00:30:00.000Z')), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(beijingDate(new Date('2026-08-16T00:30:00.000Z')), '2026-08-16');
  });

  it('reads Beijing hour', () => {
    const hour = beijingHour(new Date('2026-08-16T00:30:00.000Z'));
    assert.equal(hour, 8);
  });
});

describe('auto apply rules', () => {
  it('picks info/procurement and skips IR', () => {
    const picked = pickAutoEmail({
      confidence: 'high',
      facts: [{ source: 'GLEIF', label: 'LEI', value: '1' }],
      emails: [
        { email: 'ir@kier.co.uk', role: 'ir', score: 80 },
        { email: 'info@stc.ac.uk', role: 'info', score: 96 },
      ],
    });
    assert.equal(picked.email, 'info@stc.ac.uk');
    assert.equal(pickAutoEmail({
      confidence: 'high',
      facts: [{ source: 'GLEIF', label: 'LEI', value: '1' }],
      emails: [{ email: 'ir@kier.co.uk', role: 'ir', score: 80 }],
    }), null);
    assert.equal(pickAutoEmail({
      confidence: 'high',
      facts: [{ source: 'GLEIF', label: 'LEI', value: '1' }],
      emails: [{ email: 'info@stc.ac.uk', role: 'info', score: 96, evidence: { ready: true, score: 90 } }],
    })?.email, 'info@stc.ac.uk');
    assert.equal(pickAutoEmail({
      confidence: 'high',
      facts: [],
      emails: [{ email: 'info@chrisvoorkom.nl', role: 'info', score: 96 }],
    }), null);
    assert.equal(pickAutoEmail({
      confidence: 'high',
      facts: [{ source: 'ROR', label: 'ROR 机构库', value: 'Tyne Coast College' }],
      emails: [{ email: 'info@stc.ac.uk', role: 'info', score: 96 }],
    })?.email, 'info@stc.ac.uk');
    assert.equal(pickAutoEmail({
      confidence: 'high',
      kyb: { grade: 'C', sanctions: [{ name: 'Rosneft', list: 'OFAC SDN' }] },
      facts: [{ source: 'GLEIF', label: 'LEI', value: '1' }],
      emails: [{ email: 'info@rosneft.com', role: 'info', score: 96 }],
    }), null);
  });

  it('flags freight forwarders', () => {
    assert.equal(isForwarderName('ABC Freight Forwarding Ltd'), true);
    assert.equal(isForwarderName('Tyne Coast College'), false);
  });

  it('queues TED and UK buyers ahead of World Bank project titles', () => {
    assert.ok(researchPriority({ source: 'TED Europa', company: 'HOWOGE Wohnungsbaugesellschaft mbH' })
      < researchPriority({ source: 'USASpending.gov', company: 'THE BOEING COMPANY' }));
    assert.ok(researchPriority({ source: 'USASpending.gov', company: 'THE BOEING COMPANY' })
      < researchPriority({ source: 'World Bank', company: 'Assam: School Education' }));
    assert.ok(researchPriority({ source: 'Alibaba 公开询盘', researchPath: 'clues' })
      < researchPriority({ source: 'Alibaba 公开询盘', researchPath: 'crosspost' }));
  });

  it('counts only live KYB paths as researchable', () => {
    const plan = summarizeKybPlan([
      { source: 'TED Europa', company: 'HOWOGE Wohnungsbaugesellschaft mbH', researchPath: 'auto' },
      { source: 'Alibaba 公开询盘', company: 'Titanlink Industrial LLC', researchPath: 'auto', identitySource: 'rfq_text' },
      { source: 'Alibaba 公开询盘', company: 'Abdi Muse', researchPath: 'crosspost' },
      { source: 'Alibaba 公开询盘', company: 'Linda N', researchPath: 'import' },
      { source: 'Alibaba 公开询盘', company: 'Jack', website: 'https://nmguae.com', researchPath: 'clues' },
    ]);
    assert.equal(plan.total, 5);
    assert.equal(plan.auto, 2);
    assert.equal(plan.clues, 1);
    assert.equal(plan.crosspost, 1);
    assert.equal(plan.import, 1);
    assert.equal(plan.live, 4);
    assert.equal(plan.government, 1);
    assert.equal(plan.textHint, 1);
    assert.equal(plan.hasWebsite, 1);
  });

  it('keeps the best pass on legal-name and clue paths', () => {
    assert.equal(leadQueuePath({ company: 'NMG TECHNICAL SERVICE L.L.C', researchPath: 'auto' }), 'auto');
    assert.equal(leadQueuePath({ company: 'Jack', website: 'https://nmguae.com', researchPath: 'clues' }), 'clues');
    assert.equal(leadQueuePath({ company: 'Abdi Muse', researchPath: 'crosspost' }), 'crosspost');
    assert.equal(leadQueuePath({ company: 'Linda N', name: 'Linda N' }), 'import');
    const best = new Set(['auto', 'clues']);
    assert.equal(best.has(leadQueuePath({ researchPath: 'auto' })), true);
    assert.equal(best.has(leadQueuePath({ researchPath: 'crosspost' })), false);
  });

  it('uses a compact C report for nickname mass KYB', () => {
    const report = compactSkippedReport({ company: 'Linda N', country: 'Netherlands' });
    assert.equal(report.grade, 'C');
    assert.equal(report.steps, undefined);
    assert.ok(!('searchLinks' in report));
    assert.ok(JSON.stringify(report).length < 600);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { beijingDate, beijingHour, pickAutoEmail, isForwarderName } from './pipeline.js';

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
      emails: [
        { email: 'ir@kier.co.uk', role: 'ir', score: 80 },
        { email: 'info@stc.ac.uk', role: 'info', score: 96 },
      ],
    });
    assert.equal(picked.email, 'info@stc.ac.uk');
    assert.equal(pickAutoEmail({ confidence: 'high', emails: [{ email: 'ir@kier.co.uk', role: 'ir', score: 80 }] }), null);
    assert.equal(pickAutoEmail({ confidence: 'none', emails: [{ email: 'info@stc.ac.uk', role: 'info', score: 96 }] }), null);
  });

  it('flags freight forwarders', () => {
    assert.equal(isForwarderName('ABC Freight Forwarding Ltd'), true);
    assert.equal(isForwarderName('Tyne Coast College'), false);
  });
});

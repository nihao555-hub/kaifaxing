import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { classifySmtpCode, parseSmtpReply, verifyMailboxes } from './smtpVerify.js';

describe('smtp reply parse', () => {
  it('reads the last line of a multiline 250', () => {
    const parsed = parseSmtpReply('250-mx.example.com Hello\r\n250 OK\r\n');
    assert.equal(parsed.code, 250);
    assert.equal(parsed.more, false);
    assert.equal(parsed.status, 'accepted');
    assert.equal(classifySmtpCode(550), 'rejected');
    assert.equal(classifySmtpCode(450), 'tempfail');
  });
});

function mockConnect(replies) {
  return () => {
    const socket = new EventEmitter();
    let i = 0;
    let armed = false;
    socket.on('newListener', (ev) => {
      if (ev === 'data' && !armed) {
        armed = true;
        setImmediate(() => socket.emit('data', replies[0]));
      }
    });
    socket.write = () => {
      i += 1;
      const line = replies[i] || '250 ok\r\n';
      setImmediate(() => socket.emit('data', line));
    };
    socket.destroy = () => {};
    return socket;
  };
}

describe('verifyMailboxes', () => {
  it('treats catch-all domains as unproven', async () => {
    const probe = await verifyMailboxes(['info@acme.example'], {
      resolveMx: async () => [{ exchange: 'mx.acme.example', priority: 10 }],
      connect: mockConnect([
        '220 mx ESMTP\r\n',
        '250 OK\r\n',
        '250 sender ok\r\n',
        '250 2.1.5 accept anyone\r\n',
      ]),
      catchAll: 'no-box-test',
    });
    assert.equal(probe.catchAll, true);
    assert.equal(probe.results[0].status, 'catch_all');
  });

  it('accepts a role box after the bait address is rejected', async () => {
    const probe = await verifyMailboxes(['info@acme.example', 'sales@acme.example'], {
      resolveMx: async () => [{ exchange: 'mx.acme.example', priority: 10 }],
      connect: mockConnect([
        '220 mx ESMTP\r\n',
        '250 OK\r\n',
        '250 sender ok\r\n',
        '550 5.1.1 unknown\r\n',
        '250 2.1.5 ok\r\n',
        '550 5.1.1 unknown\r\n',
      ]),
      catchAll: 'no-box-test',
    });
    assert.equal(probe.catchAll, false);
    assert.equal(probe.results.find((r) => r.email === 'info@acme.example').status, 'accepted');
    assert.equal(probe.results.find((r) => r.email === 'sales@acme.example').status, 'rejected');
  });

  it('marks blocked when the socket cannot connect', async () => {
    const probe = await verifyMailboxes(['info@acme.example'], {
      resolveMx: async () => [{ exchange: 'mx.acme.example', priority: 10 }],
      connect: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    assert.equal(probe.results[0].status, 'blocked');
  });
});

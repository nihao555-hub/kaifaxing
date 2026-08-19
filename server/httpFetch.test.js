import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableFetchError } from './httpFetch.js';

describe('httpFetch retries', () => {
  it('flags transient network errors', () => {
    assert.equal(isRetryableFetchError('fetch failed'), true);
    assert.equal(isRetryableFetchError('read ECONNRESET'), true);
    assert.equal(isRetryableFetchError('HTTP 403 Forbidden'), false);
  });
});

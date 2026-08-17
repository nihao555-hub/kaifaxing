import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  config,
  googleCseReady,
  officialSearchReady,
  preferredSearchEngine,
  normalizeSearchEngine,
  googleSearchStatus,
} from './config.js';

describe('search engine preference', () => {
  const prev = { ...config.google };
  afterEach(() => {
    Object.assign(config.google, prev);
  });

  it('normalizes unknown values to google', () => {
    assert.equal(normalizeSearchEngine(''), 'google');
    assert.equal(normalizeSearchEngine('GOOGLE'), 'google');
    assert.equal(normalizeSearchEngine('auto'), 'auto');
    assert.equal(normalizeSearchEngine('serper'), 'serper');
  });

  it('google-only does not treat a Serper key as ready', () => {
    config.google.engine = 'google';
    config.google.apiKey = '';
    config.google.cseId = '';
    config.google.serperKey = 'dummy-serper';
    assert.equal(preferredSearchEngine(), 'google');
    assert.equal(googleCseReady(), false);
    assert.equal(officialSearchReady(), false);
    const status = googleSearchStatus();
    assert.equal(status.needCse, true);
    assert.match(status.setup, /验证码|必应|DuckDuckGo|GOOGLE_CSE_ID/);
  });

  it('google-only is ready when CSE key and CX are set', () => {
    config.google.engine = 'google';
    config.google.apiKey = 'test-key';
    config.google.cseId = 'test-cx';
    config.google.serperKey = 'dummy-serper';
    assert.equal(officialSearchReady(), true);
    assert.equal(googleSearchStatus().needCse, false);
  });

  it('auto falls back to Serper when CSE is missing', () => {
    config.google.engine = 'auto';
    config.google.apiKey = '';
    config.google.cseId = '';
    config.google.serperKey = 'dummy-serper';
    assert.equal(officialSearchReady(), true);
  });
});

/**
 * WhatsApp link building contract.
 *
 * wa.me links only work with a full international number (no '+'). The store
 * setting is free text edited in mart-hub, so it may arrive with a '+', spaces,
 * or no country code at all — all of which used to produce a dead link that
 * WhatsApp rejects with "phone number is not on WhatsApp".
 *
 * Node's built-in runner via tsx, same as the other suites.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeWhatsAppNumber, buildWhatsAppLink } = await import('../src/utils/whatsapp');

describe('normalizeWhatsAppNumber', () => {
  test('a 10-digit Indian mobile gets the country code prepended', () => {
    assert.equal(normalizeWhatsAppNumber('8777376280'), '918777376280');
  });

  test('strips +, spaces and dashes', () => {
    assert.equal(normalizeWhatsAppNumber('+91 8777-376280'), '918777376280');
  });

  test('an already-cc-prefixed number is left alone', () => {
    assert.equal(normalizeWhatsAppNumber('918777376280'), '918777376280');
  });

  test('foreign country codes (11+ digits) pass through untouched', () => {
    assert.equal(normalizeWhatsAppNumber('14155552671'), '14155552671');
  });

  test('empty / missing / garbage input yields empty string', () => {
    assert.equal(normalizeWhatsAppNumber(''), '');
    assert.equal(normalizeWhatsAppNumber(null), '');
    assert.equal(normalizeWhatsAppNumber(undefined), '');
    assert.equal(normalizeWhatsAppNumber('abc'), '');
  });
});

describe('buildWhatsAppLink', () => {
  test('builds a clean wa.me URL with the country code', () => {
    assert.equal(buildWhatsAppLink('8777376280'), 'https://wa.me/918777376280');
  });

  test('appends an encoded text parameter when a message is given', () => {
    const link = buildWhatsAppLink('8777376280', 'Need help with Order #12.');
    assert.equal(link, 'https://wa.me/918777376280?text=Need%20help%20with%20Order%20%2312.');
  });

  test('returns empty string for an unusable number (link is hidden, not broken)', () => {
    assert.equal(buildWhatsAppLink(''), '');
    assert.equal(buildWhatsAppLink(null, 'hi'), '');
  });
});

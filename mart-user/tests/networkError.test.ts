import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorMessage, isTransportFailure } from '../src/utils/networkError';

test('transport failure with no network reports offline honestly', () => {
  // In node there is no navigator, so the helper falls through to the
  // "could not reach" copy; on a device navigator.onLine decides between the
  // two. Either way it must never surface a server-supplied message.
  const err = { code: 'ERR_NETWORK' };
  assert.equal(isTransportFailure(err), true);
  const msg = requestErrorMessage(err, 'Invalid coupon');
  assert.notEqual(msg, 'Invalid coupon');
  assert.ok(/offline|reach/i.test(msg));
});

test('HTTP errors surface the server message', () => {
  const err = { response: { status: 400, data: { error: 'Minimum order ₹199 required' } } };
  assert.equal(isTransportFailure(err), false);
  assert.equal(requestErrorMessage(err, 'Invalid coupon'), 'Minimum order ₹199 required');
});

test('HTTP errors with no body fall back to the caller copy', () => {
  const err = { response: { status: 500, data: undefined } };
  assert.equal(requestErrorMessage(err, 'Failed to submit. Please try again.'), 'Failed to submit. Please try again.');
});

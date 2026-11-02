import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isValidCustomerPhone, normalizeCustomerPhone } from '../src/utils/customerPhone';

describe('customer phone validation', () => {
  test('normalizes accepted bare Indian mobile numbers', () => {
    assert.equal(normalizeCustomerPhone('98765-43210'), '9876543210');
    assert.equal(isValidCustomerPhone(normalizeCustomerPhone('98765-43210')), true);
  });

  test('rejects invalid leading digits and malformed numbers', () => {
    assert.equal(isValidCustomerPhone('2298696912'), false);
    assert.equal(isValidCustomerPhone('5123456789'), false);
    assert.equal(isValidCustomerPhone('987654321'), false);
    assert.equal(isValidCustomerPhone('98765432101'), false);
  });
});
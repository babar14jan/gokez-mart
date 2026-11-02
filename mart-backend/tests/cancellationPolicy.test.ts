import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getCancellationPolicy } from '../src/utils/cancellationPolicy';

const now = new Date('2026-11-02T10:00:00.000Z');

describe('customer cancellation policy', () => {
  test('allows a confirmed ASAP order before preparation', () => {
    const policy = getCancellationPolicy({ status: 'confirmed', deliveryPreference: 'within_30' }, now);
    assert.equal(policy.canCancel, true);
    assert.equal(policy.canEditAddress, true);
  });

  test('does not allow cancellation after preparation starts', () => {
    const policy = getCancellationPolicy({ status: 'preparing', deliveryPreference: 'within_30' }, now);
    assert.equal(policy.canCancel, false);
  });

  test('closes a scheduled cancellation window 30 minutes before delivery', () => {
    const policy = getCancellationPolicy({
      status: 'confirmed', deliveryPreference: 'scheduled', scheduledFor: '2026-11-02T10:20:00.000Z',
    }, now);
    assert.equal(policy.canCancel, false);
  });

  test('enables a late-delivery report only after the promised deadline', () => {
    const before = getCancellationPolicy({ status: 'confirmed', promisedDeliveryAt: '2026-11-02T10:01:00.000Z' }, now);
    const after = getCancellationPolicy({ status: 'confirmed', promisedDeliveryAt: '2026-11-02T09:59:00.000Z' }, now);
    assert.equal(before.canReportDelay, false);
    assert.equal(after.canReportDelay, true);
  });
});
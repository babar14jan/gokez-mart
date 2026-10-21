/**
 * A store that closes for a set period.
 *
 * The owner schedules a closure from and until, writes the wording customers
 * should see, and the storefront shows it. The rules that matter:
 *
 *   1. a scheduled closure closes the store between its two ends, and reopens
 *      by itself at the end
 *   2. the manual switch still wins over it, so a store switched off stays
 *      closed rather than reopening itself on a schedule
 *   3. the times are read as IST, because that is the timezone the store
 *      trades in and every other schedule here is written against
 *   4. a malformed time means "no closure" rather than a store that silently
 *      disappears
 *
 * Node's `node:test` via `tsx`, same as the other backend suites.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateStoreOpen,
  parseIstLocalDateTime,
  type OpeningHours,
} from '../src/utils/storeHours';

/** Open every day, 09:00-21:00 IST. */
const ALWAYS_OPEN: OpeningHours = {
  mon: { open: '09:00', close: '21:00' },
  tue: { open: '09:00', close: '21:00' },
  wed: { open: '09:00', close: '21:00' },
  thu: { open: '09:00', close: '21:00' },
  fri: { open: '09:00', close: '21:00' },
  sat: { open: '09:00', close: '21:00' },
  sun: { open: '09:00', close: '21:00' },
};

/** 21 Oct 2026, 12:00 UTC = 17:30 IST. */
const NOW = new Date('2026-10-21T12:00:00Z');

describe('parsing a local datetime as IST', () => {
  test('a typed local time becomes the right UTC instant', () => {
    // 18:00 IST is 12:30 UTC (IST is +05:30).
    const parsed = parseIstLocalDateTime('2026-10-21T18:00');
    assert.ok(parsed, 'a well formed value must parse');
    assert.equal(parsed!.toISOString(), '2026-10-21T12:30:00.000Z');
  });

  test('a value without a usable time is ignored, not guessed at', () => {
    assert.equal(parseIstLocalDateTime(''), null);
    assert.equal(parseIstLocalDateTime('   '), null);
    assert.equal(parseIstLocalDateTime('tomorrow'), null);
    assert.equal(parseIstLocalDateTime('2026-10-21'), null);
    assert.equal(parseIstLocalDateTime('2026-10-21T25:00'), null);
    assert.equal(parseIstLocalDateTime(null), null);
    assert.equal(parseIstLocalDateTime(undefined), null);
  });
});

describe('a scheduled closure', () => {
  test('the store is closed between the two ends', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T23:00',
    });
    assert.equal(state.isOpen, false, 'the store must be closed inside the window');
    assert.equal(state.closedReason, 'scheduled');
  });

  test('the store reopens by itself at the end', () => {
    // NOW is 17:30 IST, so the window has to run past it to be active.
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T23:00',
    });
    assert.equal(state.isOpen, false);
    assert.ok(state.nextOpenAt, 'the customer must be told when the store is back');
    assert.equal(state.nextOpenAt, '2026-10-21T17:30:00.000Z'); // 23:00 IST
    assert.equal(state.closedUntilLabel, '21 Oct, 11:00 PM');
  });

  test('before the window the store is open as usual', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, {
      from: '2026-10-22T10:00',
      until: '2026-10-22T18:00',
    });
    assert.equal(state.isOpen, true, 'a closure tomorrow must not close the store today');
    assert.equal(state.closedReason, null);
  });

  test('after the window the store is open as usual', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, {
      from: '2026-10-20T10:00',
      until: '2026-10-20T18:00',
    });
    assert.equal(state.isOpen, true, 'a closure that has finished must not close the store');
  });

  test('a start with no end closes the store from that moment on', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, { from: '2026-10-21T10:00' });
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'scheduled');
    assert.equal(state.nextOpenAt, null, 'no end was promised, so none may be invented');
  });

  test('an end with no start closes the store from now until then', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, { until: '2026-10-21T23:00' });
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'scheduled');
  });

  test('the manual switch still wins, so a store switched off stays shut', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T13:00',
    });
    assert.equal(state.isOpen, false);
    assert.equal(
      state.closedReason,
      'manual',
      'a store switched off must not reopen itself when the schedule ends',
    );
  });

  test('no schedule means the store is judged on its hours alone', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, null);
    assert.equal(state.isOpen, true);
    assert.equal(state.closedReason, null);
  });

  test('a malformed schedule is ignored rather than closing the store', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, { from: 'not a date', until: 'also not' });
    assert.equal(state.isOpen, true, 'a broken value must not silently close a live store');
  });
});

/**
 * A store that closes for a set period.
 *
 * The owner switches the store to "Manually Closed" and says when it starts
 * and when it reopens. The rules that matter:
 *
 *   1. the switch decides whether the store is shut at all: with it off the
 *      store follows its own hours, and any times left over from an earlier
 *      closure are ignored
 *   2. with the switch on, the closure wins over the weekly hours
 *   3. the times are read as IST, because that is the timezone the store
 *      trades in and every other schedule here is written against
 *   4. a malformed time means "no closure" rather than a store that silently
 *      disappears
 *   5. the reopening time is worded the way a customer reads it: "tomorrow at
 *      9:00 AM" for the next day, a date for anything further out
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

describe('the manual closure switch', () => {
  test('with the switch off the store follows its own hours', () => {
    // The switch is off, so the store is open by its own schedule, and any
    // times left over from an earlier closure are ignored.
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T23:00',
    });
    assert.equal(state.isOpen, true, 'the switch decides whether the store is shut at all');
    assert.equal(state.closedReason, null);
  });

  test('with the switch on the closure wins over the weekly hours', () => {
    // The store's own hours say it is open right now, but the closure is on.
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T23:00',
    });
    assert.equal(state.isOpen, false, 'the closure must win over the hours');
    assert.equal(state.closedReason, 'scheduled');
  });

  test('a closure with no times stays shut, with no time invented', () => {
    // The API refuses this state, so it is only reachable by editing the
    // database directly. It must fail shut, not open.
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, null);
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'manual');
    assert.equal(state.nextOpenAt, null, 'no reopening time may be invented');
  });
});

describe('a scheduled closure', () => {
  test('the store is closed between the two ends', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T23:00',
    });
    assert.equal(state.isOpen, false, 'the store must be closed inside the window');
    assert.equal(state.closedReason, 'scheduled');
  });

  test('the store reopens by itself at the end', () => {
    // NOW is 17:30 IST, so the window has to run past it to be active.
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, {
      from: '2026-10-21T10:00',
      until: '2026-10-21T23:00',
    });
    assert.equal(state.isOpen, false);
    assert.ok(state.nextOpenAt, 'the customer must be told when the store is back');
    assert.equal(state.nextOpenAt, '2026-10-21T17:30:00.000Z'); // 23:00 IST
    assert.equal(state.closedUntilLabel, 'today at 11:00 PM');
  });

  test('the reopening time is worded for the day it falls on', () => {
    // Today and tomorrow are named; anything further out gets the date.
    const today = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, { from: '2026-10-21T10:00', until: '2026-10-21T23:00' });
    assert.equal(today.closedUntilLabel, 'today at 11:00 PM');
    const tomorrow = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, { from: '2026-10-21T10:00', until: '2026-10-22T18:00' });
    assert.equal(tomorrow.closedUntilLabel, 'tomorrow at 6:00 PM');
    const later = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, { from: '2026-10-21T10:00', until: '2026-10-28T18:00' });
    assert.equal(later.closedUntilLabel, 'on 28 Oct at 6:00 PM');
  });

  test('before the window the closure has not started, so no time is promised', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, {
      from: '2026-10-22T10:00',
      until: '2026-10-22T18:00',
    });
    assert.equal(state.isOpen, false, 'the store is still manually closed');
    assert.equal(state.closedReason, 'manual', 'the closure has not started yet');
    assert.equal(state.nextOpenAt, null);
  });

  test('after the window the closure has passed, so no time is promised', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, {
      from: '2026-10-20T10:00',
      until: '2026-10-20T18:00',
    });
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'manual');
    assert.equal(state.nextOpenAt, null);
  });

  test('a start with no end closes the store from that moment on', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, { from: '2026-10-21T10:00' });
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'scheduled');
    assert.equal(state.nextOpenAt, null, 'no end was promised, so none may be invented');
  });

  test('an end with no start closes the store from now until then', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, { until: '2026-10-21T23:00' });
    assert.equal(state.isOpen, false);
    assert.equal(state.closedReason, 'scheduled');
  });

  test('no schedule means the store is judged on its hours alone', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'true', NOW, null);
    assert.equal(state.isOpen, true);
    assert.equal(state.closedReason, null);
  });

  test('a malformed schedule is ignored rather than closing the store', () => {
    const state = evaluateStoreOpen(ALWAYS_OPEN, 'false', NOW, { from: 'not a date', until: 'also not' });
    assert.equal(state.isOpen, false, 'the manual closure still applies');
    assert.equal(state.closedReason, 'manual', 'a broken time must not be read as a window');
  });
});

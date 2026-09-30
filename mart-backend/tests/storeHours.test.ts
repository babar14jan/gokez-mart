/**
 * Store opening-hours evaluation.
 *
 * Pure-function tests: no app, no database, no HTTP. `evaluateStoreOpen` takes
 * an injectable `now`, so every case is deterministic and does not depend on the
 * machine's clock or timezone.
 *
 * The bug class this guards against is timezone drift. Opening hours are IST
 * wall-clock times; if the evaluation ever falls back to the host's local time,
 * a UTC server or a customer in another zone silently gets the wrong answer.
 * Several tests below therefore pass instants whose UTC date and IST date
 * differ, which is the exact case a naive implementation gets wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateStoreOpen, formatIstDateTime } from '../src/utils/storeHours';

/** 09:00-21:00 every day -- the shape seeded by migration 026. */
const ALL_DAY_9_21 = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, { open: '09:00', close: '21:00', closed: false }]),
);

const at = (iso: string) => new Date(iso);

describe('Store opening hours', () => {
  test('is open during the window and reports the closing time', () => {
    // 2026-01-07 is a Wednesday. 14:30 IST = 09:00 UTC.
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T09:00:00Z'));
    assert.equal(r.isOpen, true);
    assert.equal(r.closedReason, null);
    assert.equal(r.closesAtLabel, '9:00 PM');
  });

  test('is closed before opening and points at today\'s opening', () => {
    // 06:30 IST = 01:00 UTC, same calendar day.
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T01:00:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.closedReason, 'outside_hours');
    assert.equal(r.nextOpenLabel, '9:00 AM today');
    assert.equal(r.nextOpenAt, at('2026-01-07T03:30:00Z').toISOString());
  });

  test('is closed after closing and points at tomorrow', () => {
    // 22:00 IST = 16:30 UTC.
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T16:30:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.closedReason, 'outside_hours');
    assert.equal(r.nextOpenLabel, '9:00 AM tomorrow');
  });

  test('uses the IST calendar day, not the UTC one, when they differ', () => {
    // 2026-01-07T19:00:00Z is 2026-01-08 00:30 IST -- a different day AND a
    // different weekday (Thursday). A UTC-based implementation would answer
    // using Wednesday's hours and the wrong "today".
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T19:00:00Z'));
    assert.equal(r.isOpen, false, '00:30 IST is outside 09:00-21:00');
    assert.equal(r.nextOpenLabel, '9:00 AM today', 'the IST day rolled over to Thursday');
  });

  test('a Monday-closed store reopens tomorrow', () => {
    const hours = { ...ALL_DAY_9_21, mon: { open: '09:00', close: '21:00', closed: true } };
    // 2026-01-12 is a Monday; 10:00 IST.
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-12T04:30:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.nextOpenLabel, '9:00 AM tomorrow', 'the next day is named, not listed');
  });

  test('names the weekday once the reopening is more than a day away', () => {
    // Monday and Tuesday both closed, so from Monday the answer is Wednesday.
    const hours = { ...ALL_DAY_9_21,
      mon: { open: '09:00', close: '21:00', closed: true },
      tue: { open: '09:00', close: '21:00', closed: true } };
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-12T04:30:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.nextOpenLabel, '9:00 AM on Wednesday');
  });

  test('wraps a full week when the only open day is behind us', () => {
    // Open Monday only. It is Sunday, so the next opening is tomorrow.
    const hours = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d =>
        [d, d === 'mon' ? { open: '09:00', close: '21:00', closed: false } : { open: '09:00', close: '21:00', closed: true }]),
    );
    // 2026-01-11 is a Sunday; 10:00 IST.
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-11T04:30:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.nextOpenLabel, '9:00 AM tomorrow');
  });

  test('an overnight window keeps the store open past midnight', () => {
    const hours = { ...ALL_DAY_9_21, fri: { open: '22:00', close: '02:00', closed: false } };
    // Saturday 00:30 IST belongs to Friday's overnight window.
    // 2026-01-10 is a Saturday; 00:30 IST = 2026-01-09T19:00:00Z.
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-09T19:00:00Z'));
    assert.equal(r.isOpen, true, 'still open on the tail of Friday night');
    assert.equal(r.closesAtLabel, '2:00 AM');
  });

  test('an overnight window is not open in the afternoon before it starts', () => {
    // Friday is replaced outright, so its daytime hours do not apply.
    const hours = { ...ALL_DAY_9_21, fri: { open: '22:00', close: '02:00', closed: false } };
    // Friday 15:00 IST.
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-09T09:30:00Z'));
    assert.equal(r.isOpen, false, '22:00-02:00 does not cover the afternoon');
    assert.equal(r.nextOpenLabel, '10:00 PM today');
  });

  test('manual closure overrides the schedule and promises no reopening', () => {
    // Mid-window, but the owner has switched the store off.
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'false', at('2026-01-07T09:00:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.closedReason, 'manual', 'a manual closure is not "outside hours"');
    assert.equal(r.nextOpenAt, null, 'must not promise a time the owner never set');
    assert.equal(r.nextOpenLabel, null);
  });

  test('a store that is open every day but switched off reports manual closure', () => {
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'false', at('2026-01-07T16:30:00Z'));
    assert.equal(r.closedReason, 'manual');
  });

  test('a schedule with every day closed never opens', () => {
    const hours = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, { open: '09:00', close: '21:00', closed: true }]),
    );
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-07T09:00:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.closedReason, 'never_opens');
    assert.equal(r.nextOpenAt, null);
    assert.equal(r.nextOpenLabel, null);
  });

  test('malformed hours degrade to closed, never to open', () => {
    const bad = [
      undefined, null, {}, 'nonsense', 42,
      { mon: { open: '99:00', close: '21:00', closed: false } },
      { mon: { open: '09:00', close: '25:00', closed: false } },
      { mon: { open: '9am', close: '9pm', closed: false } },
      { mon: { closed: false } },
      { mon: null },
    ];
    for (const hours of bad) {
      const r = evaluateStoreOpen(hours as never, 'true', at('2026-01-07T09:00:00Z'));
      assert.equal(r.isOpen, false, `${JSON.stringify(hours)} was treated as open`);
    }
  });

  test('a day flagged closed is ignored even if its times look valid', () => {
    const hours = { ...ALL_DAY_9_21, wed: { open: '09:00', close: '21:00', closed: true } };
    // Wednesday 10:00 IST.
    const r = evaluateStoreOpen(hours, 'true', at('2026-01-07T04:30:00Z'));
    assert.equal(r.isOpen, false);
    assert.equal(r.nextOpenLabel, '9:00 AM tomorrow');
  });

  test('the closing instant is exclusive and the opening instant inclusive', () => {
    // Exactly 21:00 IST is closed; 20:59 is open.
    const atClose = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T15:30:00Z'));
    assert.equal(atClose.isOpen, false, '21:00 is the closing instant, not an open one');
    const justBefore = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T15:29:00Z'));
    assert.equal(justBefore.isOpen, true);
  });

  test('exactly at opening time the store is already open', () => {
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'true', at('2026-01-07T03:30:00Z'));
    assert.equal(r.isOpen, true, '09:00 IST is the first open moment');
  });

  test('nextOpenAt is a real UTC instant that formats back to the promised IST time', () => {
    // Round-trip: take the returned ISO value, format it in IST, and confirm it
    // is the hour the label claims. Guards the IST->UTC conversion itself.
    for (const iso of ['2026-01-07T01:00:00Z', '2026-01-07T16:30:00Z', '2026-01-12T04:30:00Z', '2026-01-11T04:30:00Z']) {
      const hours = { ...ALL_DAY_9_21, [new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date(iso)).slice(0, 3).toLowerCase()]: { open: '09:00', close: '21:00', closed: true } };
      const r = evaluateStoreOpen(hours, 'true', at(iso));
      assert.ok(r.nextOpenAt, `${iso} produced no nextOpenAt`);
      // Intl, not the module's own formatter, so this is an independent check of
      // the IST->UTC conversion rather than a tautology.
      const shown = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(r.nextOpenAt));
      assert.ok(r.nextOpenLabel!.startsWith(shown),
        `label "${r.nextOpenLabel}" disagrees with the instant (${shown})`);
    }
  });

  test('accepts a real boolean as well as the stored string', () => {
    assert.equal(evaluateStoreOpen(ALL_DAY_9_21, true, at('2026-01-07T09:00:00Z')).isOpen, true);
    assert.equal(evaluateStoreOpen(ALL_DAY_9_21, false, at('2026-01-07T09:00:00Z')).isOpen, false);
  });

  test('a missing store_open setting is treated as closed, not open', () => {
    // Fail closed: if the flag cannot be read, do not claim the store is trading.
    for (const missing of [undefined, null, '', 'TRUE', '1', 'yes']) {
      const r = evaluateStoreOpen(ALL_DAY_9_21, missing as never, at('2026-01-07T09:00:00Z'));
      assert.equal(r.isOpen, false, `store_open=${JSON.stringify(missing)} was treated as open`);
      assert.equal(r.closedReason, 'manual');
    }
  });
});

/**
 * The order insert writes evaluateStoreOpen's output straight into
 * mart_orders, and migration 057 enforces a consistency CHECK on those three
 * columns. A mismatch would not be caught by the unit tests above: it would only
 * appear as a constraint violation rejecting a customer's real order.
 */
describe('the recorded closure state always satisfies the order constraint', () => {
  // mart_orders_closure_consistency:
  //   (outside = false AND reason IS NULL AND scheduled_for IS NULL)
  //   OR (outside = true AND reason IS NOT NULL)
  const satisfiesConstraint = (r: ReturnType<typeof evaluateStoreOpen>) =>
    r.isOpen
      ? r.closedReason === null && r.nextOpenAt === null && r.nextOpenLabel === null
      : r.closedReason !== null;

  test('holds across a wide matrix of schedules, flags and instants', () => {
    const dayValues = [
      { open: '09:00', close: '21:00', closed: false },
      { open: '00:00', close: '23:59', closed: false },
      { open: '22:00', close: '02:00', closed: false },
      { open: '00:00', close: '00:00', closed: false },
      { open: '09:00', close: '21:00', closed: true },
      // Malformed entries, which must degrade to closed rather than open.
      { open: '9am', close: '9pm', closed: false },
      { open: '25:00', close: '26:00', closed: false },
      { closed: false },
    ];
    const flags = ['true', 'false', true, false, undefined, null, 'TRUE'];
    // One instant per weekday, at hours either side of a typical schedule.
    const instants = [
      '2026-01-05T00:00:00Z', '2026-01-05T12:00:00Z', '2026-01-06T18:45:00Z',
      '2026-01-07T03:30:00Z', '2026-01-08T15:30:00Z', '2026-01-09T19:00:00Z',
      '2026-01-10T20:00:00Z', '2026-01-11T04:30:00Z',
    ];

    let checked = 0;
    for (const open of dayValues) {
      for (const variant of [
        Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, open])),
        // Mixed week, so "next opening" has to search rather than look at today.
        Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
          .map((d, i) => [d, i % 2 === 0 ? open : { open: '09:00', close: '21:00', closed: true }])),
        { ...Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, open])), mon: null },
      ]) {
        for (const flag of flags) {
          for (const iso of instants) {
            const r = evaluateStoreOpen(variant, flag as never, new Date(iso));
            assert.ok(satisfiesConstraint(r),
              `constraint would be violated by ${JSON.stringify({ variant, flag, iso, r })}`);
            checked++;
          }
        }
      }
    }
    // 8 day shapes x 3 week layouts x 7 flags x 8 instants.
    assert.equal(checked, 8 * 3 * 7 * 8);
    assert.ok(checked > 1000, `expected a broad sweep, only checked ${checked}`);
  });

  test('a closed result never promises a time for a manual closure', () => {
    // The hub copy and the order record both distinguish these; a manual closure
    // with a scheduled_for would read as a promise the owner never made.
    const r = evaluateStoreOpen(ALL_DAY_9_21, 'false', new Date('2026-01-07T09:00:00Z'));
    assert.equal(r.closedReason, 'manual');
    assert.equal(r.nextOpenAt, null);
  });

  test('nextOpenAt is always a future instant when one is promised', () => {
    for (const iso of ['2026-01-05T00:00:00Z', '2026-01-08T15:30:00Z', '2026-01-11T04:30:00Z']) {
      const now = new Date(iso);
      const r = evaluateStoreOpen(ALL_DAY_9_21, 'true', now);
      if (r.nextOpenAt) {
        assert.ok(Date.parse(r.nextOpenAt) > now.getTime(),
          `nextOpenAt ${r.nextOpenAt} is not after ${iso}`);
      }
    }
  });
});

/**
 * Source-level guard. The insert is inside a transaction with a hand-written
 * parameter list, so a column added without a matching value (or the reverse)
 * compiles cleanly and fails at runtime as a Postgres error on a live order.
 */
describe('the order insert records the closure columns', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'services', 'order.service.ts'), 'utf8');

  test('inserts all three columns and passes all three values', () => {
    const match = /INSERT INTO mart_orders([\s\S]*?)VALUES \(([\s\S]*?)\)`/.exec(source);
    assert.ok(match, 'could not locate the mart_orders insert');
    const [, columnList, placeholderList] = match;
    for (const column of ['placed_outside_hours', 'closed_reason', 'scheduled_for']) {
      assert.ok(columnList.includes(column), `${column} is missing from the insert`);
    }
    const columns = columnList.split(',').map(c => c.trim()).filter(Boolean);
    const placeholders = placeholderList.split(',').map(p => p.trim()).filter(Boolean);
    assert.equal(placeholders.length, columns.length,
      'the number of value placeholders must match the number of columns');
  });

  test('evaluates the schedule on the server rather than trusting the client', () => {
    assert.ok(/evaluateStoreOpen\(/.test(source), 'order creation must call the evaluator');
    // The client must not be able to dictate this: no request field may feed it.
    const block = /evaluateStoreOpen\(([\s\S]*?)\);/.exec(source);
    assert.ok(block);
    assert.ok(!/data\.|req\.|body\./.test(block[1]!),
      'the closure evaluation must not read client-supplied values');
  });
});

describe('IST formatting for the hub', () => {
  test('renders the instant in IST regardless of the host timezone', () => {
    // 2026-01-08T03:30:00Z is 09:00 IST on 8 January.
    assert.equal(formatIstDateTime('2026-01-08T03:30:00Z'), '8 Jan, 9:00 AM');
    // 2026-01-07T18:45:00Z is 00:15 IST on 8 January -- the next calendar day.
    assert.equal(formatIstDateTime('2026-01-07T18:45:00Z'), '8 Jan, 12:15 AM');
  });

  test('uses a 12-hour clock with an unambiguous meridiem', () => {
    assert.equal(formatIstDateTime('2026-01-08T09:30:00Z'), '8 Jan, 3:00 PM');
    assert.equal(formatIstDateTime('2026-01-08T00:00:00Z'), '8 Jan, 5:30 AM');
  });

  test('midnight and noon do not collapse', () => {
    // 18:30Z is exactly midnight IST; 06:30Z is exactly noon IST.
    assert.equal(formatIstDateTime('2026-01-08T18:30:00Z'), '9 Jan, 12:00 AM');
    assert.equal(formatIstDateTime('2026-01-08T06:30:00Z'), '8 Jan, 12:00 PM');
  });

  test('returns null rather than "Invalid Date" for absent or unusable input', () => {
    for (const bad of [null, undefined, '', 'not-a-date', NaN]) {
      assert.equal(formatIstDateTime(bad as never), null, `${String(bad)} was not handled`);
    }
  });

  test('is independent of the process timezone', () => {
    // Same instant, two host zones: the output must not move.
    const first = formatIstDateTime('2026-01-08T03:30:00Z');
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      assert.equal(formatIstDateTime('2026-01-08T03:30:00Z'), first);
    } finally {
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    }
  });
});

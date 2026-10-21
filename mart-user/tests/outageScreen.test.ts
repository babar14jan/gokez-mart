/**
 * What the customer is shown when the store cannot be reached.
 *
 * Two things matter:
 *
 *   1. the screen does not appear for a single failed request. A flaky
 *      connection, a request that happened to time out, a deploy that is
 *      rolling — none of those should take the screen away from a customer
 *      who is happily browsing. It appears only when the failure is real and
 *      has lasted.
 *   2. when it does appear, it speaks in the store's words rather than the
 *      platform's. "We could not load the store" is the platform talking
 *      about itself; what the customer needs to know is that the store is
 *      taking a break and that their order still counts, which is what the
 *      store wrote for exactly this situation.
 *
 * The wording is kept on the device, because when the backend is down the app
 * cannot ask it for the message.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(HERE, '..', relative), 'utf8');

const statusSource = read('src/components/NetworkStatus.tsx');
const appSource = read('src/App.tsx');
const copySource = read('src/utils/storeClosed.ts');

describe('the store cannot be reached', () => {
  test('a single failed request does not take the screen over', () => {
    assert.match(
      statusSource,
      /OUTAGE_CONFIRM_MS/,
      'the failure has to last before the screen appears',
    );
    assert.match(
      statusSource,
      /confirmTimer = setTimeout\(/,
      'the confirmation must be a delay, not an immediate show',
    );
  });

  test('a timeout waits longer than a hard failure', () => {
    // A request that timed out may be a slow link rather than a dead server.
    // A customer browsing on a weak connection should not lose the app to it.
    assert.match(
      statusSource,
      /detail\.timeout \? TIMEOUT_CONFIRM_MS : OUTAGE_CONFIRM_MS/,
      'a timeout must be treated as ambiguous and wait longer',
    );
    assert.match(
      statusSource,
      /const TIMEOUT_CONFIRM_MS = 10000;/,
      'a timeout must wait long enough to ride out a slow link',
    );
  });

  test('the reopening placeholder never reaches the customer', () => {
    // During an outage there is no reopening time to put in it, so the
    // placeholder must be filled with something rather than shown as-is.
    assert.match(
      statusSource,
      /message\.replace\(\/\\\{until\\\}\/g, 'shortly'\)/,
      'the {until} placeholder must never be shown to a customer',
    );
  });

  test('the screen is still there when the app talks to the server again', () => {
    // A success cancels the pending confirmation, so a blip never reaches the
    // customer.
    assert.match(
      statusSource,
      /if \(confirmTimer\) \{ clearTimeout\(confirmTimer\); confirmTimer = undefined; \}/,
      'a success must cancel the pending confirmation',
    );
  });

  test("the screen speaks in the store's words when it has written any", () => {
    assert.match(statusSource, /withStoreCopy/);
    assert.match(
      statusSource,
      /title: 'We can\\u2019t reach your neighbourhood store right now\.'/,
      'the heading must say plainly that the store cannot be reached, not that it has shut',
    );
    assert.match(
      statusSource,
      /\.\.\.\(greeting \? \[greeting\] : \[\]\)/,
      "the store's greeting belongs under the heading, not instead of it",
    );
    assert.match(
      statusSource,
      /body: body\.length \? body : view\.body/,
      "the store's own words must be the body of the outage screen",
    );
  });

  test("the store's wording is kept on the device, because the server may be down", () => {
    assert.match(copySource, /rememberClosedCopy/);
    assert.match(copySource, /readClosedCopy/);
    assert.match(
      appSource,
      /rememberClosedCopy\(/,
      'the app must remember the wording as it fetches it',
    );
  });

  test('a customer who is offline still gets the offline wording', () => {
    // The store's message is about the store, not about the customer's own
    // connection, so the offline screen keeps its own copy.
    assert.match(
      statusSource,
      /mode === 'offline'\s*\?\s*VIEWS\.offline/,
      'the offline screen must keep its own wording',
    );
  });
});

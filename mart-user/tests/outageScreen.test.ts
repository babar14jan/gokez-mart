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
      /setTimeout\([\s\S]*?OUTAGE_CONFIRM_MS\)/,
      'the confirmation must be a delay, not an immediate show',
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
      /title: greeting \|\| 'Your neighbourhood store is closed right now\.'/,
      "the store's greeting must be the heading",
    );
    assert.match(statusSource, /body: message \? \[message\] : view\.body/);
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

/**
 * A catalogue that will not load.
 *
 * The home page must never show its own error card for this. A store that
 * will not load is a connection problem, and the customer is already being
 * shown the full-screen offline / unreachable notice for it — a second error
 * sitting in the middle of the home page is noise, and it is the one the
 * customer sees when the notice is not up.
 *
 * So a failed catalogue hands the failure to the full-screen notice, and the
 * home page waits behind it rather than rendering an error of its own.
 *
 * Node's `node:test` via `tsx`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const read = (relative: string) =>
  readFileSync(path.resolve(HERE, '..', relative), 'utf8');

const appSource = read('src/App.tsx');
const statusSource = read('src/components/NetworkStatus.tsx');

describe('a catalogue that will not load', () => {
  test('the home page has no error card of its own', () => {
    assert.ok(
      !/Couldn&apos;t load the store|Couldn't load the store/.test(appSource),
      'the home page must not render its own error card; the full-screen notice owns this case',
    );
  });

  test('a failed catalogue hands the failure to the full-screen notice', () => {
    assert.match(
      appSource,
      /dispatchEvent\(new CustomEvent\('mart:api-failed'/,
      'the catalogue failure must reach the offline / unreachable notice',
    );
  });

  test('the notice is told whether the customer is offline or the server is down', () => {
    assert.match(appSource, /offline \? \{ offline: true \} : \{ server: true \}/);
  });

  test('the home page waits behind the notice rather than showing an empty store', () => {
    assert.match(
      appSource,
      /loading \|\| catalogError \? \(/,
      'while the catalogue has failed the home page must show its skeleton, not an empty page',
    );
  });

  test('the catalogue is loaded again once the connection is back', () => {
    // The catalogue is the app's own business, so the retry lives with the
    // app rather than being triggered by a message from the outage screen.
    assert.match(
      appSource,
      /addEventListener\('online'/,
      'the app must retry the catalogue when the connection returns',
    );
    assert.match(
      appSource,
      /CATALOGUE_RETRY_MS/,
      'the app must keep retrying a catalogue that will not load',
    );
  });

  test('a healthy app is not told to reload the catalogue on every probe', () => {
    // The health probe runs every fifteen seconds. Telling the app to reload
    // the catalogue on each of those would re-download the whole catalogue,
    // every fifteen seconds, for the life of the app -- and the stamp-based
    // polling exists to avoid exactly that. The event is for coming back
    // from an outage, and only then.
    assert.match(
      statusSource,
      /const recovered = showingFailure;/,
      'the app must only be told to reload after an outage',
    );
    assert.match(
      statusSource,
      /if \(recovered\) \{/,
      'the reload must be conditional on having been down',
    );
  });

  test('a failure that has not lasted is dropped when the connection returns', () => {
    // The pending confirmation used to survive the device coming back
    // online, and could fire afterwards and put the outage screen over a
    // working app.
    assert.match(
      statusSource,
      /if \(confirmTimer\) \{ clearTimeout\(confirmTimer\); confirmTimer = undefined; \}[\s\S]*?showingFailure = false;/,
      'coming back online must cancel the pending confirmation',
    );
  });

  test('the home page has no closure banner of its own', () => {
    assert.ok(
      !/Store is currently closed/.test(appSource),
      'the home page must not carry its own closure banner; the strip below the header covers it, with the reopen time',
    );
  });

  test('the notice covers the whole screen, so it always wins', () => {
    assert.match(
      statusSource,
      /fixed inset-0 z-\[999\]/,
      'the offline / unreachable notice must be over everything',
    );
  });
});

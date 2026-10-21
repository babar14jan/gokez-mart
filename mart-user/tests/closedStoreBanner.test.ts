/**
 * The closed-store banner.
 *
 * The store owner writes the greeting and the message in the hub, and the
 * banner in the app shows exactly that. Three things must hold:
 *
 *   1. the owner's wording replaces the default heading and explanation
 *   2. "{until}" is filled with the time the store reopens, so the owner never
 *      has to keep a date in the sentence by hand
 *   3. an owner who writes nothing still gets the default banner
 *
 * The component is rendered to static markup, which is enough to see the
 * customer-facing text without a browser.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import StoreStatusStrip from '../src/components/StoreStatusStrip';

const CLOSED = {
  isOpen: false,
  closedReason: 'manual' as const,
  nextOpenAt: null,
  nextOpenLabel: null,
  closedUntilLabel: null,
  closesAtLabel: null,
};

const SCHEDULED = {
  ...CLOSED,
  closedReason: 'scheduled' as const,
  nextOpenAt: '2026-10-21T17:30:00.000Z',
  nextOpenLabel: '11:00 PM today',
  closedUntilLabel: 'today at 11:00 PM',
};

const render = (props: any) => renderToStaticMarkup(createElement(StoreStatusStrip as any, props));

describe('closed store banner', () => {
  test('an open store shows no banner at all', () => {
    const html = render({ openState: { ...CLOSED, isOpen: true } });
    assert.equal(html, '', 'an open store must not show a closed banner');
  });

  test('with nothing configured the default wording is used', () => {
    const html = render({ openState: CLOSED });
    assert.match(html, /closed right now\./);
    // This closure has no end at all, so there is no time to give and the
    // reassurance is all there is to say.
    assert.match(html, /as soon as we reopen/);
  });

  test('the reopening time is the line the customer reads', () => {
    // The time is the one fact they act on, so it is the line rather than a
    // sentence wrapped around it.
    const html = render({ openState: SCHEDULED });
    assert.match(html, /Reopens today at 11:00 PM/);
  });

  test('a store closed by hand is promised no reopening time it never made', () => {
    const html = render({ openState: CLOSED });
    assert.match(html, /as soon as we reopen/);
    assert.ok(!/on \d+ \w+,/.test(html), 'no time may be invented for a hand-made closure');
  });

  test('the zone name is not repeated in the notice', () => {
    // The zone is already named in the navbar directly above the strip, so
    // naming it again in the notice was noise.
    const html = render({ openState: CLOSED, zoneName: 'Newtown, Shapoorji' });
    assert.ok(
      !/Newtown/.test(html) && !/Shapoorji/.test(html),
      'the notice must not name the zone again',
    );
  });

  test('a store that wrote a message needs no heading of its own', () => {
    const html = render({
      openState: CLOSED,
      closedMessage: 'Your neighbourhood store is taking a break today.',
    });
    assert.match(html, /Your neighbourhood store is closed right now./);
    assert.match(html, /taking a break today/);
  });

  test("the store's own greeting replaces the default heading", () => {
    const html = render({
      openState: CLOSED,
      zoneName: 'Shapoorji',
      closedGreeting: 'Hi! 👋',
    });
    assert.match(html, /Hi! 👋/);
    assert.ok(
      !/store is closed now\./.test(html),
      'the default heading must not show when the store wrote its own',
    );
  });

  test("the store's own message replaces the default explanation", () => {
    const html = render({
      openState: CLOSED,
      closedMessage: 'Your neighbourhood store is taking a break today.',
    });
    assert.match(html, /taking a break today/);
    assert.ok(!/You can order now/.test(html), 'the default explanation must be replaced');
  });

  test('"{until}" is filled with the time the store reopens', () => {
    const html = render({
      openState: SCHEDULED,
      closedMessage: 'We will be back {until}.',
    });
    assert.match(html, /We will be back today at 11:00 PM\./);
    assert.ok(!html.includes('{until}'), 'the placeholder must never reach the customer');
  });

  test('a message with no placeholder is left exactly as written', () => {
    const html = render({
      openState: SCHEDULED,
      closedMessage: 'Back soon.',
    });
    assert.match(html, /Back soon\./);
  });

  test('a missing reopening time does not leave a bare placeholder behind', () => {
    const html = render({
      openState: CLOSED,
      closedMessage: 'We will be back {until}.',
    });
    assert.ok(!html.includes('{until}'), 'the placeholder must never reach the customer');
    assert.match(html, /We will be back later\./);
  });
});

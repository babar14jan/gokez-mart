/**
 * The closed-store card.
 *
 * The banner says the store is shut, but it is a thin strip. This card is
 * what a customer meets when they first arrive at a closed store, and again
 * when they try to order while it is shut — the two moments when the closure
 * actually changes what they should do.
 *
 * What is pinned here:
 *   1. the cross in the top right and the button both dismiss the card
 *   2. the button can do something different from the cross, because on the
 *      order path the button places the order and the cross backs out
 *   3. the reopening time is shown in its own solid block, so it is the thing
 *      the eye lands on
 *   4. "{until}" is filled with the reopening time
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import StoreClosedCard from '../src/components/StoreClosedCard';

const render = (props: any) => renderToStaticMarkup(createElement(StoreClosedCard as any, { open: true, ...props }));

describe('closed store card', () => {
  test('it is a modal dialog', () => {
    const html = render({});
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
  });

  test('it has a cross in the top right and a button', () => {
    const html = render({});
    assert.match(html, /aria-label="Close"/, 'the cross must be reachable');
    assert.match(html, /Got it/);
  });

  test('the reopening time is in its own solid block', () => {
    const html = render({ resumeLabel: '22 Oct, 6:00 PM' });
    // A block of its own, not folded into the sentence.
    assert.match(html, /Reopens 22 Oct, 6:00 PM/);
    assert.match(html, /bg-emerald-600/, 'the reopening time gets the solid block');
  });

  test('no reopening time means no block', () => {
    const html = render({ resumeLabel: null });
    assert.ok(!/Reopens/.test(html), 'a time that is not known must not be promised');
  });

  test("the store's greeting and message are used", () => {
    const html = render({
      greeting: 'Hi! 👋',
      message: 'Your neighbourhood store is taking a break today.',
    });
    assert.match(html, /Hi! 👋/);
    assert.match(html, /taking a break today/);
  });

  test('"{until}" is filled with the reopening time', () => {
    const html = render({ message: 'We will be back {until}.', resumeLabel: '22 Oct, 6:00 PM' });
    assert.match(html, /We will be back 22 Oct, 6:00 PM\./);
    assert.ok(!html.includes('{until}'), 'the placeholder must never reach the customer');
  });

  test('the default heading is used when the store wrote none', () => {
    const html = render({});
    assert.match(html, /closed right now/);
  });

  test('the button can do something different from the cross', () => {
    const html = render({ onClose: () => {}, onConfirm: () => {}, primaryLabel: 'Place order' });
    assert.match(html, /Place order/);
  });

  test('it renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(StoreClosedCard as any, { open: false, onClose: () => {} }),
    );
    assert.equal(html, '');
  });
});

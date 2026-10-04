/**
 * Phase 2/3 funnel instrumentation tests.
 *
 * Two things here are worth locking down with tests rather than trusting to
 * review: the funnel payload allowlist (it is the only thing standing between a
 * bug in the storefront and personal data in the analytics table), and the
 * super-admin boundary on the aggregated view.
 *
 * Harness matches tests/security.test.ts and tests/campaign-governance.test.ts:
 * Node's `node:test` via `tsx`, with `pg.Pool.prototype.connect` stubbed so the
 * real service code runs and the real SQL is captured for assertion.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'funnel-test-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

const require = createRequire(__filename);

type Row = Record<string, any>;
interface Call { text: string; params: unknown[] }

const calls: Call[] = [];
let eventRows: Row[] = [];
let sessionRow: Row | null = null;

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/FROM mart_funnel_events/.test(text)) return { rows: eventRows };
      if (/FROM mart_funnel_sessions/.test(text)) return { rows: sessionRow ? [sessionRow] : [] };
      return { rows: [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

const { FunnelEventService, FUNNEL_EVENTS, normaliseChannel } = require('../src/services/funnelEvent.service');
const { FunnelCartService } = require('../src/services/funnelCart.service');
const { FunnelService } = require('../src/services/funnel.service');

/** Reads a repo file by workspace-relative path. */
const read = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, '../..', p), 'utf8');

const lastEventInsert = () => [...calls].reverse().find(c => /INSERT INTO mart_funnel_events/.test(c.text));
const insertedProps = (): Record<string, unknown> => JSON.parse(lastEventInsert()!.params[3] as string);

beforeEach(() => { calls.length = 0; eventRows = []; sessionRow = null; });

describe('A. The funnel event allowlist is enforced server-side', () => {
  test('an unrecognised event name is rejected outright, not stored', async () => {
    const recorded = await FunnelEventService.recordEvent({
      sessionId: 'sess-a', eventName: 'definitely_not_a_real_event',
    });
    assert.equal(recorded, false);
    assert.equal(lastEventInsert(), undefined, 'no event row should be written');
  });

  test('a prototype-pollution style name cannot slip through', async () => {
    for (const name of ['__proto__', 'constructor', 'toString', '']) {
      assert.equal(await FunnelEventService.recordEvent({ sessionId: 's', eventName: name }), false, name);
    }
  });

  test('every documented funnel event is accepted', async () => {
    for (const name of FUNNEL_EVENTS) {
      assert.equal(await FunnelEventService.recordEvent({ sessionId: 'sess-a', eventName: name }), true, name);
    }
  });

  test('a missing session id stores nothing', async () => {
    assert.equal(await FunnelEventService.recordEvent({ sessionId: '', eventName: 'session_start' }), false);
    assert.equal(await FunnelEventService.recordEvent({ sessionId: '   ', eventName: 'session_start' }), false);
  });

  test('an event always creates its session first, so no orphan rows', async () => {
    await FunnelEventService.recordEvent({ sessionId: 'sess-a', eventName: 'login_viewed' });
    const sessionTouch = calls.find(c => /INSERT INTO mart_funnel_sessions/.test(c.text));
    assert.ok(sessionTouch, 'session row must be written before the event');
  });
});

describe('B. No personal data can reach mart_funnel_events', () => {
  test('an unknown prop key is dropped rather than stored', async () => {
    await FunnelEventService.recordEvent({
      sessionId: 'sess-a', eventName: 'login_number_entered',
      props: { productId: 'p1', phone: '9876543210', email: 'a@b.com', address: '12 High St' },
    });
    const props = insertedProps();
    assert.deepEqual(Object.keys(props), ['productId']);
    assert.equal(JSON.stringify(props).includes('9876543210'), false);
  });

  test('a 10-digit run is stripped even under an allowed key', async () => {
    await FunnelEventService.recordEvent({
      sessionId: 'sess-a', eventName: 'login_number_entered',
      props: { productName: 'Call 9876543210 now' },
    });
    assert.equal(JSON.stringify(insertedProps()).includes('9876543210'), false);
  });

  test('non-finite numbers and nested objects are discarded', async () => {
    await FunnelEventService.recordEvent({
      sessionId: 'sess-a', eventName: 'cart_added',
      props: { quantity: Number.NaN, subtotal: Infinity, itemCount: 3, productId: { nested: true } },
    });
    const props = insertedProps();
    assert.equal('quantity' in props, false);
    assert.equal('subtotal' in props, false);
    assert.equal('productId' in props, false);
    assert.equal(props.itemCount, 3);
  });

  test('an oversized prop bag is trimmed, and the stored value is still valid JSON', async () => {
    await FunnelEventService.recordEvent({
      sessionId: 'sess-a', eventName: 'product_viewed',
      props: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`productId`, 'x'.repeat(120)])),
    });
    const raw = lastEventInsert()!.params[3] as string;
    assert.ok(raw.length <= 1024 + 300, `payload not trimmed: ${raw.length}`);
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});

describe('C. Channel handling cannot be spoofed into nonsense', () => {
  test('a missing or malformed channel becomes unattributed, never a label we did not define', () => {
    for (const value of [undefined, null, '', '   ', 'a'.repeat(99), 'has space', '<script>', "'; DROP TABLE--"]) {
      assert.equal(normaliseChannel(value), 'unattributed', String(value));
    }
  });

  test('a legitimate marker is preserved and lower-cased', () => {
    assert.equal(normaliseChannel('QR'), 'qr');
    assert.equal(normaliseChannel('standee'), 'standee');
    assert.equal(normaliseChannel('whatsapp_1'), 'whatsapp_1');
  });
});

describe('D. Session linking is additive and cannot affect auth', () => {
  test('linking writes only customer_id and never overwrites attribution columns', async () => {
    await FunnelEventService.linkSessionToCustomer('sess-a', 'cust-1');
    const call = calls.find(c => /UPDATE mart_funnel_sessions/.test(c.text))!;
    assert.ok(/SET customer_id = \$2/.test(call.text));
    assert.equal(/first_campaign_id\s*=/.test(call.text), false, 'must not clobber campaign attribution');
  });

  test('an empty session id or customer id is a no-op', async () => {
    await FunnelEventService.linkSessionToCustomer('', 'cust-1');
    await FunnelEventService.linkSessionToCustomer('sess-a', '');
    assert.equal(calls.length, 0);
  });

  test('a campaign touch latches the first touch but always updates the last', async () => {
    await FunnelEventService.recordCampaignTouch('sess-a', 'camp-1');
    await FunnelEventService.recordCampaignTouch('sess-a', 'camp-2');
    const call = calls.filter(c => /UPDATE mart_funnel_sessions/.test(c.text)).pop()!;
    assert.ok(/first_campaign_id = COALESCE\(first_campaign_id, \$2\)/.test(call.text), 'first touch must not move');
    assert.ok(/last_campaign_id = \$2/.test(call.text), 'last touch must follow the latest campaign');
  });
});

describe('E. Server cart arithmetic and edge cases', () => {
  test('an emptied cart with no checkout deletes the row instead of storing an empty cart', async () => {
    await FunnelCartService.upsert({ sessionId: 'sess-a', items: [] });
    const call = calls.find(c => /DELETE FROM mart_carts/.test(c.text))!;
    assert.ok(call, 'an abandoned empty cart should not linger as a row');
  });

  test('an empty cart that reached checkout is retained, so the drop-off is visible', async () => {
    await FunnelCartService.upsert({ sessionId: 'sess-a', items: [], reachedCheckout: true });
    const call = calls.find(c => /INSERT INTO mart_carts/.test(c.text))!;
    assert.ok(call, 'checkout reached with no items must still be recorded');
  });

  test('subtotal and count are computed from the items, not trusted from the client', async () => {
    const result = await FunnelCartService.upsert({
      sessionId: 'sess-a',
      items: [
        { productId: 'p1', productName: 'Tomato', unit: 'kg', price: 40, quantity: 2, photoUrl: null },
        { productId: 'p2', productName: 'Milk', unit: 'l', price: 25.5, quantity: 1, photoUrl: null },
      ],
    });
    assert.equal(result.itemCount, 3);
    assert.equal(result.subtotal, 105.5);
    const call = calls.find(c => /INSERT INTO mart_carts/.test(c.text))!;
    assert.equal(call.params[3], 3, 'item_count column');
    assert.equal(call.params[4], 105.5, 'subtotal column');
  });

  test('a hostile quantity cannot inflate the cart', async () => {
    const result = await FunnelCartService.upsert({
      sessionId: 'sess-a',
      items: [{ productId: 'p1', productName: 'x', unit: 'kg', price: 1, quantity: 999999, photoUrl: null }],
    });
    assert.ok(result.itemCount <= 99, `quantity not clamped: ${result.itemCount}`);
  });

  test('markConverted is idempotent via COALESCE so a retry cannot move the date', async () => {
    await FunnelCartService.markConverted('sess-a', 'order-1');
    const call = calls.find(c => /UPDATE mart_carts/.test(c.text))!;
    assert.ok(/converted_at = COALESCE\(converted_at, NOW\(\)\)/.test(call.text));
  });
});

// markConverted had no call site, so `converted_at` was never set. The panel
// derives `abandoned = reachedCheckout - converted`, which meant every checkout
// in the business was reported as abandoned and the "Ordered" tile read 0.
// These cover the three things that had to be true for the number to be real.
describe('E2. A placed order closes its own cart, and the closure is verifiable', () => {
  test('a conversion records the order it came from, not just a timestamp', async () => {
    await FunnelCartService.markConverted('sess-a', 'order-7');
    const call = calls.find(c => /UPDATE mart_carts/.test(c.text))!;
    assert.ok(/order_id\s*=\s*COALESCE\(mart_carts\.order_id/.test(call.text),
      'the conversion is not linked to an order, so it cannot be reconciled against sales');
    assert.deepEqual(call.params, ['sess-a', 'order-7']);
  });

  test('a conversion with no order is refused rather than recorded as a bare claim', async () => {
    await FunnelCartService.markConverted('sess-a', '');
    assert.equal(calls.find(c => /UPDATE mart_carts/.test(c.text)), undefined,
      'converted_at was set with no order behind it');
  });

  test('an already-converted cart is not re-pointed at a different order', async () => {
    // The `converted_at IS NULL` guard means the first order wins. Without it a
    // retry carrying a new idempotency key would rewrite the attribution.
    await FunnelCartService.markConverted('sess-a', 'order-7');
    const call = calls.find(c => /UPDATE mart_carts/.test(c.text))!;
    assert.ok(/AND converted_at IS NULL/.test(call.text),
      'a later order can overwrite which order a cart is credited to');
  });

  test('the session id is length-capped, matching the bound used on ingest', async () => {
    await FunnelCartService.markConverted('x'.repeat(500), 'order-7');
    const call = calls.find(c => /UPDATE mart_carts/.test(c.text))!;
    assert.equal((call.params[0] as string).length, 64);
  });

  test('it runs on the caller\'s transaction client when given one', async () => {
    // This is what makes a rolled-back order leave its cart unconverted. If this
    // ever silently falls back to the shared pool, the atomicity is gone.
    const seen: string[] = [];
    const client = { query: async (text: string) => { seen.push(text); return { rows: [] }; } };
    await FunnelCartService.markConverted('sess-a', 'order-7', client);
    assert.equal(seen.length, 1, 'the transaction client was not used');
    assert.ok(/UPDATE mart_carts/.test(seen[0]));
    assert.equal(calls.filter(c => /UPDATE mart_carts/.test(c.text)).length, 0,
      'it escaped onto the shared pool instead of joining the order transaction');
  });
});

describe('E3. The order path actually performs the conversion', () => {
  test('the order service calls markConverted inside its transaction', () => {
    const src = read('mart-backend/src/services/order.service.ts');
    assert.ok(/FunnelCartService\.markConverted\(data\.funnelSessionId, orderId, client\)/.test(src),
      'order.service no longer closes its own cart, so converted_at stays NULL');
    // It must be the transaction's client, not the pool.
    assert.ok(/markConverted\([^)]*,\s*client\)/.test(src),
      'the conversion is not bound to the order transaction');
  });

  test('the conversion happens after the order row is written, inside the transaction', () => {
    const src = read('mart-backend/src/services/order.service.ts');
    const insert = src.indexOf('INSERT INTO mart_order_items');
    const convert = src.indexOf('FunnelCartService.markConverted');
    assert.ok(insert > -1 && convert > insert,
      'the cart is marked converted before the order exists');
    const close = src.indexOf('});', src.indexOf('return {', convert));
    assert.ok(convert < close, 'the conversion escaped the transaction body');
  });

  test('the controller accepts a session id but never lets it fail the order', () => {
    const src = read('mart-backend/src/controllers/index.ts');
    assert.ok(/funnelSessionId = typeof req\.body\.funnelSessionId === 'string'/.test(src),
      'the session id is no longer type-checked and capped before use');
    // Analytics must never be the reason a customer cannot check out, so a bad
    // value is coerced to null rather than rejected.
    assert.ok(!/400[\s\S]{0,200}funnelSessionId[\s\S]{0,80}(400|error)/.test(src),
      'a malformed funnelSessionId appears able to reject the order');
  });

  test('the storefront actually sends it', () => {
    const src = read('mart-user/src/pages/CheckoutPage.tsx');
    assert.ok(/funnelSessionId: getFunnelSessionId\(\)/.test(src),
      'the checkout does not send a session id, so the server cannot close the cart');
    const api = read('mart-user/src/services/api.ts');
    assert.ok(/funnelSessionId\?:\s*string/.test(api),
      'the placeOrder payload type does not accept a session id');
  });

  test('the funnel only counts a conversion that still has an order', () => {
    const src = read('mart-backend/src/services/funnel.service.ts');
    assert.ok(/converted_at IS NOT NULL AND order_id IS NOT NULL/.test(src),
      'a conversion with no surviving order is still being counted');
  });
});

describe('F. Aggregations survive an empty database instead of throwing', () => {
  test('getSummary returns a zeroed funnel rather than a 500', async () => {
    const summary = await FunnelService.getSummary('all');
    assert.equal(summary.stages.length, 4);
    assert.ok(summary.stages.every(s => s.count === 0));
    assert.equal(summary.dropoff.avgOtpRequests, 0);
    assert.deepEqual(summary.daily, []);
  });

  test('getExtended returns zeroed channels, attribution and cart metrics', async () => {
    const extended = await FunnelService.getExtended('30d');
    assert.deepEqual(extended.channels, []);
    assert.deepEqual(extended.attribution, []);
    assert.equal(extended.cart.abandoned, 0);
    assert.equal(extended.eventStages.length, 11);
    assert.ok(extended.eventStages.every(s => s.sessions === 0));
  });

  test('cart abandonment can never go negative', async () => {
    sessionRow = { carts: 5, reached_checkout: 2, converted: 4 };
    const extended = await FunnelService.getExtended('all');
    assert.equal(extended.cart.abandoned, 0, 'reached checkout below converted must clamp to 0');
  });
});

describe('G. The "Today" range is its own window, not "All time"', () => {
  test('getSummary("today") stays range "today" and zeroes on empty data', async () => {
    const summary = await FunnelService.getSummary('today');
    assert.equal(summary.range, 'today');
    assert.ok(summary.stages.every(s => s.count === 0));
    assert.deepEqual(summary.daily, []);
  });

  test('getExtended("today") stays range "today"', async () => {
    const extended = await FunnelService.getExtended('today');
    assert.equal(extended.range, 'today');
    assert.deepEqual(extended.channels, []);
    assert.ok(extended.eventStages.every(s => s.sessions === 0));
  });

  test('the SQL for "today" anchors to midnight, not a sliding 24h window', () => {
    // Treating "today" as days=1 would spill yesterday evening into the panel
    // at 00:01. The panel must mean what the label promises.
    const src = read('mart-backend/src/services/funnel.service.ts');
    assert.ok(/date_trunc\('day', NOW\(\) AT TIME ZONE 'Asia\/Kolkata'\)/.test(src),
      '"today" is not anchored to the start of the calendar day');
  });

  test('daily chart buckets use IST calendar dates', () => {
    const src = read('mart-backend/src/services/funnel.service.ts');
    assert.ok(/DATE_TRUNC\('day', first_seen_at AT TIME ZONE 'Asia\/Kolkata'\)/.test(src),
      'session activity is grouped using the database timezone instead of IST');
    assert.ok(/DATE_TRUNC\('day', first_otp_requested_at AT TIME ZONE 'Asia\/Kolkata'\)/.test(src),
      'lead activity is grouped using the database timezone instead of IST');
  });

  test('the admin controller keeps "today" distinct from "all"', () => {
    // This was the actual failure mode: unknown ranges silently collapse to
    // "all", so the button would have shown "Today" but returned all-time data.
    const src = read('mart-backend/src/controllers/index.ts');
    const extended = src.slice(src.indexOf('adminGetCustomerFunnelExtended'));
    assert.ok(/req\.query\.range === 'today'/.test(extended),
      'the extended funnel handler no longer recognises range=today');
    assert.ok(new Set((extended.match(/'today'|'7d'|'30d'/g) ?? [])).size >= 3,
      'the extended funnel whitelist dropped part of the range set');
  });

  test('the legacy funnel endpoint rejects the removed 90-day range', () => {
    const src = read('mart-backend/src/controllers/index.ts');
    const start = src.indexOf('export const adminGetCustomerFunnel =');
    const controller = src.slice(start, src.indexOf('\nfunction csvCell', start));
    assert.equal(controller.includes("req.query.range === '90d'"), false,
      'a 90-day request is accepted even though FunnelRange no longer supports it');
  });

  test('custom ranges use inclusive IST dates with an exclusive next-day bound', () => {
    const src = read('mart-backend/src/services/funnel.service.ts');
    assert.ok(/\$1::date::timestamp AT TIME ZONE 'Asia\/Kolkata'/.test(src),
      'custom date ranges do not begin at IST midnight');
    assert.ok(/\$2::date \+ 1/.test(src),
      'custom date ranges do not include the selected end date');
  });

  test('a funnel session expires, so a returning device is counted again', () => {
    // A session id that lives forever in localStorage means a phone that came
    // back today (or the owner re-testing their own QR) can never move the
    // funnel again. The id must rotate after quiet time, like a GA session.
    const src = read('mart-user/src/utils/track.ts');
    assert.ok(/SESSION_IDLE_MS\s*=\s*\d+\s*\*\s*60\s*\*\s*1000/.test(src),
      'the session id no longer expires after a quiet window');
    assert.ok(/store\.setItem\(SESSION_AT/.test(src),
      'no last-activity timestamp is kept for the session window');
  });

  test('channel is re-derived when a session rotates', () => {
    // If the channel cache survives the id rotation, a returning visitor who
    // arrives via a different marker (a Google exit, a fresh QR) keeps the old
    // attribution instead of resampling the URL.
    const src = read('mart-user/src/utils/track.ts');
    assert.ok(/removeItem\(CHANNEL_KEY\)/.test(src),
      'the stale channel cache is not cleared when the session rotates');
  });
});

// POST /funnel/cart is public. It used to write `customerId` straight from the
// request body into mart_carts.customer_id, so anyone who knew or guessed a
// customer UUID could attach a cart to that account -- and, because
// idx_carts_customer_unique allows one live cart per customer, occupy its slot.
describe('E4. The public cart endpoint cannot be told whose cart it is', () => {
  test('the customer id is no longer read from the request body', () => {
    const src = read('mart-backend/src/controllers/index.ts');
    const fn = src.slice(src.indexOf('export const postFunnelCart'));
    const body = fn.slice(0, fn.indexOf('res.json'));
    assert.ok(!/const \{[^}]*\bcustomerId\b[^}]*\} = req\.body/.test(body),
      'postFunnelCart still destructures a customerId out of the request body');
    assert.ok(!/customerId:\s*req\.body\.customerId/.test(body),
      'postFunnelCart still forwards a body-supplied customerId');
  });

  test('it is resolved server-side from auth or the verified session link', () => {
    const src = read('mart-backend/src/controllers/index.ts');
    const fn = src.slice(src.indexOf('export const postFunnelCart'));
    const body = fn.slice(0, fn.indexOf('res.json'));
    assert.ok(/req\.customer\?\.id/.test(body),
      'an authenticated customer is not preferred');
    assert.ok(/FunnelEventService\.resolveSessionCustomer\(/.test(body),
      'the customer is not resolved from the verified session link');
  });

  test('the route accepts an optional customer session', () => {
    const src = read('mart-backend/src/routes/index.ts');
    const line = src.split('\n').find(l => /'\/funnel\/cart'/.test(l))!;
    assert.ok(/authenticateCustomerIfPresent/.test(line),
      '/funnel/cart is not behind authenticateCustomerIfPresent, so req.customer is never populated');
  });

  test('the storefront no longer sends a customer id', () => {
    const src = read('mart-user/src/utils/track.ts');
    const fn = src.slice(src.indexOf('export function syncFunnelCart'));
    const body = fn.slice(0, fn.indexOf('}'));
    assert.ok(!/customerId/.test(body),
      'syncFunnelCart still offers a customerId option, which invites the spoof back');
  });

  test('a session can only carry a customer id via OTP verification', async () => {
    // The whole safety argument rests on linkSessionToCustomer being an UPDATE,
    // so an unverified session id can never acquire a customer_id.
    const src = read('mart-backend/src/services/funnelEvent.service.ts');
    const start = src.indexOf('static async linkSessionToCustomer');
    const fn = src.slice(start, src.indexOf('static async', start + 10));
    const sql = fn.slice(fn.indexOf('await query'));
    assert.ok(/UPDATE mart_funnel_sessions/.test(sql),
      'linkSessionToCustomer is no longer a bare UPDATE');
    assert.ok(!/INSERT/i.test(sql),
      'linkSessionToCustomer can now create a session row carrying a customer_id');
  });
});

describe('H. Guest checkouts persist like logged-in customers', () => {
  test('the guest address is filed into the address book when the order lands', () => {
    const src = read('mart-backend/src/services/order.service.ts');
    assert.ok(/INSERT INTO mart_customer_addresses/.test(src),
      'a guest address is not saved to the address book with the order');
    assert.ok(/lower\(trim\(address_line\)\)/.test(src),
      'identical guest addresses are not re-inserted as duplicates');
    assert.ok(/guestAddressLabel \|\| 'Home'/.test(src),
      'a guest address is inserted without a Home label, leaving the book label blank');
  });

  test('the address is keyed to the phone-derived customer, never a client id', () => {
    // Guest orders never name an account; the server resolves the customer from
    // the phone inside the same transaction and files the address against that
    // row. That row is exactly what a later OTP login resolves to.
    const order = read('mart-backend/src/services/order.service.ts');
    const block = order.slice(order.indexOf('const customerResult'), order.indexOf('const productIds'));
    assert.ok(/mart_customer_addresses/.test(block),
      'the address insert is not inside the transaction that resolves the phone customer');
    const ctrl = read('mart-backend/src/controllers/index.ts');
    assert.ok(/guestAddressLabel: typeof guestAddressLabel === 'string'/.test(ctrl),
      'the order endpoint no longer bounds the guest address label');
  });

  test('a later OTP login with the same phone retrieves the guest data', () => {
    const auth = read('mart-backend/src/services/customerAuth.service.ts');
    assert.ok(/ON CONFLICT \(phone\) DO UPDATE SET last_seen_at/.test(auth),
      'OTP verification creates a new customer row instead of reusing the guest one');
    // A guest-provided name is retained, while the authenticated Customer
    // fallback never replaces a real profile name with a placeholder.
    const order = read('mart-backend/src/services/order.service.ts');
    assert.ok(/NULLIF\(\$2, 'Customer'\)/.test(order),
      'the authenticated fallback Customer name is persisted as a real profile name');
    assert.ok(/name = COALESCE\(mart_customers\.name, EXCLUDED\.name\)/.test(order),
      'a later order can overwrite an existing customer profile name');
  });

  test('the storefronts keep a guest address instead of dropping it', () => {
    const page = read('mart-user/src/pages/CheckoutPage.tsx');
    assert.ok(/setGuestAddress\(address\)/.test(page),
      'the web checkout drops the guest address on save');
    const mobile = read('mart-mobile/app/checkout.tsx');
    assert.ok(/guestAddressLabel: isGuest \? 'Home' : undefined/.test(mobile),
      'the mobile checkout does not label its guest address for the address book');
  });
});
describe('I. Guest checkouts flow through the lead funnel', () => {
  test('an order seeds a lead for a phone that never requested an OTP', () => {
    const order = read('mart-backend/src/services/order.service.ts');
    const block = order.slice(order.indexOf('const customerResult'), order.indexOf('const productIds'));
    assert.ok(/INSERT INTO mart_customer_leads/.test(block),
      'a guest checkout does not write a lead, so it never reaches the funnel');
    assert.ok(/VALUES \(\$1, \$2, 0/.test(block),
      'a guest checkout is stamped otp_request_count 0, so the admin table treats it as an OTP request');
    assert.ok(/first_otp_requested_at, last_otp_requested_at\).*NOW\(\), NOW\(\)/s.test(block),
      'a guest lead has no windowing timestamp, so the funnel ranges filter it out');
  });

  test('the funnel stages count guest orders by phone', () => {
    const src = read('mart-backend/src/services/funnel.service.ts');
    const leadBase = src.slice(src.indexOf('const LEAD_BASE'), src.indexOf('interface FunnelAggregateRow'));
    assert.ok(/guest_phone = l\.phone/.test(leadBase),
      'the funnel no longer matches a lead to guest orders by phone');
  });

  test('the admin leads list and counts expose a guest bucket', () => {
    const svc = read('mart-backend/src/services/customerLead.service.ts');
    assert.ok(/otp_request_count = 0/.test(svc),
      'guest leads cannot be queried separately from other unverified leads');
    const ctrl = read('mart-backend/src/controllers/index.ts');
    assert.ok(/=== 'guest'/.test(ctrl),
      'the admin leads controller no longer accepts status=guest');
    const hub = read('mart-hub/src/pages/CustomerLeadsPage.tsx');
    assert.ok(/'Guest checkout'/.test(hub),
      'the super admin is never shown a guest bucket for checkout-only shoppers');
  });

  test('direct checkouts are excluded from the OTP-not-completed bucket', () => {
    const svc = read('mart-backend/src/services/customerLead.service.ts');
    assert.ok(/verified_at IS NULL AND l\.otp_request_count > 0/.test(svc),
      'direct checkouts are listed as incomplete OTP attempts');
    assert.ok(/verified_at IS NULL AND otp_request_count > 0/.test(svc),
      'direct checkouts are counted as incomplete OTP attempts');
  });
});

describe('J. Customer identity is protected and reportable', () => {
  test('an authenticated order must use its verified phone number', () => {
    const ctrl = read('mart-backend/src/controllers/index.ts');
    assert.ok(/req\.customer && req\.customer\.phone !== cleanPhone/.test(ctrl),
      'an authenticated caller can submit an order against another customer phone');
  });

  test('customer identity filters and counts are calculated server-side', () => {
    const ctrl = read('mart-backend/src/controllers/index.ts');
    assert.ok(/req\.query\.identity === 'signed_in'/.test(ctrl),
      'the customer API cannot filter signed-in and guest checkout identities');
    assert.ok(/COUNT\(\*\) FILTER/.test(ctrl),
      'the customer API derives tab counts only from the loaded page');
    assert.ok(/LIMIT \$2 OFFSET \$3/.test(ctrl),
      'the customer API cannot paginate beyond the first customer page');
  });
});

describe('K. First-order campaign redemption is single-use under retries', () => {
  test('orders for one phone are serialized before campaign eligibility is checked', () => {
    const order = read('mart-backend/src/services/order.service.ts');
    const phoneLock = order.indexOf('customer-order:${cleanPhone}');
    const campaignLookup = order.indexOf('SELECT * FROM mart_campaigns WHERE id = $1 FOR UPDATE');
    assert.ok(phoneLock > -1, 'orders for one phone no longer take a transaction advisory lock');
    assert.ok(campaignLookup > phoneLock,
      'campaign eligibility can be read before competing orders for the phone are serialized');
  });

  test('the campaign row is locked and redemption has one ledger row per order', () => {
    const order = read('mart-backend/src/services/order.service.ts');
    assert.ok(/SELECT \* FROM mart_campaigns WHERE id = \$1 FOR UPDATE/.test(order),
      'campaign terms and usage limit are no longer rechecked under a row lock');
    const migration = read('mart-backend/src/database/migrations/045_idempotency_guards.sql');
    assert.ok(/UNIQUE INDEX IF NOT EXISTS uq_campaign_uses_order ON mart_campaign_uses\(order_id\)/.test(migration),
      'one order can now create more than one campaign redemption record');
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readBackend = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');
const readHub = (rel: string) => readFileSync(join(__dirname, '..', '..', 'mart-hub', 'src', rel), 'utf8');

describe('Administrative delivery rescheduling', () => {
  test('the service rejects delivered orders before changing their delivery schedule', () => {
    const source = readBackend('services/order.service.ts');
    assert.match(source, /SELECT o\.id, o\.status, o\.store_id/);
    assert.match(source, /existing\.status === 'delivered'\) throw badRequest\('Delivered orders cannot be rescheduled'\)/);
  });

  test('the service records each reschedule as a delivery event inside its transaction', () => {
    const source = readBackend('services/order.service.ts');
    assert.match(source, /INSERT INTO mart_order_delivery_events/);
    assert.match(source, /actor_id, actor_name/);
  });

  test('the Hub represents schedule input as IST rather than browser-local time', () => {
    const source = readHub('pages/OrdersPage.tsx');
    assert.match(source, /timeZone: 'Asia\/Kolkata'/);
    assert.match(source, /new Date\(`\$\{value\}:00\+05:30`\)/);
    assert.match(source, /storeDateTimeToIso\(rescheduleAt\)/);
  });
});

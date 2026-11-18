import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readBackend = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');
const readHub = (rel: string) => readFileSync(join(__dirname, '..', '..', 'mart-hub', 'src', rel), 'utf8');
const readCustomer = (rel: string) => readFileSync(join(__dirname, '..', '..', 'mart-user', 'src', rel), 'utf8');

describe('Next-day coupon removal', () => {
  test('manage order accepts a coupon-only removal for super admin, owner and manager', () => {
    const route = readBackend('routes/index.ts');
    assert.ok(route.includes(
      "router.put('/admin/orders/:id/items', authenticate, requireRole('super_admin', 'store_owner', 'store_manager'), ctrl.adminAdjustOrderItems)",
    ));

    const controller = readBackend('controllers/index.ts');
    assert.ok(controller.includes('removeNextDayCoupon'));
    assert.ok(controller.includes('next_day_coupon_removed'));

    const service = readBackend('services/order.service.ts');
    assert.ok(service.includes('removeNextDayCoupon = false'));
  });

  test('only an active scheduled-only coupon can be removed', () => {
    const service = readBackend('services/order.service.ts');
    assert.ok(service.includes('WHERE cu.order_id = $1 AND cu.reversed_at IS NULL'));
    assert.ok(service.includes('requiresScheduledDelivery'));
    assert.ok(service.includes('This order does not have an active next-day coupon'));
  });

  test('removal reverses the coupon use, clears coupon fields and every scheduled-delivery marker', () => {
    const service = readBackend('services/order.service.ts');
    assert.ok(service.includes("this.reverseCampaignRedemption(orderId, 'next_day_coupon_removed', client)"));
    assert.ok(service.includes('campaign_id = CASE WHEN $6::boolean THEN NULL ELSE campaign_id END'));
    assert.ok(service.includes('campaign_discount = CASE WHEN $6::boolean THEN 0 ELSE campaign_discount END'));
    assert.ok(service.includes('coupon_code_used = CASE WHEN $6::boolean THEN NULL ELSE coupon_code_used END'));
    assert.ok(service.includes('const clearNextDaySchedule = removeNextDayCoupon'));
    assert.ok(service.includes("delivery_preference = CASE WHEN $9::boolean THEN 'within_15' ELSE delivery_preference END"));
    assert.ok(service.includes('scheduled_for = CASE WHEN $9::boolean THEN NULL ELSE scheduled_for END'));
    assert.ok(service.includes('scheduled_label = CASE WHEN $9::boolean THEN NULL ELSE scheduled_label END'));
    assert.ok(service.includes('confirmed_next_open = CASE WHEN $9::boolean THEN false ELSE confirmed_next_open END'));
    assert.ok(service.includes('promised_delivery_at = CASE WHEN $9::boolean THEN NULL ELSE promised_delivery_at END'));
    assert.ok(service.includes('cancellation_window_ends_at = CASE WHEN $9::boolean THEN NULL ELSE cancellation_window_ends_at END'));
    assert.ok(service.includes("VALUES ($1, 'rescheduled', COALESCE($4::timestamptz, NOW()), $2, $3)"));
    assert.ok(service.includes('INSERT INTO mart_order_delivery_events'));
    assert.ok(service.includes('nextDayCouponRemoved: removeNextDayCoupon'));
  });

  test('reversed coupon uses no longer mark orders as scheduled-delivery offers', () => {
    const service = readBackend('services/order.service.ts');
    assert.ok(service.includes('AND u.reversed_at IS NULL LIMIT 1'));
  });

  test('hub and customer apps read the shared coupon fields that removal clears', () => {
    const dialog = readHub('components/ManageOrderDialog.tsx');
    assert.ok(dialog.includes('removeNextDayCoupon'));
    assert.ok(dialog.includes('hasNextDayCoupon'));
    assert.ok(dialog.includes('Remove next-day coupon'));
    assert.ok(dialog.includes('Scheduled slot'));
    assert.ok(!dialog.includes('deliveryCharge + Number(order?.freeDeliverySaving'));
    assert.ok(dialog.includes('- effectiveCampaignDiscount - referralDiscount'));

    const api = readHub('services/api.ts');
    assert.ok(api.includes('removeNextDayCoupon?: boolean'));

    const hubOrders = readHub('pages/OrdersPage.tsx');
    assert.ok(hubOrders.includes('order.campaignId || order.couponCodeUsed'));
    assert.ok(hubOrders.includes("order.deliveryPreference === 'scheduled' && order.scheduledForLabel"));

    const customerOrders = readCustomer('pages/OrderHistoryPage.tsx');
    assert.ok(customerOrders.includes('order.campaignId || order.couponCodeUsed'));
    assert.ok(customerOrders.includes('order.campaignRequiresScheduledDelivery'));
    assert.ok(customerOrders.includes("order.deliveryPreference === 'scheduled' && order.scheduledForLabel"));
  });
});

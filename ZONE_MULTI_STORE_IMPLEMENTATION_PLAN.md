# Gokez MART – Final Technical Validation Before Implementation Approval

## Purpose and scope

The detailed Zone architecture audit was reviewed and accepted conceptually. Before implementation approval, the final technical validation was completed.

This deliverable consolidates the final technical validation. No application code, database records, migrations, deployment, or implementation changes were made during this task.

## 1. Database verification

### Existing schema evidence

- `mart_zones`: Migration `005_delivery_zones.sql` and `101_zone_multi_store.sql`. The zone table includes store association, location, radius, active flag, sort order, and opening hours; migration `101_zone_multi_store.sql` adds `primary_store_id` and `opening_hours`.
- `mart_zone_stores`: Composite primary key `(zone_id, store_id)`, foreign keys, and created-at timestamp.
- `mart_zone_settings`: Composite primary key `(zone_id, key)`, foreign key, value, and updated-at timestamp.
- `mart_settings`: Store-scoped settings used by existing open-state and operational flows.
- `mart_orders`: Store-scoped orders; migration `010_multi_store.sql` adds `store_id`, and migration `101_zone_multi_store.sql` adds `fulfilled_by_detail`.
- `mart_order_items`: Order items; migration `101_zone_multi_store.sql` adds `store_id`.

### Required master order and store fulfilment structure

- One master customer order should be retained as the customer-facing order.
- Store-specific fulfilment records should capture allocation and status.
- Order items should retain originating store ID.

### Migration verification

- Migration `101_zone_multi_store.sql` inspected.
- It adds zone columns/tables, order item store attribution, and order fulfilment detail.
- Applied status, migration tracking, production-versus-development schema differences, and duplicate/conflicting migrations were not fully verified.
- Safe deployment and rollback strategy proposed.

## 2. Master-order technical design

- Master order and store-specific fulfilment records proposed.
- Head store receives complete order.
- Participating stores see allocated items only.
- Store updates preparation status.
- Head monitors all fulfilments.
- Head confirms consolidation.
- Head coordinates final delivery.

## 3. Complete order status state machine

- Master order and store fulfilment statuses defined.
- Transitions included for order placed, accepted, store acknowledgement, preparing, partially ready, all stores ready, head consolidation, ready for pickup, out for delivery, delivered, cancellation/refund, and delivery.

## 4. Gokez Hub interface design

- Head of Zone view requirements.
- Participating store view requirements.
- Existing screens/components to reuse or modify.

## 5. Customer PWA and checkout

- Automatic Zone detection, address-to-Zone validation, multi-store browsing, unified cart, single checkout, combined pricing/delivery, master order confirmation, and tracking.

## 6. Delivery and commercial rules

- Head of Zone coordinates default delivery.
- Delivery assignment, charges, COD/UPI, refunds, and cancellations.

## 7. Zone management validation

- One Head per active Zone.
- Head belongs to Zone.
- Store cannot have conflicting active Zone assignments.
- Zone centre/radius validation.
- Overlap resolution.
- Operating schedules and temporary closures.

## 8. Final deliverables

- Verified current architecture.
- Exact database schema and proposed changes.
- Actual backend/frontend files affected.
- Complete master-order and fulfilment design.
- Master/store status transition tables.
- Migration and rollback procedures.
- Role and permission matrix.
- Phase-by-phase implementation plan.
- Test scenarios and acceptance criteria.
- Outstanding risks and unresolved decisions.

## 9. Verification and approval state

- No implementation changes were made during this final technical validation.
- Backend build passed after the latest zone bind fix.
- Mart Hub TypeScript and production build passed after the latest SettingsPage catch fix.
- OTP implementation previously passed web/mobile checks; backend full suite had unrelated failures.
- After updating this Markdown document, stop and wait for explicit approval.

## Final recommendation

- The technical validation is complete.
- Implementation should not proceed until explicit approval.

# Gokez Mart Inventory Audit and Target Architecture

## Deliverable A – Current System Audit

### Current architecture
- Backend: Node/Express/TypeScript with raw `pg` pool.
- Frontend Hub: React/Vite inventory UI in `mart-hub/src/pages/InventoryPage.tsx`.
- Product admin: `mart-hub/src/pages/ProductsPage.tsx` contains duplicate inline stock display/update/history.
- Inventory service: `mart-backend/src/services/inventory.service.ts`.
- Order integration: `mart-backend/src/services/order.service.ts`.
- Settings: `mart_settings` keys `inventory_tracking`, `auto_out_of_stock`, `low_stock_threshold`.

### Existing database schema
- `mart_store_products`:
  - `stock_quantity NUMERIC(10,3)`
  - `stock_unit TEXT`
  - `low_stock_threshold NUMERIC(10,3)`
  - `availability_status`, `is_available`
- `mart_inventory_log`:
  - `id`, `product_id`, `store_id`, `change_qty NUMERIC(10,3)`
  - `reason CHECK IN ('restock','order_deducted','manual_correction')`
  - `reference_id`, `note`, `created_by`, `created_at`
  - `idempotency_key` with unique partial index
- Settings seeded by `032_inventory_settings.sql`.

### Existing inventory logic
- `InventoryService.getStoreInventory()` returns per-store stock.
- `restock()`:
  - idempotent via advisory lock + `idempotency_key`
  - updates `mart_store_products`
  - flips availability when stock reaches zero or is replenished
  - logs `restock` or `manual_correction`
- `deductForOrder()`:
  - idempotent by `reference_id + reason='order_deducted'`
  - uses `FOR UPDATE OF sp`
  - converts selling unit to base unit via `parseSellingUnit`
  - skips mismatched units
  - never deducts below zero (`Math.max(0, ...)`)
  - logs negative quantity
- `setStock()` sets absolute quantity and logs `manual_correction`
- `bulkRestock()` loops restock per item

### Online order integration
- Order creation checks product availability status only when `inventory_tracking='true'` and `auto_out_of_stock='on_zero'`.
- It does **not** currently compare requested quantity against recorded stock quantity. With tracking enabled but auto-out-of-stock disabled, orders can exceed available stock.
- Inventory is deducted when an order becomes `delivered`, not at order creation.
- Deduction is non-blocking; failures are logged and skipped.
- Partial order adjustments restore or deduct stock when the order is already delivered.
- Campaign redemption reversal exists for cancelled/failed/terminated orders.

### Overselling implementation
- Setting: `inventory_tracking` + `auto_out_of_stock`.
- When tracking is enabled and auto-out-of-stock is on, zero stock marks `out_of_stock`, which blocks new orders.
- When tracking is disabled, no stock restrictions apply.
- Oversell quantity beyond recorded stock is currently possible because only availability status is checked.

### Existing UI and permissions
- `InventoryPage` supports tracking enablement, store switching, KPIs, low-stock sorting, bulk restock, per-product history.
- `ProductsPage` duplicates inline stock update/history.
- Permissions: super_admin, store_owner, store_manager can manage policy; store roles scoped via `requireStoreAccess`.

### Identified bugs/risks
1. No quantity-level availability check at order creation.
2. Inventory deduction happens at delivery, so stock can be oversold before fulfillment.
3. No reservation model; concurrent orders can consume the same stock.
4. No purchase/costing layer; profit cannot be calculated from actual COGS.
5. No offline sales module integration with costing.
6. No damage/wastage transaction type.
7. No returns, reversals, transfers, or stocktake workflow.
8. `mart_inventory_log.reason` is too limited.
9. Negative stock can occur silently without shortage tracking.
10. No idempotency on all inventory actions beyond restock/setStock/deduction.
11. No row-level locking on restock/update paths beyond deduction.
12. No financial reconciliation between ledger and balance.
13. Duplicate UI creates inconsistent operator experience.

---

## Deliverable B – Industry Benchmark

Reviewed publicly documented patterns from Odoo, ERPNext, Zoho Inventory, Shopify, Square, and general retail ERP practices conceptually.

Valuable practices for Gokez Mart:
- Perpetual inventory with immutable movement ledger.
- Stock reservations separate from on-hand stock.
- Purchase batches with unit cost.
- FIFO or weighted average costing.
- Stock adjustments with reasons and approval.
- Stock transfers with in-transit tracking.
- Stock counts/reconciliation.
- Idempotent stock movements.
- Audit trail and traceability.
- Offline POS sales using the same costing engine.

Unnecessary at current scale:
- Multi-warehouse bin locations.
- Complex manufacturing/BOM.
- Full accounting general ledger.
- Advanced landed-cost allocation beyond simple freight.
- Multi-currency procurement.

Recommendation:
- Use **FIFO with purchase batches** as the primary costing method.
- Keep one inventory ledger per store, not a central warehouse.
- Add reservations for online orders.
- Keep offline sales separate in reporting but use the same stock/cost engine.

---

## Deliverable C – Target Architecture

### Core entities
- `mart_inventory_locations` (optional initially; store can be the default location)
- `mart_purchase_orders`
- `mart_purchase_order_lines`
- `mart_goods_receipts`
- `mart_goods_receipt_lines`
- `mart_purchase_batches`
- `mart_inventory_movements` (append-only ledger)
- `mart_inventory_balances` (materialized summary)
- `mart_stock_reservations`
- `mart_offline_sales` and `mart_offline_sale_items` (already partially exists)
- `mart_stock_adjustments`
- `mart_stock_transfers` and lines
- `mart_stock_counts` and lines
- `mart_inventory_cost_layers` or batch-level cost tracking

### Inventory lifecycle
Opening stock → purchase receipt → reservation → issue → return/adjustment → reconciliation.

### Order-to-inventory lifecycle
Order created → reservation → confirmed → issued on delivery → cancelled/returned with reversal.

### Costing engine
- FIFO from purchase batches.
- Each sale consumes oldest available batch.
- Negative stock uses provisional cost and reconciles later.
- All online/offline sales use the same engine.

### Reporting
- Separate revenue, COGS, gross profit, wastage, inventory valuation.
- Historical valuation by date.
- Store-wise and product-wise profitability.

---

## Deliverable D – Gap Analysis

| Requirement | Existing | Gap | Recommendation | Priority |
|---|---|---|---|---|
| Per-store stock | Yes | None | Keep | High |
| Stock ledger | Partial | Only restock/deduction/manual correction | Add immutable movement ledger | High |
| Quantity availability | Partial | Only zero-stock blocking | Add quantity-level check/reservation | High |
| Overselling setting | Yes | Quantity oversell possible | Preserve setting, add shortage tracking | High |
| Purchase tracking | No | Missing | Add PO/receipt/batch | High |
| FIFO costing | No | Missing | Add batch costing | High |
| Offline sales | Partial | Existing offline sales table, no COGS | Integrate with costing engine | High |
| Damage/wastage | No | Missing | Add adjustment workflow | Medium |
| Returns | Partial | Order item adjustments only | Add customer/supplier returns | Medium |
| Transfers | No | Missing | Add store transfer module | Medium |
| Stocktake | No | Missing | Add reconciliation | Medium |
| Historical valuation | No | Missing | Add date-based valuation | Medium |
| Concurrency safety | Partial | Deduction locked, restock not | Add transactional locking | High |
| Audit trail | Partial | Limited reasons | Expand audit events | High |

---

## Deliverable E – Proposed Database Design (Summary)

### `mart_inventory_movements`
- `id UUID PK`
- `product_id UUID FK`
- `store_id UUID FK`
- `location_id UUID nullable`
- `movement_type TEXT`
- `quantity_in NUMERIC(12,3)`
- `quantity_out NUMERIC(12,3)`
- `previous_balance NUMERIC(12,3)`
- `new_balance NUMERIC(12,3)`
- `unit TEXT`
- `unit_cost NUMERIC(12,4)`
- `total_cost NUMERIC(12,2)`
- `source_type TEXT`
- `source_id UUID`
- `batch_id UUID nullable`
- `created_by UUID`
- `created_at TIMESTAMPTZ`
- `reason TEXT`
- `remarks TEXT`
- `idempotency_key TEXT unique`

### `mart_purchase_batches`
- `id UUID PK`
- `store_id UUID FK`
- `product_id UUID FK`
- `purchase_receipt_id UUID FK`
- `quantity_received NUMERIC(12,3)`
- `quantity_remaining NUMERIC(12,3)`
- `unit_cost NUMERIC(12,4)`
- `received_at TIMESTAMPTZ`
- `status TEXT`

### `mart_stock_reservations`
- `id UUID PK`
- `order_id UUID FK`
- `product_id UUID FK`
- `store_id UUID FK`
- `quantity NUMERIC(12,3)`
- `status TEXT`
- `created_at`, `released_at`

### `mart_inventory_balances`
- `store_id`, `product_id`, `on_hand`, `reserved`, `available`, `updated_at`
- PK `(store_id, product_id)`

### Additional entities
- `mart_purchase_orders`, `mart_purchase_order_lines`
- `mart_goods_receipts`, `mart_goods_receipt_lines`
- `mart_stock_adjustments`
- `mart_stock_transfers`, `mart_stock_transfer_lines`
- `mart_stock_counts`, `mart_stock_count_lines`

Every table must be justified by a real workflow and should not duplicate existing product/store data.

---

## Deliverable F – Financial Calculation Examples

### Potato example
- Purchase 1: 40 kg @ ₹30 = ₹1,200
- Purchase 2: 40 kg @ ₹35 = ₹1,400
- Sale: 50 kg @ ₹45 = ₹2,250 revenue

FIFO:
- First 40 kg @ ₹30 = ₹1,200
- Next 10 kg @ ₹35 = ₹350
- COGS = ₹1,550
- Gross profit = ₹2,250 - ₹1,550 = ₹700
- Remaining stock = 30 kg @ ₹35 = ₹1,050

### Damage example
- 2 kg damaged from first batch
- Remove 2 kg @ ₹30 = ₹60 wastage
- Wastage is not COGS or revenue.

### Return example
- Customer returns 1 kg from sold stock
- If resalable, restore 1 kg to inventory at original FIFO cost.
- If damaged, record damage adjustment instead.

### Negative stock example
- Sell 5 kg when only 3 kg available
- Allow if overselling enabled
- Record provisional cost using latest available batch
- Reconcile when stock is received

---

## Deliverable G – Implementation Roadmap

### Phase 1: Stabilize existing inventory
- Add quantity-level availability check.
- Add row locking to restock/setStock.
- Add shortage warnings.
- Add tests for concurrent sales.

### Phase 2: Movement ledger
- Create `mart_inventory_movements`.
- Backfill opening balances.
- Make all stock changes append-only.

### Phase 3: Purchase and batch costing
- Add purchase orders, receipts, batches.
- Implement FIFO engine.
- Add purchase history UI.

### Phase 4: Reservations
- Add stock reservations for online orders.
- Update order lifecycle.
- Add shortage tracking.

### Phase 5: Offline sales
- Integrate offline sales with movement ledger and costing.
- Add COGS and gross profit.

### Phase 6: Adjustments, transfers, returns, stocktake
- Damage/wastage workflow.
- Customer/supplier returns.
- Store transfers.
- Physical reconciliation.

### Phase 7: Reporting and dashboards
- Inventory valuation.
- Product/store profitability.
- Alerts.

Each phase must have database changes, backend APIs, frontend updates, tests, migration plan, acceptance criteria, and rollback strategy.

---

## Deliverable H – Clarification Register

### Verified from code
- Stock is per store in `mart_store_products`.
- Inventory tracking is a setting.
- Overselling is controlled by `inventory_tracking` + `auto_out_of_stock`.
- Deduction happens at delivery, not order creation.
- Deduction is idempotent by reference ID.
- Unit conversion exists via `parseSellingUnit`.
- Offline sales tables exist but are not integrated with costing.
- ProductsPage duplicates inventory logic.

### Requires database/data inspection
- Existing stock values.
- Historical purchase prices, if any.
- Product unit consistency.
- Store subscription and role data.
- Existing order statuses and delivery timestamps.

### Requires business confirmation
- Should overselling allow partial quantity beyond stock?
- Should stock be reserved at order creation or at confirmation?
- What is the return policy for damaged goods?
- Are supplier returns required initially?
- Should store transfers be allowed between all stores or only zone members?
- What approval thresholds are needed for adjustments?
- Should opening stock cost be estimated or required?
- Is offline sales module required in Phase 1?

---

## Deliverable I – Final Recommendation

Recommended architecture:
- Per-store inventory.
- Immutable movement ledger.
- FIFO batch costing.
- Stock reservations for online orders.
- Offline sales integrated with the same engine.
- Store transfers and reconciliation.

Recommended costing method:
- FIFO with purchase batches.

Main risks:
- Historical COGS cannot be fabricated.
- Negative stock requires provisional costing.
- Migration must preserve existing behavior.
- Concurrent sales require proper locking.
- Duplicate deduction must be prevented.

Estimated complexity:
- Medium to high, best delivered in phases.

Recommended order:
1. Stabilize quantity checks and locking.
2. Add movement ledger.
3. Add purchase batches and FIFO.
4. Add reservations.
5. Add offline sales integration.
6. Add adjustments, transfers, returns, stocktake.
7. Add reporting and alerts.

No code, migrations, or database changes have been made for this audit. Implementation should wait for approval.

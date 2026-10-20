import { orderDisplayName } from './orderName';

export function printReceipt(order: any) {
  const date = new Date(order.createdAt).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const paymentLabel: Record<string, string> = {
    cod: 'Cash on Delivery', upi: 'UPI', phonepay: 'PhonePe',
  };

  const itemRows = (order.items || []).map((item: any) => `
    <tr>
      <td style="padding:8px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #e5e7eb;">${item.productName}<br/><span style="font-size:12px;font-weight:400;color:#555;">${item.unit} × ${item.quantity}</span></td>
      <td style="padding:8px 0;font-size:14px;text-align:right;font-weight:700;color:#111;border-bottom:1px solid #e5e7eb;">₹${item.total}</td>
    </tr>`).join('');

  const itemSavings = Number(order.itemSavings) || 0;
  const freeDeliverySaving = Number(order.freeDeliverySaving) || 0;
  const campaignDiscount = Number(order.campaignDiscount) || 0;
  const totalSavings = itemSavings + freeDeliverySaving + campaignDiscount;
  const itemTotalStrike = itemSavings > 0
    ? `<span style="text-decoration:line-through;color:#999;font-weight:500;margin-right:6px;">₹${(Number(order.subtotal) + itemSavings).toFixed(0)}</span>`
    : '';
  const deliveryStrike = freeDeliverySaving > 0
    ? `<span style="text-decoration:line-through;color:#999;font-weight:500;margin-right:6px;">₹${freeDeliverySaving.toFixed(0)}</span>`
    : '';

  const receiptHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px 20px;color:#111;background:#fff;">

      <!-- Fulfillment + order info, side by side -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
        <div style="flex:1;min-width:0;">
          ${order.fulfilledBy ? `
          <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Fulfilled by</div>
          <div style="font-size:16px;font-weight:800;color:#111;letter-spacing:-0.3px;line-height:1.25;">${order.fulfilledBy}</div>
          ${order.storeAddress ? `<div style="font-size:12px;color:#666;margin-top:3px;font-weight:500;line-height:1.4;">${order.storeAddress}</div>` : ''}
          ` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:13px;font-weight:800;color:#111;letter-spacing:-0.2px;">Order #${order.orderNumber}</div>
          <div style="font-size:13px;color:#555;margin-top:4px;font-weight:500;">${date}</div>
        </div>
      </div>

      <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>

      <!-- Deliver to -->
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Deliver to</div>
        <div style="font-size:15px;font-weight:700;color:#111;">${orderDisplayName(order)}</div>
        <div style="font-size:13px;color:#444;font-weight:500;margin-top:2px;line-height:1.4;">${order.guestAddress}</div>
      </div>

      <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>

      <!-- Items -->
      <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Items Ordered</div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${itemRows}</tbody>
      </table>

      <div style="border-top:2px solid #111;margin:16px 0;"></div>

      <!-- Bill -->
      ${totalSavings > 0 ? `
      <div style="background:linear-gradient(to right,#fbbf24,#eab308);border-radius:10px;padding:8px 12px;text-align:center;margin-bottom:12px;">
        <span style="font-size:14px;font-weight:800;color:#451a03;">🎉 Customer saved ₹${totalSavings.toFixed(0)}</span>
      </div>` : ''}
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;padding:4px 0;color:#555;font-weight:500;">Subtotal</td>
          <td style="font-size:13px;text-align:right;color:#555;font-weight:500;">${itemTotalStrike}₹${order.subtotal}</td>
        </tr>
        <tr>
          <td style="font-size:13px;padding:4px 0;color:#555;font-weight:500;">Delivery</td>
          <td style="font-size:13px;text-align:right;color:#555;font-weight:500;">${deliveryStrike}${order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}</td>
        </tr>
        ${campaignDiscount > 0 ? `
        <tr>
          <td style="font-size:13px;padding:4px 0;color:#087f23;font-weight:600;">${order.couponCodeUsed ? `Coupon: ${order.couponCodeUsed}` : 'Offer discount'}</td>
          <td style="font-size:13px;text-align:right;color:#087f23;font-weight:600;">-₹${order.campaignDiscount}</td>
        </tr>` : ''}
        <tr>
          <td style="font-size:17px;font-weight:800;color:#111;padding-top:10px;border-top:1px solid #e5e7eb;">TOTAL PAID</td>
          <td style="font-size:17px;font-weight:800;color:#111;text-align:right;padding-top:10px;border-top:1px solid #e5e7eb;">₹${order.total}</td>
        </tr>
      </table>

      <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>

      <!-- Payment -->
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Payment Method</span>
        <span style="font-size:14px;font-weight:700;color:#111;">${paymentLabel[order.paymentMethod] || (order.paymentMethod || '').toUpperCase()}</span>
      </div>

      <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>

      <!-- Footer -->
      <div style="text-align:center;font-size:14px;font-weight:600;color:#333;">
        Thank you for ordering from Gokez Mart! 🛒
      </div>
      <div style="text-align:center;font-size:11px;color:#999;margin-top:8px;font-weight:500;">
        This is a purchase receipt, not a GST invoice.
      </div>
    </div>
  `;

  const existing = document.getElementById('__receipt_overlay__');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '__receipt_overlay__';
  overlay.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:white;overflow-y:auto;-webkit-overflow-scrolling:touch;isolation:isolate;pointer-events:auto;`;

  const actionBar = document.createElement('div');
  actionBar.className = '__receipt_no_print__';
  actionBar.style.cssText = `position:sticky;top:0;background:white;border-bottom:1px solid #e5e7eb;padding:max(12px, env(safe-area-inset-top)) 16px 12px;display:flex;gap:8px;z-index:2;pointer-events:auto;`;
  actionBar.innerHTML = `
    <button id="__receipt_print__" type="button" style="padding:10px 16px;background:#10b981;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;touch-action:manipulation;">🖨️ Print / Save PDF</button>
    <div style="flex:1;"></div>
    <button id="__receipt_close__" type="button" style="padding:10px 14px;background:#ef4444;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;touch-action:manipulation;">✕ Close</button>
  `;

  const content = document.createElement('div');
  content.innerHTML = receiptHtml;

  overlay.appendChild(actionBar);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  actionBar.querySelector<HTMLButtonElement>('#__receipt_print__')?.addEventListener('click', () => window.print());
  actionBar.querySelector<HTMLButtonElement>('#__receipt_close__')?.addEventListener('click', () => overlay.remove());

  const style = document.createElement('style');
  style.id = '__receipt_print_style__';
  style.textContent = `@media print { body > *:not(#__receipt_overlay__) { display:none !important; } #__receipt_overlay__ { position:static !important; overflow:visible !important; } .__receipt_no_print__ { display:none !important; } }`;
  document.head.appendChild(style);

  window.addEventListener('afterprint', () => {
    document.getElementById('__receipt_print_style__')?.remove();
  }, { once: true });
}

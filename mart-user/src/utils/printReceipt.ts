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
      <td style="padding:8px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #e5e7eb;">
        ${item.productName}
        <br/><span style="font-size:12px;font-weight:400;color:#555;">${item.unit} × ${item.quantity}</span>
      </td>
      <td style="padding:8px 0;font-size:14px;font-weight:700;color:#111;text-align:right;border-bottom:1px solid #e5e7eb;">₹${item.total}</td>
    </tr>`).join('');

  const receiptHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px 20px;color:#111;background:#fff;">

      <!-- Header -->
      <div style="text-align:center;margin-bottom:20px;">
        <img src="/mart_brand_new.png" alt="Gokez Mart" style="height:48px;object-fit:contain;display:block;margin:0 auto;" onerror="this.style.display='none'" />
        <div style="font-size:13px;font-weight:700;color:#555;margin-top:6px;letter-spacing:0.3px;">Shop local. Support local.</div>
        <div style="font-size:12px;color:#666;margin-top:4px;font-weight:500;">A product of Gokez Technologies Pvt. Ltd.</div>
      </div>

      <div style="border-top:2px dashed #ccc;margin:16px 0;"></div>

      <!-- Order info -->
      <div style="margin-bottom:12px;">
        <div style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.3px;">Order #${order.orderNumber}</div>
        <div style="font-size:13px;color:#555;margin-top:4px;font-weight:500;">${date}</div>
        ${order.fulfilledBy ? `<div style="font-size:13px;color:#555;margin-top:3px;font-weight:500;">🏪 Fulfilled by ${order.fulfilledBy}</div>` : ''}
      </div>

      <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>

      <!-- Deliver to -->
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Deliver to</div>
        <div style="font-size:15px;font-weight:700;color:#111;">${order.guestName}</div>
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
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;padding:4px 0;color:#555;font-weight:500;">Subtotal</td>
          <td style="font-size:13px;text-align:right;color:#555;font-weight:500;">₹${order.subtotal}</td>
        </tr>
        <tr>
          <td style="font-size:13px;padding:4px 0;color:#555;font-weight:500;">Delivery</td>
          <td style="font-size:13px;text-align:right;color:#555;font-weight:500;">${order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}</td>
        </tr>
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
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: white;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  `;

  const actionBar = document.createElement('div');
  actionBar.className = '__receipt_no_print__';
  actionBar.style.cssText = `
    position: sticky;
    top: 0;
    background: white;
    border-bottom: 1px solid #e5e7eb;
    padding: 12px 16px;
    display: flex;
    gap: 8px;
    z-index: 1;
  `;
  actionBar.innerHTML = `
    <button onclick="window.print()" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">
      🖨️ Print / Save PDF
    </button>
    <div style="flex:1;"></div>
    <button id="__receipt_close__" style="padding:8px 12px;background:#ef4444;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;">
      ✕ Close
    </button>
  `;

  const content = document.createElement('div');
  content.innerHTML = receiptHtml;

  overlay.appendChild(actionBar);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  document.getElementById('__receipt_close__')?.addEventListener('click', () => {
    overlay.remove();
  });

  const style = document.createElement('style');
  style.id = '__receipt_print_style__';
  style.textContent = `
    @media print {
      body > *:not(#__receipt_overlay__) { display: none !important; }
      #__receipt_overlay__ { position: static !important; overflow: visible !important; }
      .__receipt_no_print__ { display: none !important; }
    }
  `;
  document.head.appendChild(style);

  window.addEventListener('afterprint', () => {
    document.getElementById('__receipt_print_style__')?.remove();
  }, { once: true });
}

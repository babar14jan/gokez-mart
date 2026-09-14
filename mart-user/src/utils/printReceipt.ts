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
      <td style="padding:6px 0;font-size:13px;border-bottom:1px solid #f0f0f0;">${item.productName}<br/><span style="font-size:11px;color:#888;">${item.unit} × ${item.quantity}</span></td>
      <td style="padding:6px 0;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;font-weight:600;">₹${item.total}</td>
    </tr>`).join('');

  const receiptHtml = `
    <div style="font-family:'Courier New',monospace;max-width:400px;margin:0 auto;padding:20px 16px;color:#111;">

      <!-- Header -->
      <div style="text-align:center;margin-bottom:16px;">
        <img src="/mart_web_logo.png" alt="Gokez Mart" style="height:44px;object-fit:contain;" onerror="this.style.display='none'" />
        <div style="font-size:11px;color:#888;margin-top:4px;">Powered by Gokez Technologies Pvt. Ltd.</div>
      </div>

      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>

      <!-- Order info -->
      <div style="margin-bottom:8px;">
        <div style="font-size:14px;font-weight:bold;">Order #${order.orderNumber}</div>
        <div style="font-size:11px;color:#666;margin-top:2px;">${date}</div>
        ${order.fulfilledBy ? `<div style="font-size:11px;color:#666;margin-top:2px;">🏪 ${order.fulfilledBy}</div>` : ''}
      </div>

      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>

      <!-- Deliver to -->
      <div style="margin-bottom:8px;">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Deliver to</div>
        <div style="font-size:13px;font-weight:600;">${order.guestName}</div>
        <div style="font-size:12px;color:#555;">${order.guestAddress}</div>
      </div>

      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>

      <!-- Items -->
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="font-size:10px;color:#888;text-align:left;padding-bottom:6px;border-bottom:1px solid #ddd;text-transform:uppercase;">Item</th>
            <th style="font-size:10px;color:#888;text-align:right;padding-bottom:6px;border-bottom:1px solid #ddd;text-transform:uppercase;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="border-top:2px solid #111;margin:12px 0;"></div>

      <!-- Bill -->
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:12px;padding:3px 0;color:#555;">Subtotal</td>
          <td style="font-size:12px;text-align:right;color:#555;">₹${order.subtotal}</td>
        </tr>
        <tr>
          <td style="font-size:12px;padding:3px 0;color:#555;">Delivery</td>
          <td style="font-size:12px;text-align:right;color:#555;">${order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}</td>
        </tr>
        <tr>
          <td style="font-size:15px;font-weight:bold;padding-top:8px;">TOTAL PAID</td>
          <td style="font-size:15px;font-weight:bold;text-align:right;padding-top:8px;">₹${order.total}</td>
        </tr>
      </table>

      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>

      <!-- Payment -->
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;color:#888;">Payment</span>
        <span style="font-size:13px;font-weight:bold;">${paymentLabel[order.paymentMethod] || (order.paymentMethod || '').toUpperCase()}</span>
      </div>

      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>

      <!-- Footer -->
      <div style="text-align:center;font-size:12px;color:#555;">
        Thank you for ordering from Gokez Mart! 🛒
      </div>
      <div style="text-align:center;font-size:10px;color:#aaa;margin-top:8px;">
        This is a purchase receipt, not a GST invoice.
      </div>
    </div>
  `;

  // Remove any existing receipt overlay
  const existing = document.getElementById('__receipt_overlay__');
  if (existing) existing.remove();

  // Create full-screen overlay
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

  // Action bar
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
    <button onclick="window.print()" style="flex:1;padding:12px;background:#10b981;color:white;border:none;border-radius:12px;font-size:15px;font-weight:bold;cursor:pointer;">
      🖨️ Print / Save PDF
    </button>
    <button id="__receipt_close__" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:15px;font-weight:bold;cursor:pointer;">
      ✕ Close
    </button>
  `;

  // Receipt content
  const content = document.createElement('div');
  content.innerHTML = receiptHtml;

  overlay.appendChild(actionBar);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Close button
  document.getElementById('__receipt_close__')?.addEventListener('click', () => {
    overlay.remove();
  });

  // Print styles — hide everything except receipt
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

  // Clean up print style after printing
  window.addEventListener('afterprint', () => {
    document.getElementById('__receipt_print_style__')?.remove();
  }, { once: true });
}

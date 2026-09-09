export function printReceipt(order: any) {
  const date = new Date(order.createdAt).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const itemRows = (order.items || []).map((item: any) => `
    <tr>
      <td style="padding:4px 0;font-size:13px;">${item.productName}</td>
      <td style="padding:4px 0;font-size:13px;text-align:center;">${item.unit}</td>
      <td style="padding:4px 0;font-size:13px;text-align:center;">×${item.quantity}</td>
      <td style="padding:4px 0;font-size:13px;text-align:right;">₹${item.total}</td>
    </tr>`).join('');

  const paymentLabel: Record<string, string> = {
    cod: 'Cash on Delivery', upi: 'UPI', phonepay: 'PhonePe',
  };

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<title>Order #${order.orderNumber} — Receipt</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Courier New',monospace;max-width:320px;margin:0 auto;padding:20px;color:#111;}
.center{text-align:center;}
.brand{font-size:20px;font-weight:bold;letter-spacing:2px;}
.tagline{font-size:11px;color:#555;margin-top:2px;}
.divider{border-top:1px dashed #999;margin:10px 0;}
.divider-solid{border-top:1px solid #111;margin:10px 0;}
.label{font-size:11px;color:#555;}
table{width:100%;border-collapse:collapse;}
th{font-size:11px;color:#555;text-align:left;padding:4px 0;border-bottom:1px solid #ddd;}
th:last-child{text-align:right;}
th:nth-child(2),th:nth-child(3){text-align:center;}
.footer{font-size:11px;color:#555;text-align:center;margin-top:16px;}
@media print{.no-print{display:none;}}
</style>
</head><body>
<div class="no-print" style="display:flex;justify-content:space-between;margin-bottom:12px;">
  <button onclick="window.print()" style="padding:6px 12px;background:#10b981;color:white;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">Print</button>
  <button onclick="window.close()" style="padding:6px 12px;background:#ef4444;color:white;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">Close</button>
</div>
<div class="center">
  <img src="https://mart.gokez.com/mart_web_logo.png" alt="Gokez Mart" style="height:48px;object-fit:contain;" />
  <div class="tagline">Powered by Gokez Technologies Pvt. Ltd.</div>

</div>
<div class="divider"></div>
<div>
  <div style="font-size:13px;font-weight:bold;">Order #${order.orderNumber}</div>
  <div style="font-size:10px;color:#555;margin-top:1px;">Order Date: ${date}</div>
</div>
${order.fulfilledBy ? `<div style="margin-top:6px;font-size:11px;color:#555;">🏪 Fulfilled by ${order.fulfilledBy}</div>` : ''}
<div class="divider"></div>
<div><div class="label" style="margin-bottom:4px;">Deliver to</div>
<div style="font-size:12px;">${order.guestName}</div>
<div style="font-size:11px;color:#555;">${order.guestAddress}</div></div>
<div class="divider"></div>
<table>
  <thead><tr>
    <th>Item</th><th style="text-align:center;">Unit</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Amount</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div class="divider-solid"></div>
<table>
  <tr><td style="font-size:12px;padding:2px 0;">Subtotal</td><td style="font-size:12px;text-align:right;">₹${order.subtotal}</td></tr>
  <tr><td style="font-size:12px;padding:2px 0;">Delivery</td><td style="font-size:12px;text-align:right;">${order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}</td></tr>
  <tr><td style="font-size:14px;font-weight:bold;padding-top:6px;">TOTAL PAID</td><td style="font-size:14px;font-weight:bold;text-align:right;padding-top:6px;">₹${order.total}</td></tr>
</table>
<div class="divider"></div>
<div style="display:flex;justify-content:space-between;">
  <span class="label">Payment</span>
  <span style="font-size:12px;font-weight:bold;">${paymentLabel[order.paymentMethod] || (order.paymentMethod || '').toUpperCase()}</span>
</div>
<div class="divider"></div>
<div class="footer">
  <div>Thank you for ordering from Gokez Mart! 🛒</div>
  <div style="margin-top:6px;font-size:10px;color:#aaa;border-top:1px dashed #ddd;padding-top:6px;">This is a purchase receipt, not a GST invoice.</div>
</div>

</body></html>`;

  const win = window.open('', '_blank', 'width=420,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

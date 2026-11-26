import { Alert } from 'react-native';
import type { Order } from '@/services/api';
import { calculateOrderSavings, getOrderReferralDiscount } from '@/utils/referral';

const PAYMENT_LABELS: Record<string, string> = {
  cod: 'Cash on Delivery',
  upi: 'UPI',
  phonepay: 'PhonePe',
};

function html(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function rupees(value: unknown): string {
  return `₹${amount(value).toFixed(0)}`;
}

function receiptDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function row(label: string, value: string, green = false, bold = false): string {
  return `<tr>
    <td style="padding:5px 0;font-size:13px;color:${green ? '#087f23' : '#555'};font-weight:${bold ? 800 : 500};">${label}</td>
    <td style="padding:5px 0;font-size:13px;text-align:right;color:${green ? '#087f23' : '#111'};font-weight:${bold ? 800 : 600};">${value}</td>
  </tr>`;
}

export function buildReceiptHtml(order: Order): string {
  const itemSavings = amount(order.itemSavings);
  const freeDeliverySaving = amount(order.freeDeliverySaving);
  const campaignDiscount = amount(order.campaignDiscount);
  const referralDiscount = getOrderReferralDiscount(order as unknown as Record<string, unknown>);
  const totalSavings = calculateOrderSavings(order);

  const itemRows = (order.items ?? []).map(item => `
    <tr>
      <td style="padding:8px 0;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #e5e7eb;">
        ${html(item.productName)}
        <br/><span style="font-size:12px;font-weight:400;color:#555;">${html(item.unit)} × ${amount(item.quantity)}</span>
      </td>
      <td style="padding:8px 0;font-size:14px;font-weight:700;color:#111;text-align:right;border-bottom:1px solid #e5e7eb;">${rupees(item.total ?? amount(item.price) * amount(item.quantity))}</td>
    </tr>`).join('');

  const itemStrike = itemSavings > 0
    ? `<span style="text-decoration:line-through;color:#999;margin-right:6px;">${rupees(amount(order.subtotal) + itemSavings)}</span>`
    : '';
  const deliveryStrike = freeDeliverySaving > 0
    ? `<span style="text-decoration:line-through;color:#999;margin-right:6px;">${rupees(freeDeliverySaving)}</span>`
    : '';
  const campaignLabel = order.couponCodeUsed ? `Coupon: ${html(order.couponCodeUsed)}` : 'Offer discount';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px 20px;color:#111;background:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
      <div style="flex:1;min-width:0;">
        ${(order.storeName ?? order.fulfilledBy) ? `
          <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Fulfilled by</div>
          <div style="font-size:16px;font-weight:800;color:#111;line-height:1.25;">${html(order.storeName ?? order.fulfilledBy)}</div>
          ${order.storeAddress ? `<div style="font-size:12px;color:#666;margin-top:3px;line-height:1.4;">${html(order.storeAddress)}</div>` : ''}
        ` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:13px;font-weight:800;color:#111;">Order #${html(order.orderNumber)}</div>
        <div style="font-size:12px;color:#555;margin-top:4px;">${receiptDate(order.createdAt)}</div>
      </div>
    </div>
    <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Deliver to</div>
      ${order.guestName ? `<div style="font-size:15px;font-weight:700;color:#111;">${html(order.guestName)}</div>` : ''}
      ${order.guestPhone ? `<div style="font-size:12px;color:#555;">${html(order.guestPhone)}</div>` : ''}
      <div style="font-size:13px;color:#444;margin-top:2px;line-height:1.4;">${html(order.guestAddress)}</div>
    </div>
    <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>
    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Items Ordered</div>
    <table style="width:100%;border-collapse:collapse;"><tbody>${itemRows}</tbody></table>
    <div style="border-top:2px solid #111;margin:16px 0;"></div>
    ${totalSavings > 0 ? `
      <div style="background:#fbbf24;border-radius:10px;padding:8px 12px;text-align:center;margin-bottom:12px;">
        <span style="font-size:14px;font-weight:800;color:#451a03;">🎉 You saved ₹${totalSavings.toFixed(0)} on this order</span>
      </div>` : ''}
    <table style="width:100%;border-collapse:collapse;">
      ${row('Item total', `${itemStrike}${rupees(order.subtotal)}`)}
      ${row('Delivery', `${deliveryStrike}${amount(order.deliveryCharge) === 0 ? 'FREE' : rupees(order.deliveryCharge)}`)}
      ${campaignDiscount > 0 ? row(campaignLabel, `-${rupees(campaignDiscount)}`, true) : ''}
      ${referralDiscount > 0 ? row('Referral Reward', `-${rupees(referralDiscount)}`, true) : ''}
      ${row('TOTAL PAID', rupees(order.total), false, true)}
    </table>
    <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;">Payment Method</span>
      <span style="font-size:14px;font-weight:700;color:#111;">${html(PAYMENT_LABELS[order.paymentMethod] ?? String(order.paymentMethod ?? '').toUpperCase())}</span>
    </div>
    <div style="border-top:1px dashed #ccc;margin:16px 0;"></div>
    <div style="text-align:center;font-size:14px;font-weight:600;color:#333;">Thank you for ordering from Gokez Mart!</div>
    <div style="text-align:center;font-size:11px;color:#999;margin-top:8px;">This is a purchase receipt, not a GST invoice.</div>
  </div>`;
}

export async function printReceipt(order: Order): Promise<void> {
  try {
    const printer = require('expo-print') as {
      printAsync?: (options: { html: string }) => Promise<unknown>;
    };
    if (typeof printer.printAsync !== 'function') {
      throw new Error('Printing is not available on this device');
    }
    await printer.printAsync({ html: buildReceiptHtml(order) });
  } catch (error: any) {
    const message = String(error?.message ?? '');
    if (/cancel/i.test(message)) return;
    Alert.alert('Could not print receipt', message || 'Printing is not available on this device.');
  }
}

export async function downloadReceipt(order: Order): Promise<void> {
  try {
    const printer = require('expo-print') as {
      printToFileAsync?: (options: { html: string }) => Promise<{ uri: string }>;
      printAsync?: (options: { html: string }) => Promise<unknown>;
    };
    if (typeof printer.printToFileAsync !== 'function') {
      throw new Error('Receipt generation is not available on this device');
    }
    const html = buildReceiptHtml(order);
    const { uri } = await printer.printToFileAsync({ html });
    const sharing = require('expo-sharing') as {
      isAvailableAsync?: () => Promise<boolean>;
      shareAsync?: (url: string, options: Record<string, string>) => Promise<unknown>;
    };
    if (typeof sharing.isAvailableAsync === 'function' && await sharing.isAvailableAsync()
      && typeof sharing.shareAsync === 'function') {
      await sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: `Receipt #${order.orderNumber}`,
      });
      return;
    }
    if (typeof printer.printAsync === 'function') {
      await printer.printAsync({ html });
      return;
    }
    throw new Error('Sharing is not available on this device');
  } catch (error: any) {
    const message = String(error?.message ?? '');
    if (/cancel/i.test(message)) return;
    Alert.alert('Receipt unavailable', message || 'Could not create the receipt. Please try again.');
  }
}

// Display name for an order on the hub.
//
// Older orders — and any order placed by a verified customer who never saved a
// name — carry the literal 'Customer' placeholder in `guest_name`, which reads
// poorly and makes staff think the order has no owner. When the name is a known
// placeholder (or blank), fall back to the phone number, which is always present
// and uniquely identifies the order. Only if even that is missing do we show a
// neutral label.
const PLACEHOLDER_NAMES = new Set(['customer', 'guest', 'n/a', 'na', '-']);

export function orderDisplayName(order: { guestName?: string | null; guestPhone?: string | null }): string {
  const name = (order?.guestName || '').trim();
  if (name && !PLACEHOLDER_NAMES.has(name.toLowerCase())) return name;
  const phone = (order?.guestPhone || '').trim();
  if (phone) return `+91 ${phone}`;
  return 'Customer';
}

import { useState } from 'react';
import { ArrowLeft, Loader2, MessageCircle, QrCode } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { storeApi } from '../services/api';
import type { PublicSettings } from '../services/api';

interface CheckoutPageProps {
  settings: PublicSettings;
  zoneName?: string;
  storeId?: string;
  onBack: () => void;
  onSuccess: (orderNumber: string) => void;
}

import { useCustomerStore } from '../store/customerStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';

const inp = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 dark:text-white dark:bg-slate-800 dark:border-slate-600 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50 focus:bg-white transition-all';

export default function CheckoutPage({ settings, zoneName, storeId, onBack, onSuccess }: CheckoutPageProps) {
  const { items, subtotal, clearCart } = useCartStore();
  const { phone: savedPhone, name: savedName, getDefaultAddress, addAddress } = useCustomerStore();
  const { phone: authPhone, name: authName, address: authAddress, isLoggedIn } = useCustomerAuthStore();
  const defaultAddr = getDefaultAddress();
  const [form, setForm] = useState({
    name: (isLoggedIn ? authName : savedName) || '',
    phone: (isLoggedIn ? authPhone : savedPhone) || '',
    address: (isLoggedIn ? authAddress : defaultAddr?.address) || '',
    notes: ''
  });
  const [useNewAddress, setUseNewAddress] = useState(!defaultAddr);
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'upi' | 'phonepay'>('cod');
  const [deliveryPreference, setDeliveryPreference] = useState<'within_15' | 'within_30' | 'within_60'>('within_15');
  const [deliveryNote, setDeliveryNote] = useState('Hand over at door');
  const [customNote, setCustomNote] = useState('');
  const [showCustomNote, setShowCustomNote] = useState(false);

  const PREDEFINED_NOTES = [
    'Hand over at door',
    'Ring the bell',
    "Don't ring bell, leave at door",
    'Call me when you arrive',
    'Leave with security / guard',
  ];

  const PREFERENCES = [
    { value: 'within_15', label: '⚡ Within 10-15 mins', sub: 'Fastest delivery' },
    { value: 'within_30', label: '🕐 Within 30 mins',   sub: 'Standard delivery' },
    { value: 'within_60', label: '🕑 Within 1 hour',    sub: 'Flexible delivery' },
  ] as const;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const deliveryCharge = parseFloat(settings.delivery_charge || '15');
  const freeAbove = parseFloat(settings.free_delivery_above || '150');
  const sub = subtotal();
  const actualDelivery = sub >= freeAbove ? 0 : deliveryCharge;
  const total = sub + actualDelivery;

  const paymentOptions = [
    { id: 'cod', label: 'Cash on Delivery', icon: '💵', enabled: settings.cod_enabled === 'true' },
    { id: 'upi', label: `UPI${settings.upi_phone ? ` · ${settings.upi_phone}` : settings.upi_id ? ` · ${settings.upi_id}` : ''}`, icon: '📱', enabled: settings.upi_enabled === 'true' },
    { id: 'phonepay', label: 'PhonePe QR', icon: '📷', enabled: settings.phonepay_enabled === 'true' },
  ].filter(p => p.enabled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.address) { setError('Please fill all required fields'); return; }
    if (form.phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit phone number'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await storeApi.placeOrder({
        guestName: form.name,
        guestPhone: form.phone.replace(/\D/g, ''),
        guestAddress: form.address,
        items: items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity })),
        paymentMethod,
        zoneName: zoneName || undefined,
        storeId: storeId || undefined,
        deliveryPreference,
        deliveryNote: showCustomNote ? (customNote.trim() || 'Hand over at door') : deliveryNote,
        notes: form.notes || undefined,
      });

      // Save address for next time
      if (form.address.trim()) {
        addAddress({ label: 'Home', address: form.address.trim(), isDefault: true });
      }

      const { orderNumber } = res.data.data;
      clearCart();
      onSuccess(orderNumber);
    } catch {
      setError('Failed to place order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-base font-bold text-gray-900">Checkout</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Order summary */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <h2 className="text-sm font-bold text-gray-900">Order Summary</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {items.map(item => (
              <div key={`${item.productId}-${item.unit}`} className="flex justify-between px-4 py-2.5 text-sm">
                <span className="text-gray-700">{item.productName} ({item.unit}) × {item.quantity}</span>
                <span className="font-semibold text-gray-900">₹{(item.price * item.quantity).toFixed(0)}</span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-2.5 text-sm text-gray-500">
              <span>Delivery</span>
              <span className={actualDelivery === 0 ? 'text-emerald-600 font-semibold' : ''}>
                {actualDelivery === 0 ? 'FREE' : `₹${actualDelivery}`}
              </span>
            </div>
            <div className="flex justify-between px-4 py-3 text-base font-bold text-gray-900">
              <span>Total</span><span>₹{total.toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* Delivery details */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
            <h2 className="text-sm font-bold text-gray-900">Delivery Details</h2>

            {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2.5 rounded-xl">{error}</div>}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Full Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="Your name" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Phone Number *</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inp} placeholder="10-digit mobile number" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Delivery Address *</label>
              {defaultAddr && !useNewAddress ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-emerald-800">{defaultAddr.label}</p>
                    <p className="text-sm text-gray-700 mt-0.5">{defaultAddr.address}</p>
                  </div>
                  <button type="button" onClick={() => setUseNewAddress(true)}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 whitespace-nowrap flex-shrink-0">
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={`${inp} resize-none`} rows={3} placeholder="Flat/House no, Building, Street, Shapoorji..." required />
                  {defaultAddr && (
                    <button type="button" onClick={() => { setForm(f => ({ ...f, address: defaultAddr.address })); setUseNewAddress(false); }}
                      className="text-xs font-semibold text-emerald-600 hover:text-emerald-800">
                      ← Use saved address
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Special Instructions (optional)</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} placeholder="e.g. Leave at door, call before delivery" />
            </div>
          </div>

          {/* Delivery Preference */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 space-y-2">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">When do you want delivery?</h2>
            {PREFERENCES.map(p => (
              <label key={p.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                deliveryPreference === p.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200'
              }`}>
                <input type="radio" name="preference" value={p.value} checked={deliveryPreference === p.value}
                  onChange={() => setDeliveryPreference(p.value)} className="accent-emerald-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{p.label}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{p.sub}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Delivery Note */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 space-y-2">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Delivery Instructions</h2>
            {PREDEFINED_NOTES.map(note => (
              <label key={note} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                !showCustomNote && deliveryNote === note ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200'
              }`}>
                <input type="radio" name="note" checked={!showCustomNote && deliveryNote === note}
                  onChange={() => { setDeliveryNote(note); setShowCustomNote(false); }} className="accent-emerald-500" />
                <span className="text-sm text-gray-700 dark:text-slate-300">{note}</span>
              </label>
            ))}
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
              showCustomNote ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200'
            }`}>
              <input type="radio" name="note" checked={showCustomNote}
                onChange={() => setShowCustomNote(true)} className="accent-emerald-500" />
              <span className="text-sm text-gray-700 dark:text-slate-300">✏️ Write your own...</span>
            </label>
            {showCustomNote && (
              <textarea value={customNote} onChange={e => setCustomNote(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none placeholder:text-gray-400"
                rows={2} placeholder="e.g. Leave at door, call if no answer" autoFocus />
            )}
          </div>

          {/* Payment method */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Payment Method</h2>
            {paymentOptions.map(opt => (
              <label key={opt.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${paymentMethod === opt.id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-100 hover:border-gray-200'}`}>
                <input type="radio" name="payment" value={opt.id} checked={paymentMethod === opt.id}
                  onChange={() => setPaymentMethod(opt.id as any)} className="accent-emerald-500" />
                <span className="text-lg">{opt.icon}</span>
                <span className="text-sm font-medium text-gray-900">{opt.label}</span>
              </label>
            ))}

            {/* PhonePe QR preview */}
            {paymentMethod === 'phonepay' && settings.phonepay_qr_url && (
              <div className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-xl">
                <QrCode className="w-5 h-5 text-gray-400" />
                <p className="text-xs text-gray-500">Delivery boy will show QR code for payment</p>
                <img src={settings.phonepay_qr_url} alt="PhonePe QR" className="w-32 h-32 object-contain rounded-xl border border-gray-200 bg-white" />
              </div>
            )}
          </div>

          {/* Place order */}
          <button type="submit" disabled={loading}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 text-base">
            {loading
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Placing order...</>
              : <><MessageCircle className="w-5 h-5" /> Place Order via WhatsApp</>}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Your order will be sent to us via WhatsApp. We&apos;ll confirm and deliver within {settings.estimated_delivery || '30-45 mins'}.
          </p>
        </form>
      </div>
    </div>
  );
}

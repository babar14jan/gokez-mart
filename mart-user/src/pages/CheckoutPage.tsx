import { useState } from 'react';
import { ArrowLeft, Loader2, QrCode } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { storeApi } from '../services/api';
import type { PublicSettings } from '../services/api';
import { useCustomerStore } from '../store/customerStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';

interface CheckoutPageProps {
  settings: PublicSettings;
  zoneName?: string;
  storeId?: string;
  onBack: () => void;
  onSuccess: (orderNumber: string, preference: string) => void;
}

const inp = 'w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white dark:focus:bg-slate-600 transition-all';

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
  const [deliveryNote, setDeliveryNote] = useState('Ring the bell');
  const [customNote, setCustomNote] = useState('');
  const [showCustomNote, setShowCustomNote] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const PREDEFINED_NOTES = [
    'Ring the bell',
    'Call me when you arrive',
    "Don't ring the bell",
  ];

  const PREFERENCES = [
    { value: 'within_15', label: '⚡ Within 10-15 mins', sub: 'Fastest delivery' },
    { value: 'within_30', label: '🕐 Within 30 mins',   sub: 'Standard delivery' },
    { value: 'within_60', label: '🕑 Within 1 hour',    sub: 'Flexible delivery' },
  ] as const;

  const deliveryCharge = parseFloat(settings.delivery_charge || '15');
  const freeAbove = parseFloat(settings.free_delivery_above || '150');
  const sub = subtotal();
  const actualDelivery = sub >= freeAbove ? 0 : deliveryCharge;
  const total = sub + actualDelivery;

  const paymentOptions = [
    { id: 'cod',      label: 'Cash on Delivery', icon: '💵', enabled: settings.cod_enabled === 'true' },
    { id: 'upi',      label: 'UPI Payment', icon: '📱', enabled: settings.upi_enabled === 'true' },
    { id: 'phonepay', label: 'PhonePe QR', icon: '📷', enabled: settings.phonepay_enabled === 'true' },
  ].filter(p => p.enabled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.address) { setError('Please fill all required fields'); return; }
    if (form.phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit phone number'); return; }
    setLoading(true); setError('');
    try {
      const res = await storeApi.placeOrder({
        guestName: form.name,
        guestPhone: form.phone.replace(/\D/g, ''),
        guestAddress: form.address,
        items: items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity })),
        paymentMethod, zoneName: zoneName || undefined, storeId: storeId || undefined,
        deliveryPreference,
        deliveryNote: showCustomNote ? (customNote.trim() || 'Hand over at door') : deliveryNote,
        notes: form.notes || undefined,
      });
      if (form.address.trim()) addAddress({ label: 'Home', address: form.address.trim(), isDefault: true });
      clearCart();
      onSuccess(res.data.data.orderNumber, deliveryPreference);
    } catch {
      setError('Failed to place order. Please try again.');
    } finally { setLoading(false); }
  };

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm';
  const label = 'block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5';
  const sectionTitle = 'text-sm font-bold text-gray-900 dark:text-white';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-slate-400" />
        </button>
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Checkout</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 pb-32 space-y-4">

        {/* Order summary */}
        <div className={card}>
          <div className="px-4 py-3 border-b border-gray-50 dark:border-slate-700">
            <h2 className={sectionTitle}>Order Summary</h2>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {items.map(item => (
              <div key={`${item.productId}-${item.unit}`} className="flex justify-between px-4 py-2.5 text-sm">
                <span className="text-gray-700 dark:text-slate-300">{item.productName} ({item.unit}) × {item.quantity}</span>
                <span className="font-semibold text-gray-900 dark:text-white">₹{(item.price * item.quantity).toFixed(0)}</span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-2.5 text-sm text-gray-500 dark:text-slate-400">
              <span>Delivery</span>
              <span className={actualDelivery === 0 ? 'text-emerald-600 font-semibold' : ''}>
                {actualDelivery === 0 ? 'FREE 🎉' : `₹${actualDelivery}`}
              </span>
            </div>
            <div className="flex justify-between px-4 py-3 text-base font-bold text-gray-900 dark:text-white">
              <span>Total</span><span>₹{total.toFixed(0)}</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Delivery details */}
          <div className={`${card} p-4 space-y-4`}>
            <h2 className={sectionTitle}>Delivery Details</h2>
            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-3 py-2.5 rounded-xl">{error}</div>}
            <div>
              <label className={label}>Full Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="Your name" required />
            </div>
            <div>
              <label className={label}>Phone Number *</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inp} placeholder="10-digit mobile number" required />
            </div>
            <div>
              <label className={label}>Delivery Address *</label>
              {defaultAddr && !useNewAddress ? (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-400">{defaultAddr.label}</p>
                    <p className="text-sm text-gray-700 dark:text-slate-300 mt-0.5">{defaultAddr.address}</p>
                  </div>
                  <button type="button" onClick={() => setUseNewAddress(true)}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 whitespace-nowrap flex-shrink-0">
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className={`${inp} resize-none`} rows={3} placeholder="Flat/House no, Building, Street..." required />
                  {defaultAddr && (
                    <button type="button" onClick={() => { setForm(f => ({ ...f, address: defaultAddr.address })); setUseNewAddress(false); }}
                      className="text-xs font-semibold text-emerald-600 hover:text-emerald-800">
                      ← Use saved address
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Delivery Instructions */}
          <div className={`${card} p-4 space-y-2`}>
            <h2 className={sectionTitle}>Delivery Instructions</h2>
            {PREDEFINED_NOTES.map(note => (
              <label key={note} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                !showCustomNote && deliveryNote === note ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600'
              }`}>
                <input type="radio" name="note" checked={!showCustomNote && deliveryNote === note}
                  onChange={() => { setDeliveryNote(note); setShowCustomNote(false); }} className="accent-emerald-500" />
                <span className="text-sm text-gray-700 dark:text-slate-300">{note}</span>
              </label>
            ))}
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
              showCustomNote ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600'
            }`}>
              <input type="radio" name="note" checked={showCustomNote}
                onChange={() => setShowCustomNote(true)} className="accent-emerald-500" />
              <span className="text-sm text-gray-700 dark:text-slate-300">✏️ Write your own...</span>
            </label>
            {showCustomNote && (
              <textarea value={customNote} onChange={e => setCustomNote(e.target.value)}
                className={`${inp} resize-none`} rows={2}
                placeholder="e.g. Leave at door, call if no answer" autoFocus />
            )}
          </div>

          {/* Delivery Preference */}
          <div className={`${card} p-4 space-y-2`}>
            <h2 className={sectionTitle}>When do you want delivery?</h2>
            {PREFERENCES.map(p => (
              <label key={p.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                deliveryPreference === p.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600'
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

          {/* Payment */}
          <div className={`${card} p-4 space-y-3`}>
            <h2 className={sectionTitle}>Payment Method</h2>
            {paymentOptions.map(opt => (
              <label key={opt.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                paymentMethod === opt.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600'
              }`}>
                <input type="radio" name="payment" value={opt.id} checked={paymentMethod === opt.id}
                  onChange={() => setPaymentMethod(opt.id as any)} className="accent-emerald-500" />
                <span className="text-lg">{opt.icon}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</span>
              </label>
            ))}
            {paymentMethod === 'phonepay' && settings.phonepay_qr_url && (
              <div className="flex flex-col items-center gap-2 p-4 bg-gray-50 dark:bg-slate-700 rounded-xl">
                <QrCode className="w-5 h-5 text-gray-400" />
                <p className="text-xs text-gray-500 dark:text-slate-400">Delivery partner will show QR for payment</p>
                <img src={settings.phonepay_qr_url} alt="PhonePe QR" className="w-32 h-32 object-contain rounded-xl border border-gray-200 dark:border-slate-600 bg-white" />
              </div>
            )}
          </div>

          {/* Place order */}
          <button type="submit" disabled={loading}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm flex items-center justify-center gap-2 text-base">
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Placing order...</> : `Place Order · ₹${total.toFixed(0)}`}
          </button>

        </form>
      </div>
    </div>
  );
}

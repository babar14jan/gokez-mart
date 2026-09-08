import { useState } from 'react';
import { Loader2, Plus, Minus, Trash2, MapPin, PenLine, X } from 'lucide-react';
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
  onHome: () => void;
  onSuccess: (orderNumber: string, preference: string) => void;
}

const inp = 'w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white dark:focus:bg-slate-600 transition-all';

const PREFERENCES = [
  { value: 'within_15', label: '⚡ 10-15 mins', sub: 'Fastest' },
  { value: 'within_30', label: '🕐 30 mins',   sub: 'Standard' },
  { value: 'within_60', label: '🕑 1 hour',    sub: 'Flexible' },
] as const;

const NOTES = ['Ring the bell', 'Call me when you arrive', "Don't ring the bell"];

export default function CheckoutPage({ settings, zoneName, storeId, onBack, onHome, onSuccess }: CheckoutPageProps) {
  const { items, updateQty, subtotal, clearCart } = useCartStore();
  const { phone: savedPhone, name: savedName, addresses, getDefaultAddress, setDefaultAddress, addAddress } = useCustomerStore();
  const { phone: authPhone, name: authName, address: authAddress, isLoggedIn } = useCustomerAuthStore();

  const defaultAddr = getDefaultAddress();
  const deliveryAddress = defaultAddr?.address || (isLoggedIn ? authAddress : null);

  const [guestName, setGuestName] = useState((isLoggedIn ? authName : savedName) || '');
  const [guestPhone, setGuestPhone] = useState((isLoggedIn ? authPhone : savedPhone) || '');

  // Address
  const [showAddressList, setShowAddressList] = useState(false);
  const [addingNew, setAddingNew] = useState(!deliveryAddress);
  const [newAddress, setNewAddress] = useState('');

  // Delivery preference
  const [deliveryPreference, setDeliveryPreference] = useState<'within_15' | 'within_30' | 'within_60'>('within_15');
  const [showPreferences, setShowPreferences] = useState(false);

  // Delivery note
  const [deliveryNote, setDeliveryNote] = useState('Ring the bell');
  const [showNotes, setShowNotes] = useState(false);
  const [showCustomNote, setShowCustomNote] = useState(false);
  const [customNote, setCustomNote] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'upi' | 'phonepay'>('cod');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const deliveryCharge = parseFloat(settings.delivery_charge || '15');
  const freeAbove = parseFloat(settings.free_delivery_above || '150');
  const minOrder = parseFloat(settings.min_order_amount || '50');
  const sub = subtotal();
  const actualDelivery = sub >= freeAbove ? 0 : deliveryCharge;
  const total = sub + actualDelivery;
  const canCheckout = sub >= minOrder && items.length > 0;

  const paymentOptions = [
    { id: 'cod',      label: 'Cash',          icon: '💵', enabled: settings.cod_enabled === 'true' },
    { id: 'upi',      label: 'UPI',           icon: '📱', enabled: settings.upi_enabled === 'true' },
    { id: 'phonepay', label: 'PhonePe',       icon: '📷', enabled: settings.phonepay_enabled === 'true' },
  ].filter(p => p.enabled);

  const resolvedAddress = deliveryAddress || newAddress.trim();
  const selectedPref = PREFERENCES.find(p => p.value === deliveryPreference)!;
  const currentNote = showCustomNote ? (customNote || '✏️ Custom note') : deliveryNote;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = isLoggedIn ? (authName || guestName) : guestName;
    const phone = isLoggedIn ? (authPhone || guestPhone) : guestPhone;
    if (!name || !phone) { setError('Name and phone are required'); return; }
    if (phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit phone number'); return; }
    if (!resolvedAddress) { setError('Please add a delivery address'); return; }
    setLoading(true); setError('');
    try {
      const res = await storeApi.placeOrder({
        guestName: name, guestPhone: phone.replace(/\D/g, ''),
        guestAddress: resolvedAddress,
        items: items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity })),
        paymentMethod, zoneName: zoneName || undefined, storeId: storeId || undefined,
        deliveryPreference,
        deliveryNote: showCustomNote ? (customNote.trim() || 'Ring the bell') : deliveryNote,
      });
      if (resolvedAddress) addAddress({ label: 'Home', address: resolvedAddress, isDefault: true });
      clearCart();
      onSuccess(res.data.data.orderNumber, deliveryPreference);
    } catch {
      setError('Failed to place order. Please try again.');
    } finally { setLoading(false); }
  };

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">My Cart</h1>
        <button onClick={onBack} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="max-w-lg mx-auto px-4 py-4 pb-36 space-y-3">

          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-2xl">{error}</div>}

          {/* ── Items ── */}
          <div className={card}>
            <div className="divide-y divide-gray-50 dark:divide-slate-700">
              {items.map(item => (
                <div key={`${item.productId}-${item.unit}`} className="flex items-center gap-3 px-4 py-3">
                  {item.photoUrl
                    ? <img src={item.photoUrl} alt={item.productName} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                    : <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0 text-xl">🥦</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.productName}</p>
                    <p className="text-xs text-gray-400">{item.unit} · ₹{item.price}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" onClick={() => updateQty(item.productId, item.unit, item.quantity - 1)}
                      className="w-7 h-7 bg-gray-100 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                      {item.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-gray-600 dark:text-slate-300" />}
                    </button>
                    <span className="text-sm font-bold text-gray-900 dark:text-white w-5 text-center">{item.quantity}</span>
                    <button type="button" onClick={() => updateQty(item.productId, item.unit, item.quantity + 1)}
                      className="w-7 h-7 bg-emerald-500 text-white rounded-lg flex items-center justify-center">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white w-12 text-right flex-shrink-0">
                    ₹{(item.price * item.quantity).toFixed(0)}
                  </p>
                </div>
              ))}
            </div>
            {/* Free delivery nudge */}
            {actualDelivery > 0 && (
              <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/10 border-t border-emerald-100 dark:border-emerald-900">
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium text-center">
                  🎉 Add ₹{(freeAbove - sub).toFixed(0)} more for free delivery
                </p>
              </div>
            )}
          </div>

          {/* ── Guest details (not logged in) ── */}
          {!isLoggedIn && (
            <div className={`${card} p-4 space-y-3`}>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Your Details</h2>
              <input type="text" value={guestName} onChange={e => setGuestName(e.target.value)}
                className={inp} placeholder="Full name *" required />
              <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                className={inp} placeholder="10-digit mobile number *" required />
            </div>
          )}

          {/* ── Address ── */}
          <div className={card}>
            <div className="flex items-start gap-2.5 px-4 py-3">
              <MapPin className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Deliver to</p>
                {deliveryAddress && !addingNew
                  ? <p className="text-sm text-gray-700 dark:text-slate-300 leading-snug">{deliveryAddress}</p>
                  : <p className="text-xs text-red-500 font-medium">No address — add one below</p>
                }
              </div>
              {!addingNew && (
                <button type="button" onClick={() => setShowAddressList(s => !s)}
                  className="text-xs font-semibold text-emerald-600 flex-shrink-0">
                  {showAddressList ? 'Done' : 'Change'}
                </button>
              )}
            </div>

            {showAddressList && (
              <div className="border-t border-gray-100 dark:border-slate-700 divide-y divide-gray-50 dark:divide-slate-700">
                {addresses.map(addr => (
                  <button type="button" key={addr.id}
                    onClick={() => { setDefaultAddress(addr.id); setShowAddressList(false); setAddingNew(false); }}
                    className="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700 text-left">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex-shrink-0 ${addr.isDefault ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'}`} />
                    <div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">{addr.label}</p>
                      <p className="text-[11px] text-gray-400 leading-snug">{addr.address}</p>
                    </div>
                  </button>
                ))}
                <button type="button" onClick={() => { setAddingNew(true); setShowAddressList(false); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                  <PenLine className="w-3.5 h-3.5" />
                  <span className="text-xs font-semibold">Add new address</span>
                </button>
              </div>
            )}

            {addingNew && (
              <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3 space-y-2">
                <textarea value={newAddress} onChange={e => setNewAddress(e.target.value)}
                  className={`${inp} resize-none`} rows={3}
                  placeholder="Flat/House no, Building, Street, Area..." autoFocus />
                {addresses.length > 0 && (
                  <button type="button" onClick={() => setAddingNew(false)}
                    className="text-xs text-emerald-600 font-semibold">← Use saved address</button>
                )}
              </div>
            )}
          </div>

          {/* ── USP: Delivery time + Note in one card ── */}
          <div className={card}>
            {/* Delivery time */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700 dark:text-slate-300">
                {selectedPref.label} <span className="text-gray-400 text-xs">· {selectedPref.sub}</span>
              </span>
              <button type="button" onClick={() => { setShowPreferences(s => !s); setShowNotes(false); }}
                className="text-xs font-semibold text-emerald-600">
                {showPreferences ? 'Done' : 'Change'}
              </button>
            </div>
            {showPreferences && (
              <div className="border-t border-gray-100 dark:border-slate-700 grid grid-cols-3 gap-2 p-3">
                {PREFERENCES.map(p => (
                  <label key={p.value} className={`flex flex-col items-center p-3 rounded-xl border-2 cursor-pointer text-center transition-all ${
                    deliveryPreference === p.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'
                  }`}>
                    <input type="radio" name="preference" value={p.value} checked={deliveryPreference === p.value}
                      onChange={() => { setDeliveryPreference(p.value); setShowPreferences(false); }} className="hidden" />
                    <p className="text-xs font-bold text-gray-900 dark:text-white">{p.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.sub}</p>
                  </label>
                ))}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-50 dark:border-slate-700" />

            {/* Delivery note */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700 dark:text-slate-300">🔔 {currentNote}</span>
              <button type="button" onClick={() => { setShowNotes(s => !s); setShowPreferences(false); }}
                className="text-xs font-semibold text-emerald-600">
                {showNotes ? 'Done' : 'Change'}
              </button>
            </div>
            {showNotes && (
              <div className="border-t border-gray-100 dark:border-slate-700 p-3 space-y-2">
                {NOTES.map(note => (
                  <label key={note} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    !showCustomNote && deliveryNote === note ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'
                  }`}>
                    <input type="radio" name="note" checked={!showCustomNote && deliveryNote === note}
                      onChange={() => { setDeliveryNote(note); setShowCustomNote(false); setShowNotes(false); }} className="accent-emerald-500" />
                    <span className="text-sm text-gray-700 dark:text-slate-300">{note}</span>
                  </label>
                ))}
                <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  showCustomNote ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'
                }`}>
                  <input type="radio" name="note" checked={showCustomNote}
                    onChange={() => setShowCustomNote(true)} className="accent-emerald-500" />
                  <span className="text-sm text-gray-700 dark:text-slate-300">✏️ Write your own...</span>
                </label>
                {showCustomNote && (
                  <textarea value={customNote} onChange={e => setCustomNote(e.target.value)}
                    className={`${inp} resize-none`} rows={2} placeholder="e.g. Come to 3rd floor" autoFocus />
                )}
              </div>
            )}
          </div>

          {/* ── Payment pills ── */}
          <div className={`${card} px-4 py-3`}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-slate-400 mr-1">Pay via</span>
              {paymentOptions.map(opt => (
                <label key={opt.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 cursor-pointer transition-all ${
                  paymentMethod === opt.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-slate-600'
                }`}>
                  <input type="radio" name="payment" value={opt.id} checked={paymentMethod === opt.id}
                    onChange={() => setPaymentMethod(opt.id as any)} className="hidden" />
                  <span className="text-sm">{opt.icon}</span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-white">{opt.label}</span>
                </label>
              ))}
              <span className="text-[10px] text-gray-400 ml-auto">on delivery</span>
            </div>
          </div>

          {!canCheckout && sub < minOrder && (
            <p className="text-xs text-red-500 text-center">Minimum order ₹{minOrder}. Add ₹{(minOrder - sub).toFixed(0)} more.</p>
          )}

          {/* ── Place Order ── */}
          <button type="submit" disabled={loading || !canCheckout}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-base">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Place Order'}</span>
              <div className="text-right">
                <p className="text-base font-bold">₹{total.toFixed(0)}</p>
                <p className="text-[10px] text-emerald-200">
                  {actualDelivery === 0 ? 'Free delivery' : `incl. ₹${actualDelivery} delivery`}
                </p>
              </div>
            </div>
          </button>

          <button type="button" onClick={onHome}
            className="w-full py-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors">
            ← Continue Shopping
          </button>

        </div>
      </form>
    </div>
  );
}

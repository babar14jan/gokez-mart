import { useState, useEffect, useRef } from 'react';
import { Loader2, Plus, Minus, Trash2, MapPin, PenLine, X, Tag, Check, MessageCircle, ChevronUp, Clock } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { storeApi, campaignApi } from '../services/api';
import type { PublicSettings, Product } from '../services/api';
import { useCustomerStore } from '../store/customerStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';

interface CheckoutPageProps {
  settings: PublicSettings;
  zoneName?: string;
  storeId?: string;
  zoneGpsConfirmed?: boolean;
  onBack: () => void;
  onHome: () => void;
  onSuccess: (orderNumber: string, preference: string, storeName?: string, savedAmount?: number) => void;
}

const inp = 'w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white dark:focus:bg-slate-600 transition-all';

const PREFERENCES = [
  { value: 'within_15', label: '⚡ 10-15 mins', sub: 'Fastest' },
  { value: 'within_30', label: '🕐 30 mins',   sub: 'Standard' },
  { value: 'within_60', label: '🕑 1 hour',    sub: 'Flexible' },
] as const;

const NOTES = ['Ring the bell', 'Call me when you arrive', "Don't ring the bell"];

export default function CheckoutPage({ settings, zoneName, storeId, zoneGpsConfirmed, onBack, onHome, onSuccess }: CheckoutPageProps) {
  const orderRequestKey = useRef(crypto.randomUUID());
  const { items, updateQty, subtotal, clearCart, addItem } = useCartStore();
  const { phone: savedPhone, name: savedName, addresses, loadAddresses, getDefaultAddress, setDefaultAddress, addAddress } = useCustomerStore();
  const { phone: authPhone, name: authName, address: authAddress, isLoggedIn } = useCustomerAuthStore();

  useEffect(() => { if (isLoggedIn) loadAddresses(); }, [isLoggedIn]);

  const [suggestions, setSuggestions] = useState<Product[]>([]);
  useEffect(() => {
    if (!storeId) return;
    storeApi.getProducts(undefined, storeId).then(r => {
      const cartIds = new Set(items.map(i => i.productId));
      const all = (r.data.data || []).filter(p => p.availabilityStatus === 'available' && !cartIds.has(p.id));
      setSuggestions(all.slice(0, 8));
    }).catch(() => {});
  }, [storeId]);

  const defaultAddr = getDefaultAddress();
  const deliveryAddress = defaultAddr?.address || (isLoggedIn ? authAddress : null);

  const [guestName] = useState((isLoggedIn ? authName : savedName) || '');
  const [guestPhone] = useState((isLoggedIn ? authPhone : savedPhone) || '');

  // Address
  const [showAddressList, setShowAddressList] = useState(false);
  const [addingNew, setAddingNew] = useState(!deliveryAddress);
  const [newAddress, setNewAddress] = useState('');

  // Smart address prompt — if the customer has no saved address at all, open the sheet proactively
  // instead of silently blocking them at the final "Place Order" step.
  const addressPromptShown = useRef(false);
  useEffect(() => {
    if (addressPromptShown.current) return;
    if (!isLoggedIn) return;
    if (addresses.length === 0 && !deliveryAddress) {
      addressPromptShown.current = true;
      setAddingNew(true);
      setShowAddressList(true);
    }
  }, [isLoggedIn, addresses, deliveryAddress]);

  // Delivery preference
  const [deliveryPreference, setDeliveryPreference] = useState<'within_15' | 'within_30' | 'within_60'>('within_15');
  const [showPreferences, setShowPreferences] = useState(false);

  // Delivery note
  const [deliveryNote, setDeliveryNote] = useState('Ring the bell');
  const [showNotes, setShowNotes] = useState(false);
  const [showCustomNote, setShowCustomNote] = useState(false);
  const [customNote, setCustomNote] = useState('');

  // Payment — fixed COD/UPI on delivery, no method picker (matches mobile app)
  const paymentMethod: 'cod' = 'cod';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Campaign / coupon
  const cartSubtotal = subtotal(); // early calc for useEffect
  const [eligibleCampaigns, setEligibleCampaigns] = useState<any[]>([]);
  const [appliedCampaign, setLocalAppliedCampaign] = useState<any | null>(null);
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [campaignDiscount, setCampaignDiscount] = useState(0);
  const [couponInput, setCouponInput] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [couponSuccess, setCouponSuccess] = useState('');
  const [showCouponField, setShowCouponField] = useState(false);
  const [billExpanded, setBillExpanded] = useState(false);

  useEffect(() => {
    // Offers are explicitly selected for each checkout; never restore an old cart selection.
    useCartStore.getState().setAppliedCampaign(null, 0);
  }, []);

  useEffect(() => {
    if (!storeId) return;
    campaignApi.getEligible(cartSubtotal, storeId)
      .then(r => {
        const campaigns = r.data.data || [];
        setEligibleCampaigns(campaigns);
        if (appliedCampaign && !appliedCouponCode && !campaigns.some((campaign: any) => campaign.id === appliedCampaign.id)) {
          removeCampaign();
        }
      }).catch(() => {});
  }, [storeId, cartSubtotal, appliedCampaign, appliedCouponCode]);

  const calcDiscount = (campaign: any, cartTotal: number): number => {
    if (campaign.discount_type === 'flat') return Math.min(parseFloat(campaign.discount_value), cartTotal);
    if (campaign.discount_type === 'percent') {
      const d = (cartTotal * parseFloat(campaign.discount_value)) / 100;
      return campaign.max_discount ? Math.min(d, parseFloat(campaign.max_discount)) : d;
    }
    return 0;
  };

  const applyCampaign = (campaign: any, couponCode: string | null = null) => {
    const disc = calcDiscount(campaign, sub);
    setLocalAppliedCampaign(campaign);
    setAppliedCouponCode(couponCode);
    setCampaignDiscount(disc);
    useCartStore.getState().setAppliedCampaign(campaign, disc);
    setCouponError('');
  };

  const removeCampaign = () => {
    setLocalAppliedCampaign(null);
    setAppliedCouponCode(null);
    setCampaignDiscount(0);
    useCartStore.getState().setAppliedCampaign(null, 0);
    setCouponError('');
    setCouponSuccess('');
  };

  const validateCoupon = async () => {
    if (!couponInput.trim() || !storeId) return;
    setCouponLoading(true); setCouponError('');
    try {
      const res = await campaignApi.validateCode(couponInput.trim(), sub, storeId);
      const { campaign } = res.data.data;
      applyCampaign(campaign, couponInput.trim().toUpperCase());
      setCouponSuccess('Coupon applied');
    } catch (e: any) {
      setCouponSuccess('');
      setCouponError(e?.response?.data?.error || 'Invalid coupon');
    } finally { setCouponLoading(false); }
  };

  const deliveryCharge = parseFloat(settings.delivery_charge || '15');
  const freeAbove = parseFloat(settings.free_delivery_above || '150');
  const minOrder = parseFloat(settings.min_order_amount || '50');
  const sub = subtotal();
  const actualDelivery = appliedCampaign?.discount_type === 'free_delivery' ? 0 : (sub >= freeAbove ? 0 : deliveryCharge);
  const total = Math.max(0, sub + actualDelivery - campaignDiscount);
  const canCheckout = sub >= minOrder && items.length > 0;

  const resolvedAddress = deliveryAddress || newAddress.trim();
  const selectedLabel = addresses.find(a => a.address === deliveryAddress)?.label ?? 'Address';
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
        campaignId: appliedCouponCode ? undefined : appliedCampaign?.id || undefined,
        couponCode: appliedCouponCode || undefined,
      }, orderRequestKey.current);
      if (resolvedAddress) addAddress({ label: 'Home', address: resolvedAddress, isDefault: true });
      clearCart();
      onSuccess(res.data.data.orderNumber, deliveryPreference, res.data.data.storeName, campaignDiscount > 0 ? campaignDiscount : undefined);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to place order. Please try again.');
    } finally { setLoading(false); }
  };

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">My Cart</h1>
        <button onClick={onBack} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <form id="checkout-form" onSubmit={handleSubmit}>
        <div className="max-w-lg mx-auto px-4 py-4 pb-8 space-y-3">

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
                    <p className="text-xs text-gray-500">{item.unit} · ₹{item.price}</p>
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
            {/* Missed something */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50 dark:border-slate-700">
              <span className="text-sm text-gray-500 dark:text-slate-400">Missed something?</span>
              <button type="button" onClick={onHome}
                className="flex items-center gap-1.5 bg-gray-900 dark:bg-slate-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Add more items
              </button>
            </div>
          </div>

          {/* ── You may also like ── */}
          {suggestions.length > 0 && (
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-2 px-1">You may also like</p>
              <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
                {suggestions.map(p => (
                  <div key={p.id} className="w-28 flex-shrink-0 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
                    {p.photoUrl
                      ? <img src={p.photoUrl} alt={p.name} className="w-28 h-20 object-cover" />
                      : <div className="w-28 h-20 bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-xl">🥦</div>
                    }
                    <div className="p-2">
                      <p className="text-[11px] font-medium text-gray-900 dark:text-white leading-tight line-clamp-2">{p.name}</p>
                      <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{p.unit}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs font-bold text-emerald-600">₹{p.price}</span>
                        <button type="button" onClick={() => addItem(p)}
                          className="text-[10px] font-bold text-white bg-emerald-500 px-2 py-1 rounded-lg">
                          ADD
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Soft warning if zone not GPS confirmed */}
          {!zoneGpsConfirmed && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Delivery area not verified. Please confirm your address is within our delivery zone.
              </p>
            </div>
          )}

          {/* Address bottom sheet */}
          {showAddressList && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm"
              onClick={() => { setShowAddressList(false); setAddingNew(!deliveryAddress); }}>
              <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Choose delivery address</p>
                  <button onClick={() => { setShowAddressList(false); setAddingNew(!deliveryAddress); }} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {!addingNew ? (
                  <>
                    <div className="divide-y divide-gray-50 dark:divide-slate-700">
                      {addresses.map(addr => {
                        const isSelected = addr.address === deliveryAddress;
                        return (
                          <button type="button" key={addr.id}
                            onClick={() => { setDefaultAddress(addr.id); setShowAddressList(false); setAddingNew(false); }}
                            className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-700 text-left">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${isSelected ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-slate-700'}`}>
                              <MapPin className={`w-3.5 h-3.5 ${isSelected ? 'text-emerald-500' : 'text-gray-500'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-700 dark:text-slate-300">{addr.label}</p>
                              <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{addr.address}</p>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-1" />}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => setAddingNew(true)}
                      className="w-full flex items-center gap-2.5 px-5 py-3.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border-t border-gray-100 dark:border-slate-700">
                      <PenLine className="w-4 h-4" />
                      <span className="text-sm font-semibold">Add new address</span>
                    </button>
                  </>
                ) : (
                  <div className="px-5 py-4 space-y-3">
                    <textarea value={newAddress} onChange={e => setNewAddress(e.target.value)}
                      className={`${inp} resize-none`} rows={3}
                      placeholder="Flat/House no, Building, Street, Area..." autoFocus />
                    <div className="flex gap-2">
                      {addresses.length > 0 && (
                        <button type="button" onClick={() => setAddingNew(false)}
                          className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl transition-colors">
                          ← Use saved address
                        </button>
                      )}
                      <button type="button" onClick={() => setShowAddressList(false)} disabled={!newAddress.trim()}
                        className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50 transition-colors">
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Offers / Coupons ── */}
          <div className={card}>
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-violet-500" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">Offers & Coupons</span>
                </div>
                <button type="button" onClick={() => setShowCouponField(value => !value)} className="text-xs font-semibold text-violet-600 dark:text-violet-400 whitespace-nowrap">
                  {showCouponField ? 'Hide coupon' : 'Have a coupon?'}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <p className="text-[11px] leading-tight text-gray-500 dark:text-slate-400">Choose one offer. Coupon codes cannot be combined with another offer.</p>
                <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${!appliedCampaign ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'}`}>
                  <input type="radio" name="checkout-offer" checked={!appliedCampaign} onChange={removeCampaign} className="mt-0.5 accent-emerald-500" />
                  <span className="text-xs text-gray-700 dark:text-slate-300">No offer</span>
                </label>
                {eligibleCampaigns.map((campaign: any) => {
                  const isSelected = appliedCampaign?.id === campaign.id && !appliedCouponCode;
                  const amount = campaign.discount_type === 'flat' ? `₹${campaign.discount_value} off` : campaign.discount_type === 'percent' ? `${campaign.discount_value}% off` : 'Free delivery';
                  const description = campaign.description || campaign.subtitle || `${amount}${campaign.min_order_amount > 0 ? ` on orders above ₹${campaign.min_order_amount}` : ''}`;
                  return (
                    <label key={campaign.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'}`}>
                      <input type="radio" name="checkout-offer" checked={isSelected} onChange={() => applyCampaign(campaign)} className="mt-0.5 accent-emerald-500" />
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-gray-900 dark:text-white break-words">{campaign.badge_text ? `${campaign.badge_text} ` : ''}{campaign.title}</span>
                        <span className="block mt-0.5 text-[11px] leading-tight text-gray-500 dark:text-slate-400 break-words">{description}</span>
                      </span>
                    </label>
                  );
                })}
                {eligibleCampaigns.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400">No eligible offers for this order.</p>}
              </div>

              {showCouponField && <div className="mt-3 border-t border-gray-100 dark:border-slate-700 pt-3">
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Coupon code</label>
                <div className="flex gap-2">
                  <input type="text" value={couponInput} onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(''); setCouponSuccess(''); }} placeholder="Enter coupon code" className="flex-1 min-w-0 px-3 py-2 text-xs border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                  <button type="button" onClick={validateCoupon} disabled={couponLoading || !couponInput.trim()} className="px-3 py-2 text-xs font-bold text-white bg-violet-500 hover:bg-violet-600 rounded-xl disabled:opacity-50 flex items-center gap-1 whitespace-nowrap">
                    {couponLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Apply
                  </button>
                </div>
                {couponSuccess && <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">{couponSuccess}</p>}
                {couponError && <p className="mt-1.5 text-xs text-red-500">{couponError}</p>}
              </div>}

              {appliedCampaign && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 break-words">{appliedCampaign.title}</p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-500">{campaignDiscount > 0 ? `-₹${campaignDiscount.toFixed(0)} saved` : 'Free delivery applied'}</p>
                </div>
                <button type="button" onClick={removeCampaign} className="p-1 text-emerald-600 hover:text-red-500 flex-shrink-0" aria-label="Remove offer"><X className="w-3.5 h-3.5" /></button>
              </div>}
            </div>
          </div>

          {/* ── USP: Delivery time + Note in one card ── */}
          <div className={card}>
            {/* Delivery time */}
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Delivery Time</p>
                <p className="text-sm text-gray-900 dark:text-white font-medium">
                  {selectedPref.label} <span className="text-gray-500 text-xs font-normal">· {selectedPref.sub}</span>
                </p>
              </div>
              <button type="button" onClick={() => { setShowPreferences(s => !s); setShowNotes(false); }}
                className="text-xs font-semibold text-emerald-600 flex-shrink-0">
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
                    <p className="text-[10px] text-gray-500 mt-0.5">{p.sub}</p>
                  </label>
                ))}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-50 dark:border-slate-700" />

            {/* Delivery note */}
            <button type="button" onClick={() => setShowNotes(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-4 h-4 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Delivery Instructions</p>
                <p className="text-sm text-gray-900 dark:text-white font-medium truncate">{currentNote}</p>
              </div>
              <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">Change</span>
            </button>
          </div>

          {/* Delivery note bottom sheet */}
          {showNotes && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm"
              onClick={() => setShowNotes(false)}>
              <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-700">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Delivery instructions</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">How should we handle your delivery?</p>
                  </div>
                  <button onClick={() => setShowNotes(false)} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
                <div className="px-5 py-4 space-y-2">
                  {NOTES.map(note => (
                    <label key={note} className={`flex items-center gap-3 p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                      !showCustomNote && deliveryNote === note ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'
                    }`}>
                      <input type="radio" name="note" checked={!showCustomNote && deliveryNote === note}
                        onChange={() => { setDeliveryNote(note); setShowCustomNote(false); setShowNotes(false); }} className="accent-emerald-500" />
                      <span className="text-sm text-gray-700 dark:text-slate-300">{note}</span>
                    </label>
                  ))}
                  <label className={`flex items-center gap-3 p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                    showCustomNote ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'
                  }`}>
                    <input type="radio" name="note" checked={showCustomNote}
                      onChange={() => setShowCustomNote(true)} className="accent-emerald-500" />
                    <span className="text-sm text-gray-700 dark:text-slate-300">✏️ Write your own...</span>
                  </label>
                  {showCustomNote && (
                    <>
                      <textarea value={customNote} onChange={e => setCustomNote(e.target.value)}
                        className={`${inp} resize-none`} rows={2} placeholder="e.g. Come to 3rd floor" autoFocus />
                      <button type="button" onClick={() => setShowNotes(false)}
                        className="w-full py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors">
                        Done
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Bill Summary ── */}
          <div className={card}>
            <button type="button" onClick={() => setBillExpanded(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Bill Summary</span>
              <span className="text-xs font-semibold text-emerald-600">{billExpanded ? 'Hide' : 'View'} details</span>
            </button>
            {billExpanded && (
              <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-2">
                {items.map(item => (
                  <div key={`${item.productId}-${item.unit}`} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-gray-600 dark:text-slate-400 truncate">{item.productName} <span className="text-gray-500">({item.unit} × {item.quantity})</span></span>
                    <span className="font-semibold text-gray-900 dark:text-white flex-shrink-0 ml-2">₹{(item.price * item.quantity).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className={`px-4 py-3 space-y-1.5 ${billExpanded ? 'border-t border-gray-100 dark:border-slate-700' : ''}`}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">Item total</span>
                <span className="text-gray-900 dark:text-white">₹{sub.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">Delivery charge</span>
                <span className={actualDelivery === 0 ? 'text-emerald-600 font-semibold' : 'text-gray-900 dark:text-white'}>
                  {actualDelivery === 0 ? 'FREE' : `₹${actualDelivery}`}
                </span>
              </div>
              {campaignDiscount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-600">🎉 {appliedCampaign?.title || 'Discount'}</span>
                  <span className="text-emerald-600 font-semibold">-₹{campaignDiscount.toFixed(0)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-gray-100 dark:border-slate-700">
                <span className="text-sm font-bold text-gray-900 dark:text-white">Total</span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">₹{total.toFixed(0)}</span>
              </div>
            </div>
          </div>

        </div>
      </form>

      {/* ── Sticky address + Place Order footer ── */}
      <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
        <div className="max-w-lg mx-auto">
          {/* Address row — tappable, opens sheet */}
          <button type="button" onClick={() => setShowAddressList(true)}
            className="w-full flex items-center gap-2.5 px-4 pt-3 pb-2 text-left">
            <ChevronUp className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span className="text-sm font-bold text-gray-900 dark:text-white">Delivering to {selectedLabel}</span>
              </div>
              {deliveryAddress
                ? <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">{deliveryAddress}</p>
                : <p className="text-xs text-red-500 font-semibold mt-0.5">Add delivery address</p>
              }
            </div>
            <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">Change</span>
          </button>

          <div className="px-4 pb-4">
            {!canCheckout && sub < minOrder && (
              <p className="text-xs text-red-500 text-center mb-2">Minimum order ₹{minOrder}. Add ₹{(minOrder - sub).toFixed(0)} more.</p>
            )}
            <div className="flex items-center gap-3">
              <div className="w-16 flex-shrink-0 text-center">
                <p className="text-[10px] text-gray-500 dark:text-slate-400">To pay</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">₹{total.toFixed(0)}</p>
              </div>
              <button type="submit" form="checkout-form" disabled={loading || !canCheckout}
                className="flex-1 h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm flex flex-col items-center justify-center leading-tight">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <>
                    <span className="text-base">Pay Cash / UPI</span>
                    <span className="text-[11px] font-normal text-emerald-100">On Delivery</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

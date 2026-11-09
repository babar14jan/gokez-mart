import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Database, Loader2, MapPin, Package,
  Phone, RotateCcw, Search, Store as StoreIcon, Tag, User,
} from 'lucide-react';
import { ordersApi, storesApi } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import PageSkeleton from '../components/PageSkeleton';
import { useToast, ToastContainer } from '../hooks/useToast';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const STATUS_OPTIONS = [
  ['pending', 'Pending'],
  ['confirmed', 'Confirmed'],
  ['preparing', 'Preparing'],
  ['ready_to_pickup', 'Ready to pickup'],
  ['out_for_delivery', 'Out for delivery'],
  ['picked_up', 'Picked up'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
  ['failed_delivery', 'Failed delivery'],
  ['terminated', 'Terminated'],
] as const;

const PAYMENT_OPTIONS = [
  ['cod', 'Cash on delivery'],
  ['upi', 'UPI'],
  ['phonepay', 'PhonePe'],
] as const;

const money = (value: number) => `₹${Number(value || 0).toFixed(0)}`;

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

interface RestoreItem {
  productId: string | null;
  productName: string;
  unit: string;
  price: number;
  mrp: number;
  quantity: number;
  total: number;
  storeId: string | null;
  storeName: string | null;
  missingProduct: boolean;
  bundleComponents: Array<{ productId: string; productName: string; unit: string; quantity: number }>;
}

interface RestoreCandidate {
  cartId: string;
  sessionId: string;
  linkedBy: 'customer' | 'session' | 'campaign';
  convertedAt: string;
  itemCount: number;
  cartSubtotal: number;
  guestName: string;
  guestAddress: string;
  items: RestoreItem[];
  campaignUse: {
    id: string;
    campaignId: string;
    title: string | null;
    couponCode: string | null;
    couponCodeUsed: string | null;
    discountApplied: number;
    discountType: string | null;
    usedAt: string;
  } | null;
  funnel: { orderNumber: string | null; total: number | null; placedAt: string; sessionId: string } | null;
  inventory: { originalOrderId: string; deductedAt: string; lines: number } | null;
  suggestion: {
    orderNumber: string;
    status: string;
    storeId: string | null;
    storeName: string | null;
    paymentMethod: 'cod' | 'upi' | 'phonepay';
    subtotal: number;
    deliveryCharge: number;
    campaignDiscount: number;
    total: number;
    itemSavings: number;
    freeDeliverySaving: number;
    storeDeliveryCharge: number;
    createdAt: string;
    deliveredAt: string | null;
    recoveredTotal: number | null;
  };
  warnings: string[];
  alreadyRestoredOrderId: string | null;
}

interface LookupResult {
  customer: { id: string; phone: string; name: string | null; address: string | null } | null;
  candidates: RestoreCandidate[];
  recentOrders: Array<{ id: string; orderNumber: string; status: string; total: number; createdAt: string }>;
}

interface RestoreForm {
  status: string;
  storeId: string;
  deliveryCharge: string;
  paymentMethod: 'cod' | 'upi' | 'phonepay';
  guestName: string;
  guestAddress: string;
}

const emptyForm: RestoreForm = {
  status: 'pending',
  storeId: '',
  deliveryCharge: '',
  paymentMethod: 'cod',
  guestName: '',
  guestAddress: '',
};

const LINK_LABEL: Record<string, string> = {
  customer: 'Linked to customer',
  session: 'Linked via verified session',
  campaign: 'Matched from coupon use',
};

export default function RestoreOrderPage() {
  const navigate = useNavigate();
  const { toasts, show: showToast } = useToast();

  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [error, setError] = useState('');

  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<RestoreForm>(emptyForm);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restored, setRestored] = useState<null | {
    orderId: string;
    orderNumber: string;
    total: number;
    storeName: string;
    warnings: string[];
    originalOrderIdReused: boolean;
  }>(null);

  useEffect(() => {
    storesApi.getAll()
      .then(res => setStores(res.data.data || []))
      .catch(() => {});
  }, []);

  const selected = useMemo(
    () => lookup?.candidates.find(candidate => candidate.cartId === selectedId) || null,
    [lookup, selectedId]
  );

  useEffect(() => {
    if (!selected) return;
    setForm({
      status: selected.suggestion.status,
      storeId: selected.suggestion.storeId || '',
      deliveryCharge: '',
      paymentMethod: selected.suggestion.paymentMethod,
      guestName: selected.guestName || '',
      guestAddress: selected.guestAddress || '',
    });
  }, [selected]);

  const preview = useMemo(() => {
    if (!selected) return null;
    const subtotal = selected.suggestion.subtotal;
    const discount = selected.suggestion.campaignDiscount;
    const delivery = form.deliveryCharge === ''
      ? selected.suggestion.deliveryCharge
      : Math.max(0, Number(form.deliveryCharge) || 0);
    const total = form.deliveryCharge === ''
      ? selected.suggestion.total
      : Math.ceil(Math.max(0, subtotal + delivery - discount));
    return { subtotal, discount, delivery, total };
  }, [selected, form.deliveryCharge]);

  const runLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setRestored(null);
    setLookup(null);
    setSelectedId(null);
    setSearched(false);
    if (!phone.trim()) {
      setError('Enter the customer mobile number.');
      return;
    }
    setLoading(true);
    try {
      const res = await ordersApi.lookupRestore(phone.trim());
      const data: LookupResult = res.data.data;
      setLookup(data);
      setSearched(true);
      if (data.candidates.length > 0) setSelectedId(data.candidates[0].cartId);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not look up this number.');
    } finally {
      setLoading(false);
    }
  };

  const openConfirm = () => {
    if (!selected || !preview) return;
    if (!form.storeId) {
      showToast('Choose the head store first', 'error');
      return;
    }
    if (!form.guestName.trim() || !form.guestAddress.trim()) {
      showToast('Name and delivery address are required', 'error');
      return;
    }
    setConfirmOpen(true);
  };

  const restoreOrder = async () => {
    if (!selected || !lookup?.customer || !preview) return;
    try {
      const res = await ordersApi.restore({
        phone: lookup.customer.phone,
        cartId: selected.cartId,
        status: form.status,
        orderNumber: selected.suggestion.orderNumber,
        storeId: form.storeId,
        deliveryCharge: form.deliveryCharge === '' ? undefined : Number(form.deliveryCharge),
        paymentMethod: form.paymentMethod,
        guestName: form.guestName.trim(),
        guestAddress: form.guestAddress.trim(),
      });
      setRestored(res.data.data);
      setConfirmOpen(false);
      showToast(`Order ${res.data.data.orderNumber} restored`);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Could not restore this order', 'error');
    }
  };

  if (restored) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4">
        <ToastContainer toasts={toasts} />
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 p-6">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Order restored</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                {restored.orderNumber} · {money(restored.total)} · {restored.storeName}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">
                {restored.originalOrderIdReused
                  ? 'The original order id was recovered, so the existing stock deductions stay linked.'
                  : 'A new order id was created. No stock was deducted again.'}
              </p>
            </div>
          </div>

          {restored.warnings.length > 0 && (
            <div className="mt-5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 p-3">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">Review before sharing the order</p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                {restored.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button onClick={() => navigate('/orders')}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold">
              View orders
            </button>
            <button onClick={() => {
              setRestored(null);
              setLookup(null);
              setSearched(false);
              setPhone('');
            }}
              className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-slate-600">
              Restore another order
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <ToastContainer toasts={toasts} />

      <div className="flex items-start gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
          <RotateCcw className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Restore Order</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Recover a deleted order from its cart, coupon, funnel and stock records. Super admin only.
          </p>
        </div>
      </div>

      <form onSubmit={runLookup} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 sm:p-5 mb-5">
        <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
          Customer mobile number
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="tel"
            value={phone}
            onChange={event => setPhone(event.target.value)}
            placeholder="10-digit mobile number"
            className={inp}
            autoFocus
          />
          <button type="submit" disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 whitespace-nowrap">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Looking up…' : 'Find carts'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-2">
          Uses the digits only. Guest carts that were never linked to a verified session or a coupon cannot be matched automatically.
        </p>
      </form>

      {loading && <PageSkeleton />}

      {!loading && searched && lookup && !lookup.customer && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 text-center">
          <User className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">No customer found</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Check the number and try again.</p>
        </div>
      )}

      {!loading && searched && lookup?.customer && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{lookup.customer.name || 'Customer'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
                  <Phone className="w-4 h-4" /> {lookup.customer.phone}
                </div>
                <div className="text-xs text-gray-400 dark:text-slate-500">
                  {lookup.recentOrders.length} surviving order{lookup.recentOrders.length === 1 ? '' : 's'}
                </div>
              </div>
              {lookup.recentOrders.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 dark:text-slate-500">
                        <th className="py-1 pr-3 font-medium">Order</th>
                        <th className="py-1 pr-3 font-medium">Status</th>
                        <th className="py-1 pr-3 font-medium">Total</th>
                        <th className="py-1 font-medium">Placed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lookup.recentOrders.map(order => (
                        <tr key={order.id} className="border-t border-gray-100 dark:border-slate-700/60">
                          <td className="py-1.5 pr-3 font-semibold text-gray-700 dark:text-slate-200">{order.orderNumber}</td>
                          <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{order.status}</td>
                          <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{money(order.total)}</td>
                          <td className="py-1.5 text-gray-500 dark:text-slate-400">{formatDate(order.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {lookup.candidates.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 text-center">
                <Database className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">No recoverable carts found</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  The customer exists, but no converted cart is linked to them or to a coupon redemption. The deleted order may predate server-side cart tracking, or the cart was purely anonymous.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                  Converted carts ({lookup.candidates.length})
                </p>
                {lookup.candidates.map(candidate => {
                  const active = candidate.cartId === selectedId;
                  const disabled = Boolean(candidate.alreadyRestoredOrderId);
                  return (
                    <button
                      key={candidate.cartId}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedId(candidate.cartId)}
                      className={`w-full text-left rounded-2xl border p-4 transition-all ${
                        active
                          ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10 dark:border-emerald-600'
                          : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-300'
                      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-gray-900 dark:text-white">{money(candidate.suggestion.subtotal)}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{candidate.itemCount} item{candidate.itemCount === 1 ? '' : 's'}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400">
                            {LINK_LABEL[candidate.linkedBy]}
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-400 dark:text-slate-500">{formatDate(candidate.convertedAt)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {candidate.funnel?.orderNumber && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            {candidate.funnel.orderNumber}
                          </span>
                        )}
                        {candidate.campaignUse && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                            {candidate.campaignUse.couponCodeUsed || candidate.campaignUse.couponCode || 'Coupon'} · {money(candidate.campaignUse.discountApplied)}
                          </span>
                        )}
                        {candidate.inventory && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Stock link found
                          </span>
                        )}
                        {candidate.alreadyRestoredOrderId && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                            Already restored
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-2 truncate">
                        {(candidate.items || []).map(item => item.productName).join(', ')}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-4">
            {!selected ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 text-center">
                <Package className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Choose a cart</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Preview its surviving records before restoring.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Restore preview</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="col-span-2 text-xs font-medium text-gray-600 dark:text-slate-300">
                      Customer name
                      <input value={form.guestName} onChange={event => setForm({ ...form, guestName: event.target.value })} className={`${inp} mt-1`} />
                    </label>
                    <label className="col-span-2 text-xs font-medium text-gray-600 dark:text-slate-300">
                      Delivery address
                      <textarea value={form.guestAddress} onChange={event => setForm({ ...form, guestAddress: event.target.value })} rows={2} className={`${inp} mt-1 resize-none`} />
                    </label>
                    <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                      Status
                      <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })} className={`${inp} mt-1`}>
                        {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                      Head store
                      <select value={form.storeId} onChange={event => setForm({ ...form, storeId: event.target.value })} className={`${inp} mt-1`}>
                        <option value="">Choose store</option>
                        {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                      Payment method
                      <select value={form.paymentMethod} onChange={event => setForm({ ...form, paymentMethod: event.target.value as RestoreForm['paymentMethod'] })} className={`${inp} mt-1`}>
                        {PAYMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-600 dark:text-slate-300">
                      Delivery charge
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={form.deliveryCharge}
                        onChange={event => setForm({ ...form, deliveryCharge: event.target.value })}
                        placeholder={`${selected.suggestion.deliveryCharge}`}
                        className={`${inp} mt-1`}
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 dark:bg-slate-900/40 p-3 text-xs space-y-1.5">
                  <div className="flex justify-between text-gray-500 dark:text-slate-400"><span>Subtotal</span><span>{money(preview?.subtotal || 0)}</span></div>
                  {selected.suggestion.itemSavings > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><span>Item savings</span><span>−{money(selected.suggestion.itemSavings)}</span></div>
                  )}
                  {selected.suggestion.campaignDiscount > 0 && (
                    <div className="flex justify-between text-violet-600 dark:text-violet-400"><span>Coupon {selected.campaignUse?.couponCodeUsed || selected.campaignUse?.couponCode || ''}</span><span>−{money(selected.suggestion.campaignDiscount)}</span></div>
                  )}
                  <div className="flex justify-between text-gray-500 dark:text-slate-400"><span>Delivery</span><span>{preview?.delivery === 0 ? 'FREE' : money(preview?.delivery || 0)}</span></div>
                  <div className="flex justify-between font-bold text-gray-900 dark:text-white pt-1.5 border-t border-gray-200 dark:border-slate-700"><span>Total</span><span>{money(preview?.total || 0)}</span></div>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 pt-1">
                    Suggested {selected.suggestion.status} · {formatDate(selected.suggestion.createdAt)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Items</p>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {selected.items.map((item, index) => (
                      <div key={`${item.productId}-${index}`} className="flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-700 dark:text-slate-200 truncate">
                            {item.productName} <span className="text-gray-400 font-normal">({item.unit})</span>
                          </p>
                          <p className="text-[11px] text-gray-400 dark:text-slate-500">
                            {item.quantity} × {money(item.price)}
                            {item.missingProduct ? ' · product missing from catalogue' : ''}
                          </p>
                        </div>
                        <span className="font-semibold text-gray-700 dark:text-slate-200 whitespace-nowrap">{money(item.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] space-y-1.5">
                  {selected.funnel && (
                    <p className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                      <Database className="w-3.5 h-3.5" /> Funnel: {selected.funnel.orderNumber || 'no number'} · {formatDate(selected.funnel.placedAt)}
                    </p>
                  )}
                  {selected.campaignUse && (
                    <p className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400">
                      <Tag className="w-3.5 h-3.5" /> Coupon: {selected.campaignUse.title || selected.campaignUse.campaignId} · {formatDate(selected.campaignUse.usedAt)}
                    </p>
                  )}
                  {selected.inventory && (
                    <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <RotateCcw className="w-3.5 h-3.5" /> Stock: {selected.inventory.originalOrderId.slice(0, 8)}… · {selected.inventory.lines} lines
                    </p>
                  )}
                  {selected.suggestion.storeName && (
                    <p className="flex items-center gap-1.5 text-gray-500 dark:text-slate-400">
                      <StoreIcon className="w-3.5 h-3.5" /> Fulfilled by {selected.suggestion.storeName}
                    </p>
                  )}
                  {selected.guestAddress && (
                    <p className="flex items-start gap-1.5 text-gray-500 dark:text-slate-400">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <span>{selected.guestAddress}</span>
                    </p>
                  )}
                </div>

                {selected.warnings.length > 0 && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 p-2.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Recovery notes
                    </p>
                    <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-1">
                      {selected.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  onClick={openConfirm}
                  disabled={Boolean(selected.alreadyRestoredOrderId)}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4" /> Restore order
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmOpen && selected && preview && (
        <ConfirmDialog
          title="Restore this order?"
          message={`Create ${selected.suggestion.orderNumber} for ${form.guestName || 'this customer'} at ${money(preview.total)}? Customer totals and campaign usage counts will not be changed.`}
          confirmLabel="Restore"
          danger={false}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={restoreOrder}
        />
      )}
    </div>
  );
}

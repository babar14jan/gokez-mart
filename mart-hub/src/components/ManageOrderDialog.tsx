import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, IndianRupee,
  Minus, Package, Plus, Search, X,
} from 'lucide-react';
import { ordersApi, productsApi } from '../services/api';
import { orderDisplayName } from '../utils/orderName';
import { getActiveStoreId } from '../utils/store';
import SmartImage from './SmartImage';

interface Props {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

type Step = 'search' | 'edit' | 'preview' | 'done';

const REASONS = [
  'Customer returned',
  'Damaged item',
  'Out of stock',
  'Item unavailable',
  'Customer refused item',
  'Customer requested addition',
  'Quantity mismatch',
  'Other',
];

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI' };

const EDITABLE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready_to_pickup', 'picked_up', 'out_for_delivery', 'delivered'];

const MAX_ADDED_QUANTITY = 99;

const formatWhen = (value?: string | null) => value
  ? new Date(value).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  })
  : '';

const statusLabel = (status: string) => status.replace(/_/g, ' ');

interface AddedLine {
  productId: string;
  productName: string;
  unit: string;
  price: number;
  quantity: number;
}

export default function ManageOrderDialog({ onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>('search');

  // Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Selected order + correction
  const [order, setOrder] = useState<any | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'upi'>('cod');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  // Items added to the order on top of what was originally placed.
  const [addedLines, setAddedLines] = useState<AddedLine[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [productError, setProductError] = useState('');

  useEffect(() => {
    const term = productQuery.trim().toLowerCase();
    if (term.length < 2) {
      setProductResults([]);
      setProductSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setProductSearching(true);
      setProductError('');
      try {
        const response = await productsApi.getAll(getActiveStoreId(), { fresh: true });
        const all: any[] = response.data.data || [];
        const filtered = all
          .filter((product: any) => [product.name, product.localName, ...(product.searchAliases || [])]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(term))
          .slice(0, 8);
        setProductResults(filtered);
      } catch {
        setProductError('Could not load products');
      } finally {
        setProductSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [productQuery]);

  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  const deliveryCharge = Number(order?.deliveryCharge) || 0;
  const campaignDiscount = Number(order?.campaignDiscount) || 0;
  const originalTotal = Number(order?.total) || 0;
  const deliveredSubtotal = items.reduce((sum, item) => sum + Number(item.price) * (quantities[item.id] ?? Number(item.quantity)), 0);
  const addedSubtotal = addedLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const newSubtotal = Math.max(0, deliveredSubtotal + addedSubtotal);
  const newTotal = Math.max(0, newSubtotal + deliveryCharge - campaignDiscount);
  const deliveredOnlyTotal = Math.max(0, deliveredSubtotal + deliveryCharge - campaignDiscount);
  const removedTotal = Math.max(0, deliveredOnlyTotal - newTotal);
  const addedTotalValue = addedLines.reduce((sum, line) => sum + line.price * line.quantity, 0);

  const { changedItems, allRemoved } = useMemo(() => {
    const changed = items.filter(item => quantities[item.id] !== Number(item.quantity));
    return {
      changedItems: changed,
      allRemoved: items.length > 0 && items.every(item => (quantities[item.id] ?? Number(item.quantity)) === 0),
    };
  }, [items, quantities]);

  const finalReason = `${reason}${comment.trim() ? ` — ${comment.trim()}` : ''}`;
  const canPreview = (changedItems.length > 0 || addedLines.length > 0) && !allRemoved && (changedItems.length === 0 || (reason !== 'Other' || comment.trim().length > 0));

  const runSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    setSearchError('');
    try {
      const response = await ordersApi.getAll({ q: term, limit: 25 }, { fresh: true });
      setResults(response.data.data || []);
      setSearched(true);
    } catch (error: any) {
      setSearchError(error?.response?.data?.error || 'Could not search orders');
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const selectOrder = (entry: any) => {
    setOrder(entry);
    setQuantities(Object.fromEntries((entry.items || []).map((item: any) => [item.id, Number(item.quantity)])));
    setAddedLines([]);
    setProductQuery('');
    setProductResults([]);
    setReason(REASONS[0]);
    setComment('');
    setPaymentMethod(entry.paymentMethod || 'cod');
    setStep('edit');
  };

  const setQuantity = (item: any, next: number) => {
    const clamped = Math.max(0, Math.min(Number(item.quantity), Math.floor(Number(next) || 0)));
    setQuantities(prev => ({ ...prev, [item.id]: clamped }));
  };

  const addProduct = (product: any) => {
    const catalogPrice = Number(product.price);
    const discountPercent = Number(product.discountPercent) || 0;
    const effectivePrice = discountPercent > 0
      ? Math.round(catalogPrice * (1 - discountPercent / 100))
      : catalogPrice;
    setAddedLines(prev => {
      const existing = prev.find(line => line.productId === product.id);
      if (existing) {
        return prev.map(line => line.productId === product.id
          ? { ...line, quantity: Math.min(MAX_ADDED_QUANTITY, line.quantity + 1) }
          : line);
      }
      return [...prev, {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        price: effectivePrice,
        quantity: 1,
      }];
    });
  };

  const setAddedQuantity = (productId: string, quantity: number) => {
    setAddedLines(prev => quantity <= 0
      ? prev.filter(line => line.productId !== productId)
      : prev.map(line => line.productId === productId ? { ...line, quantity } : line));
  };

  const handleSubmit = async () => {
    if (!order || !canPreview) return;
    setSaving(true);
    try {
      const response = await ordersApi.manageOrder(
        order.id,
        changedItems.map(item => ({ orderItemId: item.id, deliveredQuantity: quantities[item.id] })),
        finalReason,
        paymentMethod,
        addedLines.map(line => ({ productId: line.productId, quantity: line.quantity, unit: line.unit, price: line.price })),
      );
      setResult(response.data.data);
      await onSaved();
      setStep('done');
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Could not update this order');
    } finally {
      setSaving(false);
    }
  };

  const stepTitle =
    step === 'search' ? 'Find an order to manage'
      : step === 'edit' ? 'Set what was actually delivered'
        : step === 'preview' ? 'Preview the changes'
          : 'Order updated';

  const stepNumber = step === 'search' ? 1 : step === 'edit' ? 2 : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800" onClick={event => event.stopPropagation()}>
        <div className="border-b border-gray-100 px-4 py-4 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <Package className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Manage order</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{stepTitle}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={saving}
              className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700"
              aria-label="Close manage order" title="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          {step !== 'done' && (
            <div className="mt-4 flex items-center gap-1.5">
              {[1, 2, 3].map(stepIndex => (
                <div key={stepIndex} className={`h-1 flex-1 rounded-full ${
                  stepIndex <= stepNumber ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-700'
                }`} />
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {step === 'search' && (
            <>
              <form onSubmit={runSearch} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Order ID / number or mobile number"
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
                <button type="submit" disabled={!query.trim() || searching}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>
              <p className="text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                Search works across all dates. Pick the order, set what was delivered, add missing items, preview, then submit.
              </p>

              {searchError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{searchError}</span>
                </div>
              )}

              {searched && !searching && results.length === 0 && !searchError && (
                <p className="rounded-xl bg-gray-50 px-3 py-6 text-center text-xs text-gray-500 dark:bg-slate-700/40 dark:text-slate-400">
                  No order found for “{query.trim()}”.
                </p>
              )}

              <div className="space-y-2">
                {results.map(entry => {
                  const editable = EDITABLE_STATUSES.includes(entry.status) && entry.canManageMaster !== false;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={!editable}
                      onClick={() => selectOrder(entry)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                        editable
                          ? 'border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-slate-700 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/10'
                          : 'cursor-not-allowed border-gray-100 opacity-60 dark:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900 dark:text-white">#{entry.orderNumber}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                            {statusLabel(entry.status)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-700 dark:text-slate-300">{orderDisplayName(entry)}</p>
                        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                          {entry.guestPhone} · {formatWhen(entry.createdAt)} · {PAYMENT_LABELS[entry.paymentMethod] || entry.paymentMethod}
                        </p>
                        {!editable && (
                          <p className="mt-0.5 text-[11px] font-semibold text-gray-500 dark:text-slate-400">
                            {entry.canManageMaster === false
                              ? 'Managed by another store — cannot edit here'
                              : `Cannot edit a ${statusLabel(entry.status)} order`}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1 text-sm font-bold text-gray-900 dark:text-white">
                        <IndianRupee className="h-3.5 w-3.5" />{entry.total}
                        {editable && <ChevronRight className="ml-1 h-4 w-4 text-gray-400" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'edit' && order && (
            <>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-900 dark:text-white">#{order.orderNumber}</span>
                  <span className="text-xs font-bold text-gray-900 dark:text-white">₹{order.total}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-700 dark:text-slate-300">{orderDisplayName(order)}</p>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">{order.guestPhone} · {formatWhen(order.createdAt)}</p>
              </div>

              {items.map(item => {
                const delivered = quantities[item.id] ?? Number(item.quantity);
                const missing = Number(item.quantity) - delivered;
                return (
                  <div key={item.id} className={`rounded-xl border p-3 transition-colors ${
                    missing > 0
                      ? 'border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-900/10'
                      : 'border-gray-200 dark:border-slate-700'
                  }`}>
                    <div className="flex items-center gap-3">
                      <SmartImage src={item.photoUrl} alt={item.productName}
                        className="h-10 w-10 flex-shrink-0 rounded-lg border border-gray-100 dark:border-slate-600"
                        imgClassName="object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{item.productName}</p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400">
                          {item.unit} · ₹{item.price} each · ordered {item.quantity}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setQuantity(item, delivered - 1)} disabled={delivered === 0}
                          className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                          aria-label={`Reduce ${item.productName}`}>
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={delivered}
                          onChange={event => setQuantity(item, Number(event.target.value))}
                          className="w-12 rounded-lg border border-gray-200 bg-white px-1 py-1.5 text-center text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                          aria-label={`Delivered quantity for ${item.productName}`}
                        />
                        <button type="button" onClick={() => setQuantity(item, delivered + 1)} disabled={delivered >= Number(item.quantity)}
                          className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                          aria-label={`Increase ${item.productName}`}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {missing > 0 && (
                      <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        {missing === Number(item.quantity) ? 'Not delivered' : `${missing} not delivered`} · ₹{(missing * Number(item.price)).toFixed(2)} off
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Add products the customer asked to add to the placed order. */}
              <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300" htmlFor="manage-product-search">Add item</label>
                <div className="relative mt-1.5">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="manage-product-search"
                    type="text"
                    value={productQuery}
                    onChange={event => setProductQuery(event.target.value)}
                    placeholder="Search product to add"
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-10 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                  {productQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setProductQuery('');
                        setProductResults([]);
                        setProductError('');
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                      aria-label="Clear product search"
                      title="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {productSearching && (
                  <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">Searching products…</p>
                )}
                {productError && (
                  <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{productError}</p>
                )}
                {!productSearching && productResults.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {productResults.map(product => (
                      <div key={product.id} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{product.name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-slate-400">
                            {product.unit} · {Number(product.discountPercent) > 0 && <span className="mr-1 line-through">₹{product.price}</span>}
                            ₹{Number(product.discountPercent) > 0
                              ? Math.round(Number(product.price) * (1 - Number(product.discountPercent) / 100))
                              : product.price} each
                          </p>
                        </div>
                        <button type="button" onClick={() => addProduct(product)}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-700">
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!productSearching && productQuery.trim().length >= 2 && productResults.length === 0 && !productError && (
                  <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">No product found.</p>
                )}

                {addedLines.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Added items</p>
                    {addedLines.map(line => (
                      <div key={line.productId} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{line.productName}</p>
                          <p className="text-[11px] text-gray-500 dark:text-slate-400">₹{line.price} each</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setAddedQuantity(line.productId, line.quantity - 1)} disabled={line.quantity <= 1}
                            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                            aria-label={`Reduce added quantity of ${line.productName}`}>
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-bold text-gray-900 dark:text-white">{line.quantity}</span>
                          <button type="button" onClick={() => setAddedQuantity(line.productId, Math.min(MAX_ADDED_QUANTITY, line.quantity + 1))}
                            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                            aria-label={`Increase added quantity of ${line.productName}`}>
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => setAddedQuantity(line.productId, 0)}
                            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                            aria-label={`Remove added item ${line.productName}`}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300" htmlFor="manage-reason">Reason</label>
                <select id="manage-reason" value={reason} onChange={event => setReason(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white">
                  {REASONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <label className="mt-2 block text-xs font-semibold text-gray-700 dark:text-slate-300" htmlFor="manage-comment">
                  Comment <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  id="manage-comment"
                  type="text"
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                  placeholder={reason === 'Other' ? 'Tell us what happened' : 'Add a note for the journey'}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
              </div>

              {allRemoved && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>Every item cannot be marked undelivered here. Cancel the order instead.</span>
                </div>
              )}

              <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
                  <span>New total</span>
                  <span className="flex items-center gap-1 text-base font-bold text-gray-900 dark:text-white">
                    <IndianRupee className="h-4 w-4" />{newTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </>
          )}

          {step === 'preview' && order && (
            <>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
                <p className="text-xs font-bold text-gray-900 dark:text-white">#{order.orderNumber} · {orderDisplayName(order)}</p>
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">{order.guestPhone} · {order.guestAddress}</p>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                  Status: <span className="capitalize">{statusLabel(order.status)}</span> · Reason: {finalReason}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300" htmlFor="manage-payment">Payment mode</label>
                <select id="manage-payment" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as 'cod' | 'upi')}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white">
                  <option value="cod">Cash</option>
                  <option value="upi">UPI</option>
                </select>
                <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                  Change this only if the recorded mode was wrong. It updates the order on both apps.
                </p>
              </div>

              <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">What changes</p>
                {changedItems.map(item => {
                  const delivered = quantities[item.id];
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 break-words text-gray-700 dark:text-slate-300">{item.productName} ({item.unit})</span>
                      <span className="flex-shrink-0 font-semibold text-gray-900 dark:text-white">
                        {item.quantity} → {delivered}
                        {delivered === 0 ? ' (removed)' : ''}
                      </span>
                    </div>
                  );
                })}
                {addedLines.map(line => (
                  <div key={line.productId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 break-words text-gray-700 dark:text-slate-300">{line.productName} ({line.unit})</span>
                    <span className="flex-shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">
                      +{line.quantity} · ₹{(line.price * line.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
                  <span>Old total</span><span>₹{originalTotal.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
                  <span>Removed amount</span><span>-₹{removedTotal.toFixed(2)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 dark:border-slate-600">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">New total</span>
                  <span className="flex items-center gap-1 text-base font-bold text-gray-900 dark:text-white">
                    <IndianRupee className="h-4 w-4" />{newTotal.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                  New subtotal ₹{newSubtotal.toFixed(2)} · delivery ₹{deliveryCharge.toFixed(2)}
                  {campaignDiscount > 0 ? ` · offer -₹${campaignDiscount.toFixed(2)}` : ''}
                </p>
              </div>

              {removedTotal > 0 && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Refund due: ₹{removedTotal.toFixed(2)}. Refunds are not moved automatically — return it to the
                    customer by cash or UPI after submitting.
                  </span>
                </div>
              )}
            </>
          )}

          {step === 'done' && result && (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="mt-3 text-base font-bold text-gray-900 dark:text-white">Order updated</h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                #{result.orderNumber} is now ₹{Number(result.total).toFixed(2)}
                {result.paymentMethod ? ` · ${PAYMENT_LABELS[result.paymentMethod] || result.paymentMethod}` : ''}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Removed ₹{Number(result.removedTotal).toFixed(2)} across {result.adjustedItems} line(s).
                {result.addedItems > 0 && (
                  <>
                    {' '}
                    Added ₹{addedTotalValue.toFixed(2)} across {addedLines.length} items.
                  </>
                )}
                The hub and customer apps will show the updated order.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3 dark:border-slate-700">
          {step === 'search' && (
            <button type="button" onClick={onClose}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Cancel
            </button>
          )}

          {step === 'edit' && (
            <>
              <button type="button" onClick={() => setStep('search')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={() => setStep('preview')} disabled={!canPreview}
                className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                Preview changes
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button type="button" onClick={() => setStep('edit')} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={handleSubmit} disabled={saving || !canPreview}
                className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Submitting…' : `Submit · new total ₹${newTotal.toFixed(2)}`}
              </button>
            </>
          )}

          {step === 'done' && (
            <button type="button" onClick={onClose}
              className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

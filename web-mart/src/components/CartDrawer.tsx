import { useRef, useEffect } from 'react';
import { X, Plus, Minus, ShoppingCart, Trash2, ChevronDown } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import type { PublicSettings } from '../services/api';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: PublicSettings;
  onCheckout: () => void;
}

export default function CartDrawer({ open, onClose, settings, onCheckout }: CartDrawerProps) {
  const { items, updateQty, subtotal, clearCart } = useCartStore();
  const sheetRef = useRef<HTMLDivElement>(null);

  const deliveryCharge = parseFloat(settings.delivery_charge || '15');
  const freeAbove     = parseFloat(settings.free_delivery_above || '150');
  const minOrder      = parseFloat(settings.min_order_amount || '50');
  const sub           = subtotal();
  const actualDelivery = sub >= freeAbove ? 0 : deliveryCharge;
  const total         = sub + actualDelivery;
  const canCheckout   = sub >= minOrder;
  const totalItems    = items.reduce((s, i) => s + i.quantity, 0);

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const CartContent = () => (
    <>
      {/* Handle — mobile only */}
      <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
        <div className="w-10 h-1 bg-gray-200 rounded-full" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-emerald-600" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Your Cart</h2>
          {items.length > 0 && (
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
              {totalItems} {totalItems === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button onClick={clearCart} className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors">
              Clear
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4 text-gray-500 sm:block hidden" />
            <ChevronDown className="w-4 h-4 text-gray-500 sm:hidden" />
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <div className="text-5xl mb-3">🛒</div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Your cart is empty</p>
            <p className="text-xs text-gray-400">Add some fresh items to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {items.map(item => (
              <div key={`${item.productId}-${item.unit}`} className="flex items-center gap-3 px-4 py-3">
                {item.photoUrl ? (
                  <img src={item.photoUrl} alt={item.productName} className="w-11 h-11 rounded-xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0 text-lg">🥦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.productName}</p>
                  <p className="text-xs text-gray-400">{item.unit} · ₹{item.price}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => updateQty(item.productId, item.unit, item.quantity - 1)}
                    className="w-7 h-7 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors">
                    {item.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-gray-600 dark:text-slate-300" />}
                  </button>
                  <span className="text-sm font-bold text-gray-900 dark:text-white w-5 text-center">{item.quantity}</span>
                  <button onClick={() => updateQty(item.productId, item.unit, item.quantity + 1)}
                    className="w-7 h-7 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-white w-12 text-right flex-shrink-0">
                  ₹{(item.price * item.quantity).toFixed(0)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary + checkout */}
      {items.length > 0 && (
        <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-4 space-y-3 flex-shrink-0">
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-gray-600 dark:text-slate-400">
              <span>Subtotal</span><span>₹{sub.toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600 dark:text-slate-400">
              <span>Delivery</span>
              <span className={actualDelivery === 0 ? 'text-emerald-600 font-semibold' : ''}>
                {actualDelivery === 0 ? 'FREE 🎉' : `₹${actualDelivery}`}
              </span>
            </div>
            {actualDelivery > 0 && (
              <p className="text-xs text-emerald-600">Add ₹{(freeAbove - sub).toFixed(0)} more for free delivery</p>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white pt-1.5 border-t border-gray-100 dark:border-slate-700">
              <span>Total</span><span>₹{total.toFixed(0)}</span>
            </div>
          </div>

          {!canCheckout && (
            <p className="text-xs text-red-500 text-center">
              Minimum order ₹{minOrder}. Add ₹{(minOrder - sub).toFixed(0)} more.
            </p>
          )}

          <button
            onClick={() => { onClose(); onCheckout(); }}
            disabled={!canCheckout}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            Proceed to Checkout · ₹{total.toFixed(0)}
          </button>
        </div>
      )}
    </>
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm"
        onClick={handleBackdrop}
      />

      {/* Mobile — bottom sheet */}
      <div
        ref={sheetRef}
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: '88vh' }}
      >
        <CartContent />
      </div>

      {/* Desktop — side drawer */}
      <div className="hidden sm:flex fixed right-0 top-0 h-full w-full max-w-sm z-50 bg-white dark:bg-slate-800 flex-col shadow-2xl">
        <CartContent />
      </div>
    </>
  );
}

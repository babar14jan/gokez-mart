import { useState, useEffect, useRef } from 'react';
import { useFinePointer } from '../utils/useFinePointer';
import { Loader2, Plus, Minus, Trash2, MapPin, PenLine, X, Tag, Check, MessageCircle, ChevronUp, Clock, User, ShoppingBag } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { storeApi, campaignApi } from '../services/api';
import type { PublicSettings, Product } from '../services/api';
import { useCustomerStore } from '../store/customerStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import AddressForm, { type AddressCoordinates } from '../components/AddressForm';
import { getFunnelSessionId, syncFunnelCart, track, trackOnce } from '../utils/track';

interface CheckoutPageProps {
  settings: PublicSettings;
  zoneName?: string;
  storeId?: string;
  onBack: () => void;
  onHome: () => void;
  onSuccess: (orderNumber: string, preference: string, storeName?: string, savedAmount?: number, orderData?: any) => void;
  /**
   * Awaited before the order is sent. Resolves false to abandon the submission
   * without losing the basket. Owned by App so a single dialog serves both the
   * mobile and desktop mounts of this page.
   */
  confirmOrder?: () => Promise<boolean>;
  /**
   * Opens the login modal from inside checkout. Guests use it to unlock offers
   * (and order history); the OTP step stays fully optional for placing an order.
   */
  onLogin?: (campaign?: any) => void;
}

const inp = 'w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white dark:focus:bg-slate-600 transition-all';

const PREFERENCES = [
  { value: 'within_15', label: '⚡ 10-15 mins', sub: 'Fastest' },
  { value: 'within_30', label: '🕐 30 mins',   sub: 'Standard' },
  { value: 'within_60', label: '🕑 1 hour',    sub: 'Flexible' },
] as const;

const NOTES = ['Ring the bell', 'Call me when you arrive', "Don't ring the bell"];

const isValidGuestName = (name: string) => {
  const normalized = name.trim();
  return normalized.length >= 2 && normalized.length <= 80 && /\p{L}/u.test(normalized);
};
const isValidIndianMobile = (phone: string) => /^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''));
const isValidDeliveryAddress = (address: string | null) => {
  const normalized = address?.trim() || '';
  return normalized.length >= 10 && normalized.length <= 500;
};

type CheckoutValidationField = 'address' | 'name' | 'phone' | null;

/* ── Offers & coupons ─────────────────────────────────────────────────────────
   One panel for both the guest and the signed-in checkout. These used to be two
   independently maintained blocks, which is how the guest copy ended up with a
   "Hide" button that could never be undone while the signed-in copy applied an
   offer the instant a radio was touched. Both now render from here, so they
   cannot drift apart again.

   Nothing in this file invents an offer or a code. Every field below comes from
   the whitelisted projection that /campaigns/welcome and /campaigns/eligible
   return, which is populated by campaigns created in super admin -- so a new
   offer shows its own terms with no change here. */

type OfferCampaign = {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  badge_text?: string | null;
  coupon_code?: string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  max_discount?: number | string | null;
  min_order_amount?: number | string | null;
  valid_until?: string | null;
};

/* The admin stores these as NUMERIC, so they arrive as "50.00" and would otherwise
   print as a bare \u20b950.00 next to prose that says "Rs50". */
function money(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '');
}

function offerHeadline(c: OfferCampaign): string {
  if (c.discount_type === 'flat') return `\u20b9${money(c.discount_value)} off`;
  if (c.discount_type === 'percent') return `${money(c.discount_value)}% off`;
  return 'Free delivery';
}

/* The terms the customer is agreeing to. Assembled only from fields the admin
   actually set, so an offer with no minimum and no expiry shows neither. */
function offerDetailBits(c: OfferCampaign): string[] {
  const bits: string[] = [];
  if (Number(c.min_order_amount) > 0) bits.push(`Min order \u20b9${money(c.min_order_amount)}`);
  if (c.discount_type === 'percent' && Number(c.max_discount) > 0) bits.push(`up to \u20b9${money(c.max_discount)}`);
  if (c.valid_until) {
    // Year only when it is not the current one: a welcome offer valid until 2027
    // rendered as a bare "Ends 1 Oct", which reads like next month.
    const until = new Date(c.valid_until);
    const sameYear = until.getFullYear() === new Date().getFullYear();
    bits.push(`Ends ${until.toLocaleDateString('en-IN', sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' })}`);
  }
  if (c.coupon_code) bits.push(`Code ${c.coupon_code}`);
  return bits;
}

type OffersPanelProps = {
  cardClass: string;
  campaigns: OfferCampaign[];
  applied: OfferCampaign | null;
  appliedCode: string | null;
  discount: number;
  notice: string;
  locked: boolean;               // guest: applying needs an OTP login first
  hidden: boolean;
  onToggleHidden: () => void;
  codeInput: string;
  onCodeInput: (v: string) => void;
  codeLoading: boolean;
  codeError: string;
  codeSuccess: string;
  onValidateCode: () => void;
  onApply: (c: OfferCampaign) => void;
  onClearCode: () => void;
  onRemoveOffer: () => void;
};

function OffersPanel(props: OffersPanelProps) {
  const { cardClass, campaigns, applied, appliedCode, discount, notice, locked,
    hidden, onToggleHidden, codeInput, onCodeInput, codeLoading, codeError,
    codeSuccess, onValidateCode, onApply, onClearCode, onRemoveOffer } = props;

  return (
    <div className={cardClass}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Tag className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Offers &amp; coupons</span>
            {campaigns.length > 0 && (
              <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 rounded-full px-1.5 py-0.5">
                {campaigns.length}
              </span>
            )}
          </div>
          {/* Two-way. The old Hide set a sessionStorage flag with nothing to clear
              it, so hiding was permanent for the rest of the tab session. */}
          {campaigns.length > 0 && (
            <button type="button" onClick={onToggleHidden}
              className="text-xs font-semibold text-gray-400 hover:text-emerald-600 transition-colors flex-shrink-0">
              {hidden ? 'Show' : 'Hide'}
            </button>
          )}
        </div>

        {/* Collapsed state still advertises what is on offer, so hiding is never
            a dead end -- the customer can always see there is something to claim. */}
        {campaigns.length > 0 && hidden && (
          <button type="button" onClick={onToggleHidden}
            className="mt-3 w-full text-left rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-3 py-2.5">
            <p className="text-[11px] font-bold text-violet-700 dark:text-violet-300">
              {campaigns.length} offer{campaigns.length > 1 ? 's' : ''} available
            </p>
            <p className="text-[10px] text-violet-600 dark:text-violet-400 mt-0.5">Tap Show to view and apply</p>
          </button>
        )}

        {campaigns.length > 0 && !hidden && (
          <div className="mt-3 space-y-2">
            {notice && (
              <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {notice}
              </p>
            )}
            <p className="text-[11px] leading-tight text-gray-500 dark:text-slate-400">
              Apply one offer. Coupon codes cannot be combined with another offer.
            </p>

            {campaigns.map((c) => {
              const isApplied = applied?.id === c.id && !appliedCode;
              const isAppliedByCode = applied?.id === c.id && !!appliedCode;
              const headline = offerHeadline(c);
              const desc = c.description || c.subtitle || headline;
              const bits = offerDetailBits(c);
              const done = isApplied || isAppliedByCode;
              return (
                <div key={c.id}
                  className={`rounded-xl border px-3 py-2.5 transition-colors ${
                    done ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                         : 'border-violet-200 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-xs font-bold break-words ${done ? 'text-emerald-700 dark:text-emerald-300' : 'text-violet-700 dark:text-violet-300'}`}>
                        {c.badge_text ? `${c.badge_text} ` : ''}{c.title}
                      </p>
                      <p className={`text-[11px] mt-0.5 break-words ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-violet-600 dark:text-violet-400'}`}>
                        {desc}
                      </p>
                      {bits.length > 0 && (
                        <p className="text-[10px] mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 text-gray-500 dark:text-slate-400">
                          {bits.map((b) => (
                            <span key={b} className="after:content-['\00b7'] after:ml-1.5 last:after:content-['']">{b}</span>
                          ))}
                        </p>
                      )}
                    </div>
                    {/* Explicit Apply. The old signed-in list applied the moment the
                        radio was touched, which read as the app grabbing a discount
                        the customer had not chosen. */}
                    <button
                      type="button"
                      disabled={done}
                      onClick={() => onApply(c)}
                      className={`flex-shrink-0 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${
                        done ? 'bg-emerald-200 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-300 cursor-default'
                             : 'bg-violet-500 hover:bg-violet-600 text-white'}`}>
                      {done ? 'Applied' : locked ? 'Apply & Save' : 'Apply'}
                    </button>
                  </div>
                </div>
              );
            })}
            {locked && (
              <p className="text-[10px] text-gray-400 dark:text-slate-500 text-center">
                Log in via OTP to apply · No password needed
              </p>
            )}
          </div>
        )}

        {campaigns.length === 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
            {notice && (
              <p className="mb-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {notice}
              </p>
            )}
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
              {locked
                ? 'Log in to unlock exclusive offers and discounts on your order.'
                : 'No offers are available for this cart right now. You can still enter a coupon code below.'}
            </p>
            {locked && (
              <button type="button" onClick={() => onApply(null as any)}
                className="w-full py-2.5 text-xs font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 rounded-xl transition-colors">
                Log in for offers →
              </button>
            )}
          </div>
        )}

        {/* Signed-in only. /campaigns/validate requires auth, so a guest typing
            here gets a bare "No token provided". Guests apply the campaign code
            with Apply & Save, and the code is printed in the offer details. */}
        {!locked && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Coupon code</label>
          <div className="flex gap-2">
            <input type="text" value={codeInput} onChange={e => onCodeInput(e.target.value)} placeholder="Enter coupon code"
              className="flex-1 min-w-0 px-3 py-2 text-xs border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
            <button type="button" onClick={onValidateCode} disabled={codeLoading || !codeInput.trim()}
              className="px-3 py-2 text-xs font-bold text-white bg-violet-500 hover:bg-violet-600 rounded-xl disabled:opacity-50 flex items-center gap-1 whitespace-nowrap">
              {codeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Apply
            </button>
          </div>
          {codeSuccess && <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">{codeSuccess}</p>}
          {codeError && <p className="mt-1.5 text-xs text-red-500">{codeError}</p>}
        </div>
        )}

        {applied && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 break-words">{applied.title}</p>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                {discount > 0 ? `-\u20b9${money(discount)} saved` : 'Free delivery applied'}
                {appliedCode ? ` \u00b7 ${appliedCode}` : ''}
              </p>
            </div>
            <button type="button" onClick={appliedCode ? onClearCode : onRemoveOffer}
              className="p-1 text-emerald-600 hover:text-red-500 flex-shrink-0" aria-label="Remove offer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CheckoutPage({ settings, zoneName, storeId, onBack, onHome, onSuccess, confirmOrder, onLogin }: CheckoutPageProps) {
  const finePointer = useFinePointer();
  const orderRequestKey = useRef(crypto.randomUUID());
  const guestNameInput = useRef<HTMLInputElement>(null);
  const guestPhoneInput = useRef<HTMLInputElement>(null);
  const { items, updateQty, subtotal, clearCart, addItem } = useCartStore();
  const { phone: savedPhone, name: savedName, addresses, loadAddresses, getDefaultAddress, setDefaultAddress, addAddress } = useCustomerStore();
  const { phone: authPhone, name: authName, address: authAddress, isLoggedIn } = useCustomerAuthStore();

  useEffect(() => { if (isLoggedIn) loadAddresses(); }, [isLoggedIn]);

  const [suggestions, setSuggestions] = useState<Product[]>([]);
  useEffect(() => {
    if (!storeId) return;
    storeApi.getProducts(undefined, storeId).then(r => {
      const cartIds = new Set(items.map(i => i.productId));
      const all = (r.data.data || []).filter(p =>
        p.availabilityStatus === 'available'
        && p.isAvailable
        && Boolean(p.categoryId && p.categoryName)
        && !cartIds.has(p.id)
      );
      setSuggestions(all.slice(0, 8));
    }).catch(() => {});
  }, [storeId]);

  const visibleSuggestions = suggestions.filter(product =>
    product.availabilityStatus === 'available'
    && product.isAvailable
    && Boolean(product.categoryId && product.categoryName)
    && !items.some(item => item.productId === product.id)
  );

  const defaultAddr = getDefaultAddress();

  // A guest supplies their delivery address inline (the address book is behind
  // login). It rides inside the order and the server files it into the same
  // address book when the order lands, so a later login with the same phone
  // finds it again.
  const [guestAddress, setGuestAddress] = useState(() => {
    if (typeof window !== 'undefined' && !isLoggedIn) {
      return localStorage.getItem('guest_address') || '';
    }
    return '';
  });
  const [guestAddressLabel, setGuestAddressLabel] = useState('Home');
  const [guestAddressCoordinates, setGuestAddressCoordinates] = useState<AddressCoordinates | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoggedIn && guestAddress) {
      localStorage.setItem('guest_address', guestAddress);
    }
  }, [guestAddress, isLoggedIn]);

  const deliveryAddress = defaultAddr?.address || (isLoggedIn ? authAddress : null) || guestAddress || null;

  const [guestName, setGuestName] = useState(() => {
    if (typeof window !== 'undefined' && !isLoggedIn) {
      return localStorage.getItem('guest_name') || '';
    }
    return (isLoggedIn ? authName : savedName) || '';
  });
  const [guestPhone, setGuestPhone] = useState(() => {
    if (typeof window !== 'undefined' && !isLoggedIn) {
      return localStorage.getItem('guest_phone') || '';
    }
    return (isLoggedIn ? authPhone : savedPhone) || '';
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoggedIn && guestName) {
      localStorage.setItem('guest_name', guestName);
    }
  }, [guestName, isLoggedIn]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoggedIn && guestPhone) {
      localStorage.setItem('guest_phone', guestPhone);
    }
  }, [guestPhone, isLoggedIn]);

  // Address
  const [showAddressList, setShowAddressList] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);

  // Delivery preference
  const [deliveryPreference, setDeliveryPreference] = useState<'within_15' | 'within_30' | 'within_60'>('within_15');
  const [showPreferences, setShowPreferences] = useState(false);

  // Delivery note
  const [deliveryNote, setDeliveryNote] = useState('Ring the bell');
  const [showNotes, setShowNotes] = useState(false);
  const [showCustomNote, setShowCustomNote] = useState(false);
  const [customNote, setCustomNote] = useState('');


  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationField, setValidationField] = useState<CheckoutValidationField>(null);
  const [showMissingDetails, setShowMissingDetails] = useState(false);

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
  const [billExpanded, setBillExpanded] = useState(false);
  const [offerNotice, setOfferNotice] = useState('');
  // Offers are optional at checkout. Start collapsed on every new checkout so
  // they do not interrupt the delivery and payment path.
  const [offersHidden, setOffersHidden] = useState(true);
  const toggleOffersHidden = () => setOffersHidden(hidden => !hidden);

  useEffect(() => {
    // Offers are explicitly selected for each checkout; never restore an old cart selection.
    useCartStore.getState().setAppliedCampaign(null, 0);
  }, []);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;

    const load = async () => {
      // The welcome teaser is public and carries coupon codes, so a code-style
      // offer like FIRST50 can be shown before login. Untargeted automatic
      // offers stay identity-gated behind /campaigns/eligible.
      const [welcomeRes, eligibleRes] = await Promise.allSettled([
        campaignApi.getWelcome(cartSubtotal, storeId),
        isLoggedIn ? campaignApi.getEligible(cartSubtotal, storeId) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const welcome: any[] = welcomeRes.status === 'fulfilled' ? (welcomeRes.value?.data?.data || []) : [];
      const eligible: any[] = eligibleRes.status === 'fulfilled' && eligibleRes.value
        ? (eligibleRes.value?.data?.data || []) : [];
      const merged = [...eligible, ...welcome.filter(w => !eligible.some((e: any) => e.id === w.id))];
      setEligibleCampaigns(merged);

      if (appliedCampaign && !appliedCouponCode && !eligible.some((c: any) => c.id === appliedCampaign.id)) {
        removeCampaign();
      }

      const flow = useLoginFlowStore.getState();
      if (!isLoggedIn || !flow.pendingCouponApply || !storeId) return;

      // Apply the offer the shopper actually tapped. Falling back to the first
      // row would silently apply whichever offer sorts first by priority.
      const target = flow.pendingCampaignId
        ? merged.find((c: any) => c.id === flow.pendingCampaignId)
        : null;
      flow.setPendingCouponApply(false, null);

      if (!target) { setOfferNotice("That offer isn't available for this cart anymore."); return; }

      if (target.coupon_code) {
        // The teaser is not authority. Redeem the code through the authenticated
        // endpoint so first-order status and per-customer limits are re-checked
        // against a verified identity before anything is discounted.
        try {
          const res = await campaignApi.validateCode(target.coupon_code, cartSubtotal, storeId);
          if (cancelled) return;
          const campaign = res.data.data.campaign;
          applyCampaign(campaign, target.coupon_code);
        } catch (e: any) {
          if (cancelled) return;
          setOfferNotice(e?.response?.data?.error || 'This offer could not be applied.');
        }
      } else {
        applyCampaign(target);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [storeId, cartSubtotal, appliedCampaign, appliedCouponCode, isLoggedIn]);

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

  /* The single server-side redemption path. A typed code and an offer row that
     carries its own code both come through here, so a discount is never taken on
     the client's word: the server re-checks eligibility, expiry, usage limits and
     minimum order before the figure on screen is allowed to stand. */
  const applyCode = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code || !storeId) return;
    setCouponLoading(true); setCouponError(''); setCouponSuccess('');
    try {
      const res = await campaignApi.validateCode(code, sub, storeId);
      const { campaign } = res.data.data;
      applyCampaign(campaign, code);
      setCouponSuccess('Coupon applied');
    } catch (e: any) {
      setCouponSuccess('');
      setCouponError(e?.response?.data?.error || 'Invalid coupon');
    } finally { setCouponLoading(false); }
  };

  const validateCoupon = () => applyCode(couponInput);

  const deliveryCharge = parseFloat(settings.delivery_charge || '15');
  const freeAbove = parseFloat(settings.free_delivery_above || '150');
  const minOrder = parseFloat(settings.min_order_amount || '50');
  const sub = subtotal();
  const actualDelivery = appliedCampaign?.discount_type === 'free_delivery' ? 0 : (sub >= freeAbove ? 0 : deliveryCharge);
  const total = Math.max(0, sub + actualDelivery - campaignDiscount);
  const canCheckout = sub >= minOrder && items.length > 0;

  const resolvedAddress = deliveryAddress;
  const checkoutName = isLoggedIn ? (authName || guestName) : guestName;
  const checkoutPhone = isLoggedIn ? (authPhone || guestPhone) : guestPhone;
  const incompleteCheckoutDetails = [
    !isValidGuestName(checkoutName) && 'name',
    !isValidIndianMobile(checkoutPhone) && 'mobile number',
    !isValidDeliveryAddress(resolvedAddress) && 'delivery address',
  ].filter(Boolean) as string[];
  const selectedAddress = addresses.find(a => a.address === deliveryAddress);
  const selectedLabel = selectedAddress?.label ?? (guestAddress ? guestAddressLabel : 'Address');
  const selectedPref = PREFERENCES.find(p => p.value === deliveryPreference)!;
  const currentNote = showCustomNote ? (customNote || '✏️ Custom note') : deliveryNote;

  // Reaching checkout is a distinct funnel stage, and it is also recorded on
  // the server cart so "started checkout, never ordered" survives a reload.
  useEffect(() => {
    if (items.length === 0) return;
    trackOnce('checkout_started', { itemCount: items.length, subtotal: items.reduce((s2, i) => s2 + i.price * i.quantity, 0) });
    syncFunnelCart(items, { reachedCheckout: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = checkoutName;
    const phone = checkoutPhone;
    if (!name?.trim() || !isValidGuestName(name)) {
      setError('');
      setShowMissingDetails(true);
      setValidationField('name');
      guestNameInput.current?.focus();
      return;
    }
    if (!phone?.trim() || !isValidIndianMobile(phone)) {
      setError('');
      setShowMissingDetails(true);
      setValidationField('phone');
      guestPhoneInput.current?.focus();
      return;
    }
    if (!isValidDeliveryAddress(resolvedAddress)) {
      setError('');
      setShowMissingDetails(true);
      setValidationField('address');
      setAddingNew(!isLoggedIn || addresses.length === 0);
      setShowAddressList(true);
      return;
    }
    if (!canCheckout) return;
    const orderAddress = resolvedAddress!.trim();
    // After validation, before the request: a customer with a form problem
    // should be told about that, not asked to confirm a delay they have not
    // reached yet. Defaulting to "proceed" keeps checkout working if this page
    // is ever rendered without the prop.
    if (confirmOrder && !(await confirmOrder())) return;
    setLoading(true); setError(''); setValidationField(null); setShowMissingDetails(false);
    try {
      const res = await storeApi.placeOrder({
        guestName: name, guestPhone: phone.replace(/\D/g, ''),
        guestAddress: orderAddress,
        guestAddressLabel: isLoggedIn ? undefined : guestAddressLabel,
        latitude: selectedAddress?.latitude ?? guestAddressCoordinates?.latitude ?? null,
        longitude: selectedAddress?.longitude ?? guestAddressCoordinates?.longitude ?? null,
        items: items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity })),
        zoneName: zoneName || undefined, storeId: storeId || undefined,
        deliveryPreference,
        deliveryNote: showCustomNote ? (customNote.trim() || 'Ring the bell') : deliveryNote,
        campaignId: appliedCouponCode ? undefined : appliedCampaign?.id || undefined,
        couponCode: appliedCouponCode || undefined,
        // Without this the server has no way to tie the order back to the cart
        // that produced it, and the funnel reports every checkout as abandoned.
        funnelSessionId: getFunnelSessionId(),
      }, orderRequestKey.current);
      track('order_completed', { orderNumber: res.data.data.orderNumber, itemCount: items.length, value: res.data.data.total });
      const orderData = {
        orderNumber: res.data.data.orderNumber,
        trackingToken: res.data.data.trackingToken,
        items: items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity, photoUrl: i.photoUrl || null })),
        total: res.data.data.total,
        guestAddress: orderAddress,
        guestName: isLoggedIn ? (authName || guestName) : guestName,
        guestPhone: isLoggedIn ? (authPhone || guestPhone) : guestPhone,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      clearCart();
      onSuccess(res.data.data.orderNumber, deliveryPreference, res.data.data.storeName, campaignDiscount > 0 ? campaignDiscount : undefined, orderData);
    } catch (err: any) {
      console.error('[checkout] order placement failed', err);
      if (!err?.response) {
        setError('We could not connect right now. Check your internet connection and try again.');
      } else if (err.response.status >= 500) {
        setError('We could not place your order right now. Your cart is still saved. Please try again shortly.');
      } else {
        setError(err.response.data?.error || 'We could not place your order. Please review your details and try again.');
      }
    } finally { setLoading(false); }
  };

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden';

  // Reachable from the Orders "Track My Orders" login and the account page, so
  // an empty basket is a real entry state. Without this the page renders a
  // permanently disabled Place Order button and no explanation.
  if (items.length === 0) {
    return (
      <div className="page-shell bg-gray-50 dark:bg-slate-900 flex flex-col">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between">
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-slate-400">
            <ChevronUp className="w-4 h-4 rotate-90" /> Back
          </button>
          <span className="text-sm font-bold text-gray-900 dark:text-white">Checkout</span>
          <span className="w-8" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="w-16 h-16 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
            <ShoppingBag className="w-7 h-7 text-gray-300" />
          </div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-1">Your cart is empty</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Add a few items to start your order.</p>
          <button type="button" onClick={onHome}
            className="w-full max-w-xs py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all">
            Browse products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between">
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
            {canCheckout && actualDelivery > 0 && (
              <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/10 border-t border-emerald-100 dark:border-emerald-900">
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium text-center">
                  🎉 Add ₹{(freeAbove - sub).toFixed(0)} more in items for free delivery at ₹{freeAbove.toFixed(0)}
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
          {visibleSuggestions.length > 0 && (
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-2 px-1">You may also like</p>
              <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
                {visibleSuggestions.map(p => (
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

          {/* Address bottom sheet */}
          {showAddressList && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm"
              onClick={() => { setShowAddressList(false); setAddingNew(!deliveryAddress); }}>
              <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{addingNew ? 'Add delivery address' : 'Choose delivery address'}</p>
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
                            onClick={() => { setDefaultAddress(addr.id); setValidationField(null); setShowAddressList(false); setAddingNew(false); }}
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
                  <div className="px-5 py-4">
                    <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Fields marked * are needed to deliver your order. A landmark is optional but helpful.</p>
                    <AddressForm saving={addressSaving} focusFirstField={validationField === 'address'} onCancel={() => setAddingNew(false)}
                      onSave={async (label, address, coordinates) => {
                        setAddressSaving(true);
                        try {
                          if (isLoggedIn) {
                            await addAddress({ label, address, isDefault: addresses.length === 0, ...coordinates });
                          } else {
                            // Guests have no server address book yet; hold the
                            // address for this checkout and let the order land it
                            // in the book server-side.
                            setGuestAddress(address);
                            setGuestAddressLabel(label.trim() || 'Home');
                            setGuestAddressCoordinates(coordinates);
                          }
                          setValidationField(null);
                          setAddingNew(false);
                          setShowAddressList(false);
                        } finally { setAddressSaving(false); }
                      }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Who's ordering ── */}
          <div className={card}>
            {isLoggedIn ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{authName || 'Customer'}</p>
                    <p className="text-[11px] text-gray-500">+91 {authPhone}</p>
                  </div>
                </div>
              </div>
) : (
              <div className="px-4 py-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-slate-700">
                      <User className="h-4 w-4 text-gray-600 dark:text-slate-300" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">Guest checkout</p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400">Your delivery details</p>
                    </div>
                  </div>
                  {onLogin && <button type="button" onClick={() => onLogin()} title="Log in to use your saved details" className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:border-rose-700 dark:hover:bg-rose-950/50">Log in</button>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                    Name <span className="text-emerald-600" aria-hidden="true">*</span>
                  </label>
                  <input ref={guestNameInput} type="text" value={guestName} onChange={e => { setGuestName(e.target.value); if (validationField === 'name') setValidationField(null); }}
                    placeholder="Enter your name" autoComplete="name" className={`${inp} h-11 px-3 py-2.5 ${validationField === 'name' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`} required aria-required="true" aria-invalid={validationField === 'name'} aria-describedby={validationField === 'name' ? 'guest-name-error' : undefined} />
                  {validationField === 'name' && <p id="guest-name-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">Enter your name using at least 2 characters.</p>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                    Phone number <span className="text-emerald-600" aria-hidden="true">*</span>
                  </label>
                  <input ref={guestPhoneInput} type="tel" inputMode="numeric" value={guestPhone}
                    onChange={e => { setGuestPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); if (validationField === 'phone') setValidationField(null); }}
                    placeholder="10-digit mobile number" autoComplete="tel" className={`${inp} h-11 px-3 py-2.5 ${validationField === 'phone' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`} required aria-required="true" aria-invalid={validationField === 'phone'} aria-describedby={validationField === 'phone' ? 'guest-phone-error' : undefined} />
                  {validationField === 'phone' && <p id="guest-phone-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">Enter a valid 10-digit Indian mobile number.</p>}
                </div>
              </div>
            )}
          </div>

          {/* ── Offers / Coupons ── */}
          <OffersPanel
            cardClass={card}
            campaigns={eligibleCampaigns}
            applied={appliedCampaign}
            appliedCode={appliedCouponCode}
            discount={campaignDiscount}
            notice={offerNotice}
            locked={!isLoggedIn}
            hidden={offersHidden}
            onToggleHidden={toggleOffersHidden}
            codeInput={couponInput}
            onCodeInput={(v) => { setCouponInput(v.toUpperCase()); setCouponError(''); setCouponSuccess(''); }}
            codeLoading={couponLoading}
            codeError={couponError}
            codeSuccess={couponSuccess}
            onValidateCode={validateCoupon}
            onApply={(c) => {
              setOfferNotice('');
              // null means the empty state: a guest tapping "Log in for offers"
              // wants the offers themselves, not one particular offer.
              if (!c) { onLogin?.(); return; }
              // A guest has no server-side identity yet, so the offer is applied
              // once the OTP login returns (see the pendingCouponApply effect).
              if (!isLoggedIn) { onLogin?.(c); return; }
              // A campaign carrying a code must still be redeemed server-side even
              // when the customer is signed in: /campaigns/welcome hands coded
              // offers to logged-in shoppers too.
              if (c.coupon_code) { applyCode(c.coupon_code); return; }
              applyCampaign(c);
            }}
            onClearCode={removeCampaign}
            onRemoveOffer={removeCampaign}
          />


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
                        className={`${inp} resize-none`} rows={2} placeholder="e.g. Come to 3rd floor" autoFocus={finePointer} />
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
          <button type="button" onClick={() => setShowAddressList(true)} aria-invalid={validationField === 'address'}
            className={`w-full flex items-center gap-2.5 px-4 pt-3 pb-2 text-left ${validationField === 'address' ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
            <ChevronUp className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span className="text-sm font-bold text-gray-900 dark:text-white">Delivering to {selectedLabel}</span>
              </div>
              {deliveryAddress
                ? <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">{deliveryAddress}</p>
                : <p className="text-xs text-red-600 dark:text-red-400 font-semibold mt-0.5">Add a complete delivery address</p>
              }
            </div>
            <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">{deliveryAddress ? 'Change' : 'Add'}</span>
          </button>

          <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {!canCheckout && sub < minOrder && (
              <p className="text-xs text-red-500 text-center mb-2">Just ₹{(minOrder - sub).toFixed(0)} more to place your order.</p>
            )}

            {canCheckout && showMissingDetails && incompleteCheckoutDetails.length > 0 && (
              <p className="mb-2 text-center text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
                Still needed: {incompleteCheckoutDetails.join(', ')}
              </p>
            )}

            <div className="flex items-center gap-3">
              <div className="w-16 flex-shrink-0 text-center">
                <p className="text-[10px] text-gray-500 dark:text-slate-400">To pay</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">₹{total.toFixed(0)}</p>
              </div>
              <button type="submit" form="checkout-form" disabled={loading}
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

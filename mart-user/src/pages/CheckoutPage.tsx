import { useState, useEffect, useRef, useMemo } from 'react';
import { useFinePointer } from '../utils/useFinePointer';
import { ChevronLeft, Loader2, Plus, Minus, Trash2, X, Tag, Check, MessageCircle, ChevronUp, ChevronRight, Clock, User, ShoppingBag } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { storeApi, campaignApi, authApi } from '../services/api';
import type { PublicSettings, Product, StoreOpeningHours } from '../services/api';
import { useCustomerStore, type SavedAddress } from '../store/customerStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { type AddressCoordinates } from '../components/AddressForm';
import AddressSheet from '../components/AddressSheet';
import AddressButton from '../components/AddressButton';
import ProductCard from '../components/ProductCard';
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
  { value: 'scheduled', label: '📅 Schedule',  sub: 'Pick a slot' },
] as const;

/* Designated delivery windows, generated from the store's opening hours. A
   customer who does not need the fastest option picks a day and a two-hour
   slot; the chosen start instant is stored on the order so the hub and the
   rider plan around it. Slots run open→close for today and tomorrow only, and
   any window that has already started is dropped, so the picker never offers a
   time that has passed. All of this is reasoned about in IST -- the store's
   clock -- rather than the customer's device, matching the backend. Exit the
   country and the slots still line up with the shop's day. */
const IST_OFFSET_MIN = 330; // Asia/Kolkata, fixed +05:30
const SLOT_MINUTES = 120;
const SLOT_LEAD_MINUTES = 30; // a window opening within 30 min is not bookable
const FALLBACK_OPEN_MIN = 8 * 60;
const FALLBACK_CLOSE_MIN = 22 * 60;
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface DeliverySlot {
  offset: number; // days from today: 0, 1
  start: number;  // minutes from IST midnight
  end: number;
  at: Date;       // UTC instant the window opens
}
export interface DeliveryDay {
  offset: number;
  label: string;
  slots: DeliverySlot[];
}

function istParts(d: Date = new Date()) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(),
    day: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes(),
  };
}
function istInstant(offset: number, minutes: number): Date {
  const b = istParts();
  const midnight = Date.UTC(b.y, b.mo, b.d + offset);
  return new Date(midnight + minutes * 60000 - IST_OFFSET_MIN * 60000);
}
function toMinutes(hhmm: string | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 ? v : fallback;
}
function fmtClock(minutes: number): { text: string; mer: 'AM' | 'PM' } {
  const h24 = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const mer = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: mm === 0 ? `${h}` : `${h}:${String(mm).padStart(2, '0')}`, mer };
}
function slotRange(slot: DeliverySlot): string {
  const a = fmtClock(slot.start), b = fmtClock(slot.end);
  return a.mer === b.mer ? `${a.text}–${b.text} ${b.mer}` : `${a.text} ${a.mer}–${b.text} ${b.mer}`;
}
function buildSchedule(hours: StoreOpeningHours | undefined): DeliveryDay[] {
  const nowMs = Date.now();
  const b = istParts();
  const days: DeliveryDay[] = [];
  for (let offset = 0; offset < 2; offset++) {
    const dt = new Date(Date.UTC(b.y, b.mo, b.d + offset));
    const key = JS_DAY_TO_KEY[dt.getUTCDay()] ?? 'mon';
    const label = offset === 0 ? 'Today' : 'Tomorrow';
    const w = hours?.[key];
    const slots: DeliverySlot[] = [];
    if (w && !w.closed) {
      const open = toMinutes(w.open, FALLBACK_OPEN_MIN);
      const close = toMinutes(w.close, FALLBACK_CLOSE_MIN);
      for (let s = open; s + 60 <= close; s += SLOT_MINUTES) {
        const at = istInstant(offset, s);
        if (at.getTime() <= nowMs + SLOT_LEAD_MINUTES * 60000) continue;
        slots.push({ offset, start: s, end: Math.min(s + SLOT_MINUTES, close), at });
      }
    }
    days.push({ offset, label, slots });
  }
  return days;
}
function dayLabel(days: DeliveryDay[], offset: number): string {
  return days.find(d => d.offset === offset)?.label ?? '';
}
function slotLabel(days: DeliveryDay[], slot: DeliverySlot | null): string {
  if (!slot) return '';
  return `${dayLabel(days, slot.offset)} · ${slotRange(slot)}`;
}

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
  eligibility_type?: string | null;
  allow_redemption_until_used?: boolean;
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

function formatOfferText(text: string): string {
  return text
    .replace(/\bRs\.?\s*/gi, '\u20b9')
    .replace(/\s+(?:above|over)\s*₹\s*\d+(?:\.\d+)?/gi, '');
}

/* The terms the customer is agreeing to. Assembled only from fields the admin
   actually set, so an offer with no minimum and no expiry shows neither. */
function offerDetailBits(c: OfferCampaign): string[] {
  const bits: string[] = [];
  if (Number(c.min_order_amount) > 0) bits.push(`Min order \u20b9${money(c.min_order_amount)}`);
  if (c.discount_type === 'percent' && Number(c.max_discount) > 0) bits.push(`up to \u20b9${money(c.max_discount)}`);
  if (c.coupon_code) bits.push(`Code ${c.coupon_code}`);
  return bits;
}

function welcomeOfferMessage(c: OfferCampaign): string | null {
  if (c.eligibility_type !== 'first_order' || !c.allow_redemption_until_used) return null;
  return c.coupon_code
    ? `Your unused ${c.coupon_code} welcome offer is still available.`
    : 'Your unused welcome offer is still available.';
}

type OffersPanelProps = {
  cardClass: string;
  campaigns: OfferCampaign[];
  applied: OfferCampaign | null;
  appliedCode: string | null;
  notice: string;
  locked: boolean;               // guest: applying needs an OTP login first
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
  const { cardClass, campaigns, applied, appliedCode, notice, locked,
    codeInput, onCodeInput, codeLoading, codeError,
    codeSuccess, onValidateCode, onApply, onClearCode, onRemoveOffer } = props;
  const hasMinimumOrderNotice = /^Add ₹[\d.]+ more to unlock this offer/.test(notice);

  return (
    <div className={cardClass}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Tag className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">Offers &amp; coupons</span>
              {campaigns.length === 0 && !locked && !hasMinimumOrderNotice && (
                <span className="block text-[11px] text-gray-500 dark:text-slate-400">No offers are available for this cart right now.</span>
              )}
            </div>
          </div>
        </div>

        {campaigns.length > 0 && (
          <div className="mt-3 space-y-2">
            {notice && (
              <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {notice}
              </p>
            )}

            {campaigns.map((c) => {
              const isApplied = applied?.id === c.id && !appliedCode;
              const isAppliedByCode = applied?.id === c.id && !!appliedCode;
              const headline = offerHeadline(c);
              const desc = formatOfferText(c.description || c.subtitle || headline);
              const bits = offerDetailBits(c);
              const welcomeMessage = welcomeOfferMessage(c);
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
                      {welcomeMessage && <p className="mt-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{welcomeMessage}</p>}
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
                      onClick={() => done ? (isAppliedByCode ? onClearCode() : onRemoveOffer()) : onApply(c)}
                      className={`flex-shrink-0 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${
                        done ? 'text-emerald-700 hover:text-red-600 dark:text-emerald-300'
                             : 'bg-violet-500 hover:bg-violet-600 text-white'}`}>
                      {done ? 'Remove' : locked ? 'Apply & Save' : 'Apply'}
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
          <div className={locked || notice ? 'mt-2' : ''}>
            {notice && (
              <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {notice}
              </p>
            )}
            {locked && !hasMinimumOrderNotice && (
              <p className="mb-2 text-[11px] text-gray-500 dark:text-slate-400">Log in to unlock exclusive offers and discounts on your order.</p>
            )}
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
        {!locked && !hasMinimumOrderNotice && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300">Have a coupon code?</label>
            {appliedCode && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Applied</span>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={appliedCode || codeInput} onChange={e => onCodeInput(e.target.value)} placeholder="Enter coupon code" disabled={Boolean(appliedCode)}
              className="flex-1 min-w-0 px-3 py-2 text-xs border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700 dark:disabled:border-emerald-800 dark:disabled:bg-emerald-900/20 dark:disabled:text-emerald-300" />
            <button type="button" onClick={appliedCode ? onClearCode : onValidateCode} disabled={!appliedCode && (codeLoading || !codeInput.trim())}
              className={`px-3 py-2 text-xs font-bold rounded-xl disabled:opacity-50 flex items-center gap-1 whitespace-nowrap ${appliedCode ? 'text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-300 dark:bg-red-900/20 dark:hover:bg-red-900/30' : 'text-white bg-violet-500 hover:bg-violet-600'}`}>
              {appliedCode ? <X className="w-3 h-3" /> : codeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {appliedCode ? 'Remove' : 'Apply'}
            </button>
          </div>
          {codeSuccess && <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">{codeSuccess}</p>}
          {codeError && <p className="mt-1.5 text-xs text-red-500">{codeError}</p>}
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
  const profileNameInput = useRef<HTMLInputElement>(null);
  const { items, updateQty, removeItem, subtotal, clearCart } = useCartStore();
  const { phone: savedPhone, name: savedName, addresses, loadAddresses, getDefaultAddress, setDefaultAddress, addAddress, updateAddress } = useCustomerStore();
  const { phone: authPhone, name: authName, address: authAddress, isLoggedIn, updateProfile, setGuestProfile } = useCustomerAuthStore();

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
  const [profileNameDraft, setProfileNameDraft] = useState(() => authName || '');
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
    if (authName) setProfileNameDraft(authName);
  }, [authName]);

  useEffect(() => {
    if (!isLoggedIn) {
      try {
        const gName = localStorage.getItem('guest_name');
        const gPhone = localStorage.getItem('guest_phone');
        const gAddr = localStorage.getItem('guest_address');
        setGuestProfile({ name: gName, phone: gPhone, address: gAddr });
      } catch {}
    }
  }, [isLoggedIn, guestName, guestPhone, guestAddress, setGuestProfile]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoggedIn && guestPhone) {
      localStorage.setItem('guest_phone', guestPhone);
    }
  }, [guestPhone, isLoggedIn]);

  const checkoutAddresses: SavedAddress[] = isLoggedIn
    ? addresses
    : guestAddress
      ? [{ id: 'guest', label: guestAddressLabel, address: guestAddress, latitude: guestAddressCoordinates?.latitude ?? null, longitude: guestAddressCoordinates?.longitude ?? null, isDefault: true }]
      : [];

  // Address
  const [showAddressList, setShowAddressList] = useState(false);

  const openAddressSheet = () => setShowAddressList(true);
  const closeAddressSheet = () => setShowAddressList(false);

  const saveProfileNameIfProvided = async () => {
    const normalizedName = profileNameDraft.trim().replace(/\s+/g, ' ');
    // Required for a verified customer who has no name yet — blank is not an option.
    if (isLoggedIn && !authName && (!normalizedName || normalizedName === 'Customer')) {
      setValidationField('name');
      setError('Please enter your name to continue.');
      window.setTimeout(() => profileNameInput.current?.focus(), 50);
      return false;
    }
    if (!normalizedName || normalizedName === 'Customer') return true;
    if (!isValidGuestName(normalizedName)) {
      setValidationField('name');
      setError('Enter a valid name using at least 2 characters.');
      return false;
    }
    try {
      const token = useCustomerAuthStore.getState().token;
      if (token) await authApi.updateProfile({ name: normalizedName }, token);
      else localStorage.setItem('guest_name', normalizedName);
      updateProfile({ name: normalizedName });
      setProfileNameDraft(normalizedName);
      setValidationField(null);
      return true;
    } catch (err: any) {
      setError(err?.response?.data?.error || 'We could not save your name. Please try again.');
      return false;
    }
  };

  // Delivery preference
  const [deliveryPreference, setDeliveryPreference] = useState<typeof PREFERENCES[number]['value']>('within_15');
  const [showPreferences, setShowPreferences] = useState(false);
  const [scheduledSlot, setScheduledSlot] = useState<DeliverySlot | null>(null);
  const [scheduleDay, setScheduleDay] = useState(0);
  const schedule = useMemo(() => buildSchedule(settings.openingHours), [settings.openingHours]);

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
      } else if (appliedCampaign) {
        // The cart changed after a discount was applied. Re-check it against the
        // current subtotal so a coupon can never stay applied below the minimum
        // order the store set when the coupon was created, and so the discount
        // is re-priced for the new total.
        if (appliedCouponCode) {
          try {
            const res = await campaignApi.validateCode(appliedCouponCode, cartSubtotal, storeId);
            if (cancelled) return;
            const campaign = res.data.data.campaign;
            const disc = calcDiscount(campaign, cartSubtotal);
            if (disc !== campaignDiscount || campaign.id !== appliedCampaign.id) {
              setLocalAppliedCampaign(campaign);
              setCampaignDiscount(disc);
              useCartStore.getState().setAppliedCampaign(campaign, disc);
            }
          } catch (e: any) {
            if (cancelled) return;
            removeCampaign();
            const message = e?.response?.data?.error || 'Your cart changed, so the coupon was removed.';
            const minimumMatch = message.match(/Minimum order ₹([\d.]+) required/);
            setOfferNotice(minimumMatch
              ? `Add ₹${Math.max(0, Number(minimumMatch[1]) - cartSubtotal).toFixed(0)} more to unlock this offer (minimum order ₹${minimumMatch[1]}).`
              : message);
          }
        } else {
          const disc = calcDiscount(appliedCampaign, cartSubtotal);
          if (disc !== campaignDiscount) {
            setCampaignDiscount(disc);
            useCartStore.getState().setAppliedCampaign(appliedCampaign, disc);
          }
        }
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
    setCouponLoading(true); setCouponError(''); setCouponSuccess(''); setOfferNotice('');
    try {
      const res = await campaignApi.validateCode(code, sub, storeId);
      const { campaign } = res.data.data;
      applyCampaign(campaign, code);
      setCouponSuccess(campaign.allow_redemption_until_used
        ? `${campaign.coupon_code || 'Welcome offer'} applied. This is your one welcome-offer redemption.`
        : 'Coupon applied');
    } catch (e: any) {
      const message = e?.response?.data?.error || 'Invalid coupon';
      const minimumMatch = message.match(/Minimum order ₹([\d.]+) required/);
      setCouponSuccess('');
      if (minimumMatch) {
        const minimumOrder = Number(minimumMatch[1]);
        setOfferNotice(`Add ₹${Math.max(0, minimumOrder - sub).toFixed(0)} more to unlock this offer (minimum order ₹${minimumOrder}).`);
      } else {
        setCouponError(message);
      }
    } finally { setCouponLoading(false); }
  };

  const validateCoupon = () => applyCode(couponInput);

  const deliveryCharge = parseFloat(settings.delivery_charge || '0');
  const freeAbove = parseFloat(settings.free_delivery_above || '0');
  const minOrder = parseFloat(settings.min_order_amount || '0');
  const sub = subtotal();
  const campaignMeetsMinimum = !appliedCampaign || Number(appliedCampaign.min_order_amount || 0) <= sub;
  const displayedCampaignDiscount = appliedCampaign && campaignMeetsMinimum
    ? calcDiscount(appliedCampaign, sub)
    : 0;
  const actualDelivery = appliedCampaign?.discount_type === 'free_delivery' && campaignMeetsMinimum
    ? 0
    : (freeAbove > 0 && sub >= freeAbove ? 0 : deliveryCharge);
  const total = Math.max(0, sub + actualDelivery - displayedCampaignDiscount);
  const canCheckout = sub >= minOrder && items.length > 0;

  const resolvedAddress = deliveryAddress;
  // A verified customer with no saved name must supply one (captured in the
  // address sheet, just above "Flat / House No.") before they can order.
  const requiresName = isLoggedIn && !authName;
  const nameComplete = isLoggedIn ? (Boolean(authName) || isValidGuestName(profileNameDraft)) : isValidGuestName(guestName);
  const checkoutName = isLoggedIn ? (authName || profileNameDraft.trim() || 'Customer') : guestName;
  const checkoutPhone = isLoggedIn ? (authPhone || guestPhone) : guestPhone;
  const incompleteCheckoutDetails = [
    !nameComplete && 'name',
    !isValidIndianMobile(checkoutPhone) && 'mobile number',
    !isValidDeliveryAddress(resolvedAddress) && 'delivery address',
  ].filter(Boolean) as string[];
  const selectedAddress = addresses.find(a => a.address === deliveryAddress);
  const selectedLabel = selectedAddress?.label ?? (guestAddress ? guestAddressLabel : 'Address');
  // The account page and checkout share one address control. Checkout may not
  // have a SavedAddress to hand over (a guest, or a profile address outside the
  // book), so present whatever is in use as one.
  const checkoutAddress: SavedAddress | null = deliveryAddress
    ? {
        id: selectedAddress?.id ?? 'current',
        label: selectedLabel,
        address: deliveryAddress,
        latitude: selectedAddress?.latitude ?? guestAddressCoordinates?.latitude ?? null,
        longitude: selectedAddress?.longitude ?? guestAddressCoordinates?.longitude ?? null,
        isDefault: Boolean(selectedAddress?.isDefault),
      }
    : null;
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
    // A coupon is authoritative only after its validation request completes.
    // Do not let a quick tap submit the order before its discount reaches state.
    if (couponLoading) return;
    let name = checkoutName;
    const phone = checkoutPhone;
    if (!nameComplete) {
      setError('');
      setShowMissingDetails(true);
      setValidationField('name');
      if (isLoggedIn) {
        openAddressSheet();
        window.setTimeout(() => profileNameInput.current?.focus(), 50);
      } else {
        guestNameInput.current?.focus();
      }
      return;
    }
    if (isLoggedIn && requiresName) {
      if (!(await saveProfileNameIfProvided())) return;
      name = profileNameDraft.trim();
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
      openAddressSheet();
      return;
    }
    if (!canCheckout) return;
    const orderAddress = resolvedAddress!.trim();
    track('checkout_address_completed', { itemCount: items.length });
    track('checkout_reviewed', { itemCount: items.length, subtotal: sub });
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
        scheduledFor: deliveryPreference === 'scheduled' && scheduledSlot ? scheduledSlot.at.toISOString() : undefined,
        deliveryNote: showCustomNote ? (customNote.trim() || 'Ring the bell') : deliveryNote,
        campaignId: appliedCouponCode ? undefined : appliedCampaign?.id || undefined,
        couponCode: appliedCouponCode || undefined,
        // Without this the server has no way to tie the order back to the cart
        // that produced it, and the funnel reports every checkout as abandoned.
        funnelSessionId: getFunnelSessionId(),
      }, orderRequestKey.current);
      const confirmedCampaignDiscount = Number(res.data.data.campaignDiscount) || 0;
      track('order_placed', { orderNumber: res.data.data.orderNumber, itemCount: items.length, value: res.data.data.total });
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
        scheduledLabel: deliveryPreference === 'scheduled' && scheduledSlot ? slotLabel(schedule, scheduledSlot) : undefined,
      };
      clearCart();
      onSuccess(res.data.data.orderNumber, deliveryPreference, res.data.data.storeName, confirmedCampaignDiscount || undefined, orderData);
    } catch (err: any) {
      const responseStatus = err?.response?.status;
      const responseError = err?.response?.data?.error;
      if (!err?.response || responseStatus >= 500) {
        console.error('[checkout] order placement failed', err);
      } else {
        console.info('[checkout] order rejected', { status: responseStatus, error: responseError });
      }
      if (!err?.response) {
        setError('We could not connect right now. Check your internet connection and try again.');
      } else if (err.response.status >= 500) {
        setError('We could not place your order right now. Your cart is still saved. Please try again shortly.');
      } else {
        if (responseError === 'This combo is no longer available') {
          try {
            const liveCatalog = await storeApi.getProducts(undefined, storeId);
            const liveProductIds = new Set((liveCatalog.data.data || []).map(product => product.id));
            const staleItems = items.filter(item => !liveProductIds.has(item.productId));
            if (staleItems.length > 0) {
              staleItems.forEach(item => removeItem(item.productId, item.unit));
              const labels = staleItems.map(item => item.productName).join(', ');
              setError(`${labels} is no longer available and was removed from your cart.`);
              return;
            }
          } catch {}
        }
        setError(responseError || 'We could not place your order. Please review your details and try again.');
      }
    } finally { setLoading(false); }
  };

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden';

  // Captured in the address sheet for a signed-in customer with no name yet.
  // Rendered just above "Flat / House No." (via AddressForm's nameSlot).
  const profileNameField = requiresName ? (
    <div>
      <label htmlFor="address-sheet-name" className="mb-1 block text-xs font-bold text-gray-800 dark:text-slate-200">
        Your name <span className="font-bold text-red-500" aria-hidden="true">*</span>
      </label>
      <input
        id="address-sheet-name"
        ref={profileNameInput}
        type="text"
        value={profileNameDraft}
        onChange={event => {
          setProfileNameDraft(event.target.value);
          setError('');
          if (validationField === 'name') setValidationField(null);
        }}
        placeholder="Your full name"
        autoComplete="name"
        required
        aria-required="true"
        aria-invalid={validationField === 'name'}
        aria-describedby={validationField === 'name' ? 'address-sheet-name-error' : undefined}
        className={`${inp} h-10 px-3 py-2 ${validationField === 'name' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`}
      />
      {validationField === 'name' && <p id="address-sheet-name-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">Please enter your name to continue.</p>}
    </div>
  ) : null;

  // Reachable from the Orders "Track My Orders" login and the account page, so
  // an empty basket is a real entry state. Without this the page renders a
  // permanently disabled Place Order button and no explanation.
  if (items.length === 0) {
    return (
      <div className="page-shell bg-gray-50 dark:bg-slate-900 flex flex-col">
        <div className="sticky top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-[#218044] to-[#2e8b57] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] min-h-[calc(64px_+_env(safe-area-inset-top))] dark:from-[#18191a] dark:to-[#18191a]">
          <button type="button" onClick={onBack} aria-label="Back to shopping"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
          </button>
          <h1 className="min-w-0 truncate text-base font-bold text-white">Checkout</h1>
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
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-[#218044] to-[#2e8b57] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] min-h-[calc(64px_+_env(safe-area-inset-top))] dark:from-[#18191a] dark:to-[#18191a]">
        <button type="button" onClick={onBack} aria-label="Back to shopping" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
        </button>
        <h1 className="min-w-0 truncate text-base font-bold text-white">My Cart</h1>
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
                      {item.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />}
                    </button>
                    <span className="text-sm font-bold text-gray-900 dark:text-white w-5 text-center">{item.quantity}</span>
                    <button type="button" onClick={() => updateQty(item.productId, item.unit, item.quantity + 1)}
                      className="w-7 h-7 bg-emerald-500 text-white rounded-lg flex items-center justify-center">
                      <Plus className="w-3.5 h-3.5" strokeWidth={3.5} />
                    </button>
                  </div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white w-12 text-right flex-shrink-0">
                    ₹{(item.price * item.quantity).toFixed(0)}
                  </p>
                </div>
              ))}
            </div>
            {/* Free delivery nudge */}
            {canCheckout && freeAbove > 0 && actualDelivery > 0 && (
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
              <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
                {visibleSuggestions.map(product => (
                  <div key={product.id} className="w-32 shrink-0 snap-start">
                    <ProductCard product={product} />
                  </div>
                ))}
                <div className="flex w-32 shrink-0 snap-start">
                  <button type="button" onClick={onHome}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40">
                    <ChevronRight className="h-6 w-6" />
                    <span className="text-sm font-bold">View all</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Address sheet (shared with the account page) */}
          {showAddressList && (
            <AddressSheet
              mode="select"
              addresses={checkoutAddresses}
              selectedAddress={deliveryAddress}
              onClose={closeAddressSheet}
              initialEditingId={checkoutAddresses.length === 0 ? 'new' : null}
              nameSlot={profileNameField}
              requiresName={requiresName}
              focusFirstField={validationField === 'address'}
              onSelectAddress={async (address) => {
                if (!(await saveProfileNameIfProvided())) return false;
                setDefaultAddress(address.id);
                setValidationField(null);
                return true;
              }}
              onAddAddress={async (label, address, coordinates) => {
                if (!(await saveProfileNameIfProvided())) return false;
                if (isLoggedIn) {
                  await addAddress({ label, address, isDefault: addresses.length === 0, ...coordinates });
                } else {
                  // Guests have no server address book yet; hold the address
                  // for this checkout and let the order land it in the book
                  // server-side.
                  setGuestAddress(address);
                  setGuestAddressLabel(label.trim() || 'Home');
                  setGuestAddressCoordinates(coordinates);
                }
                setValidationField(null);
                return true;
              }}
              onUpdateAddress={async (id, label, address, coordinates) => {
                if (!(await saveProfileNameIfProvided())) return false;
                if (isLoggedIn) {
                  await updateAddress(id, label, address, coordinates?.latitude ?? null, coordinates?.longitude ?? null);
                } else {
                  setGuestAddress(address);
                  setGuestAddressLabel(label.trim() || 'Home');
                  setGuestAddressCoordinates(coordinates);
                }
                setValidationField(null);
                return true;
              }}
            />
          )}

          {/* ── Who's ordering (guests only — logged-in customers are known) ── */}
          {!isLoggedIn && (
          <div className={card}>
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
          </div>
          )}

          {/* ── Offers / Coupons ── */}
          <OffersPanel
            cardClass={card}
            campaigns={eligibleCampaigns}
            applied={appliedCampaign}
            appliedCode={appliedCouponCode}
            notice={offerNotice}
            locked={!isLoggedIn}
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
            {/* Fastest is the default and is deliberately not offered as a choice.
                A customer who does not need it taps "Schedule Delivery" to book a
                later window. */}
            <button type="button"
              onClick={() => {
                setShowNotes(false);
                if (showPreferences) { setShowPreferences(false); return; }
                setDeliveryPreference('scheduled');
                setShowPreferences(true);
                if (scheduledSlot) {
                  setScheduleDay(scheduledSlot.offset);
                } else {
                  const first = schedule.find(d => d.slots.length > 0);
                  if (first) { setScheduleDay(first.offset); setScheduledSlot(first.slots[0]); }
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Delivery Time</p>
                <p className="text-sm text-gray-900 dark:text-white font-medium">
                  {deliveryPreference === 'scheduled' && scheduledSlot
                    ? <>{slotLabel(schedule, scheduledSlot)}</>
                    : <>Delivery in 10-15 mins</>}
                </p>
              </div>
              <span className="flex items-center flex-shrink-0 bg-gray-900 dark:bg-slate-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg">
                {showPreferences ? 'Done' : deliveryPreference === 'scheduled' ? 'Change' : 'Schedule Delivery'}
              </span>
            </button>
            {showPreferences && (
              <div className="border-t border-gray-100 dark:border-slate-700 p-3 space-y-2.5">
                <div className="space-y-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/20 p-2.5">
                  <div className="flex gap-2 overflow-x-auto">
                    {schedule.map(d => {
                      const active = scheduleDay === d.offset;
                      return (
                        <button key={d.offset} type="button" disabled={d.slots.length === 0}
                          onClick={() => setScheduleDay(d.offset)}
                          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold whitespace-nowrap border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            active ? 'border-emerald-500 bg-white text-emerald-700 dark:bg-slate-800 dark:text-emerald-400'
                                   : 'border-transparent bg-white/70 text-gray-600 dark:bg-slate-800/60 dark:text-slate-300'}`}>
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const day = schedule.find(d => d.offset === scheduleDay);
                    if (!day || day.slots.length === 0) {
                      return <p className="text-xs text-violet-700 dark:text-violet-300 text-center font-medium py-2">No delivery slots left for this day</p>;
                    }
                    return (
                      <div className="grid grid-cols-2 gap-2">
                        {day.slots.map(s => {
                          const active = scheduledSlot?.offset === s.offset && scheduledSlot?.start === s.start;
                          return (
                            <button key={`${s.offset}-${s.start}`} type="button"
                              onClick={() => { setScheduledSlot(s); setScheduleDay(s.offset); }}
                              className={`py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                                active ? 'border-emerald-500 bg-white text-emerald-700 dark:bg-slate-800 dark:text-emerald-400'
                                       : 'border-transparent bg-white/70 text-gray-700 dark:bg-slate-800/60 dark:text-slate-200'}`}>
                              {slotRange(s)}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {scheduledSlot && (
                    <p className="text-[10px] text-violet-700 dark:text-violet-300 text-center font-medium">
                      {slotLabel(schedule, scheduledSlot)}
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => { setDeliveryPreference('within_15'); setShowPreferences(false); setScheduledSlot(null); }}
                  className="w-full text-center text-[11px] font-semibold text-gray-500 hover:text-emerald-600 py-1">
                  Deliver as soon as possible
                </button>
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
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Delivery instruction</p>
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
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Delivery instruction</p>
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
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                {billExpanded ? 'Hide' : 'View'} details
                <ChevronUp className={`h-3.5 w-3.5 transition-transform ${billExpanded ? '' : 'rotate-180'}`} />
              </span>
            </button>
            {billExpanded && (
              <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">Items</p>
                {items.map((item, index) => (
                  <div key={`${item.productId}-${item.unit}`} className={`flex items-start justify-between gap-3 py-2.5 ${index > 0 ? 'border-t border-gray-100 dark:border-slate-700/70' : ''}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800 dark:text-slate-100">{item.productName}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">{item.unit} · ₹{item.price} × {item.quantity}</p>
                    </div>
                    <span className="shrink-0 pt-0.5 text-sm font-semibold text-gray-900 dark:text-white">₹{(item.price * item.quantity).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className={`px-4 py-3 space-y-2 ${billExpanded ? 'border-t border-gray-100 dark:border-slate-700' : ''}`}>
              {billExpanded && <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">Charges</p>}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">Subtotal</span>
                <span className="font-medium text-gray-900 dark:text-white">₹{sub.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">Delivery charge</span>
                <span className={actualDelivery === 0 ? 'text-emerald-600 font-semibold' : 'text-gray-900 dark:text-white'}>
                  {actualDelivery === 0 ? 'FREE' : `₹${actualDelivery}`}
                </span>
              </div>
              {displayedCampaignDiscount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-600">🎉 {appliedCampaign?.title || 'Discount'}</span>
                  <span className="text-emerald-600 font-semibold">-₹{displayedCampaignDiscount.toFixed(0)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-100 pt-2.5 dark:border-slate-700">
                <span className="text-sm font-bold text-gray-900 dark:text-white">Total</span>
                <span className="text-base font-extrabold text-gray-900 dark:text-white">₹{total.toFixed(0)}</span>
              </div>
            </div>
          </div>

        </div>
      </form>

      {/* ── Sticky address + Place Order footer ── */}
      <div className="sticky bottom-0 z-30 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
        <div className="max-w-lg mx-auto">
          {/* Address row — the same control as the account page, opens the sheet */}
          <div className="px-3 pt-2.5">
            <AddressButton
              address={checkoutAddress}
              error={validationField === 'address'}
              emptyLabel="Add a complete delivery address"
              onClick={() => { track('checkout_address_started'); openAddressSheet(); }}
            />
          </div>

          <div className="px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            {!canCheckout && sub < minOrder && (
              <p className="text-xs text-gray-500 dark:text-slate-400 text-center mb-2">Add ₹{(minOrder - sub).toFixed(0)} more to reach the ₹{minOrder} minimum order.</p>
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
              <button type="submit" form="checkout-form" disabled={loading || couponLoading}
                className="flex-1 h-14 bg-[#15803d] hover:bg-[#166534] text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm flex flex-col items-center justify-center leading-tight dark:bg-[#15803d] dark:text-white dark:hover:bg-[#166534]">
                {loading || couponLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-[11px] font-medium leading-4 text-white/80">{couponLoading ? 'Checking offer' : 'Placing order'}</span>
                  </>
                ) : (
                  <>
                    <span className="text-lg font-extrabold leading-5">Place order</span>
                    <span className="text-[11px] font-normal leading-4 text-white/80 dark:text-white/80">Pay Cash / UPI On Delivery</span>
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

import { useState, useEffect, useRef, useMemo } from 'react';
import { useFinePointer } from '../utils/useFinePointer';
import { Loader2, Plus, Minus, Trash2, X, Tag, Check, MessageCircle, ChevronRight, Clock, User, ShoppingBag } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { storeApi, campaignApi, authApi } from '../services/api';
import type { PublicSettings, Product, StoreOpeningHours } from '../services/api';
import { useCustomerStore, type SavedAddress } from '../store/customerStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { type AddressCoordinates } from '../components/AddressForm';
import AddressSheet from '../components/AddressSheet';
import AddressButton from '../components/AddressButton';
import PageHeader from '../components/PageHeader';
import ProductCard from '../components/ProductCard';
import SmartImage from '../components/SmartImage';
import ConfirmDialog from '../components/ConfirmDialog';
import { getFunnelSessionId, syncFunnelCart, track, trackOnce } from '../utils/track';
import { requestErrorMessage, isTransportFailure } from '../utils/networkError';
import { isIOSDevice } from '../utils/isIOSDevice';
import { useGuestAddressStore } from '../store/guestAddressStore';

interface CheckoutPageProps {
  settings: PublicSettings;
  zoneName?: string;
  storeId?: string;
  /**
   * The storefront catalogue App has already loaded. Seeding "You may also like"
   * from it means the row is present in the very first paint instead of popping
   * in (and shoving the address + footer down) after a private fetch resolves.
   */
  catalog?: Product[];
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

const inp = 'w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gokez-500/20 focus:border-gokez-500 focus:bg-white dark:focus:bg-slate-600 transition-all';

const PREFERENCES = [
  { value: 'within_15', label: '⚡ 10-15 mins', sub: 'Fastest' },
  { value: 'scheduled', label: '📅 Schedule',  sub: 'Pick a slot' },
] as const;

/* Delivery preferences are generated in IST from the store's published hours.
  They are non-exclusive 30-minute windows for today or tomorrow only. */
const IST_OFFSET_MIN = 330; // Asia/Kolkata, fixed +05:30
const SLOT_MINUTES = 30;
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
      for (let s = open; s + SLOT_MINUTES <= close; s += SLOT_MINUTES) {
        const at = istInstant(offset, s);
        if (at.getTime() <= nowMs + SLOT_LEAD_MINUTES * 60000) continue;
        slots.push({ offset, start: s, end: s + SLOT_MINUTES, at });
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

/* "name", "name and mobile number", "name, mobile number and address" — reads
   as one sentence so the checkout can name everything that is still missing. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

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
  if (Number(c.min_order_amount) > 0) bits.push(`Min order \u20b9${money(c.min_order_amount)} to avail`);
  if (c.discount_type === 'percent' && Number(c.max_discount) > 0) bits.push(`up to \u20b9${money(c.max_discount)} off`);
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
  const showOffersHeader = campaigns.length > 0 || locked || Boolean(notice);

  return (
    <div className={cardClass}>
      <div className="px-3 py-2.5">
        {showOffersHeader && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Tag className="w-4 h-4 text-gokez-500 dark:text-gokez-400 flex-shrink-0" />
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">Offers &amp; coupons</span>
              </div>
            </div>
          </div>
        )}

        {campaigns.length > 0 && (
          <div className="mt-2 space-y-1.5">
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
              const badgeText = c.badge_text && !/^new customer$/i.test(c.badge_text.trim()) ? c.badge_text : null;
              return (
                <div key={c.id}
                  className={`rounded-xl border px-2.5 py-2 transition-colors ${
                    done ? 'border-gokez-400 bg-gokez-50 dark:border-gokez-700 dark:bg-slate-900/60'
                         : 'border-gokez-200 bg-gokez-50 dark:border-gokez-800 dark:bg-slate-900/60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-[11px] sm:text-xs leading-snug font-bold break-words ${done ? 'text-gokez-700 dark:text-gokez-200' : 'text-gokez-700 dark:text-gokez-200'}`}>
                        {badgeText && (
                          <span className="mr-1 inline-block rounded bg-gokez-100 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide text-gokez-800 dark:bg-gokez-900/40 dark:text-gokez-200">
                            {badgeText}
                          </span>
                        )}
                        {c.title}
                        {bits.length > 0 && (
                          <span className="text-[10px] font-medium text-gray-500 dark:text-slate-400"> · {bits.join(' · ')}</span>
                        )}
                      </p>
                      <p className={`text-[10px] sm:text-[11px] leading-snug mt-0.5 break-words ${done ? 'text-gokez-700 dark:text-gokez-300' : 'text-gokez-700 dark:text-gokez-300'}`}>
                        {desc.replace(/[.!?]+$/, '')}.
                        {c.coupon_code && <span className="font-semibold"> Code: {c.coupon_code}</span>}
                      </p>
                      {welcomeMessage && <p className="mt-0.5 text-[10px] font-semibold leading-snug text-gokez-700 dark:text-gokez-200">{welcomeMessage}</p>}
                    </div>
                    {/* Explicit Apply. The old signed-in list applied the moment the
                        radio was touched, which read as the app grabbing a discount
                        the customer had not chosen. */}
                    <button
                      type="button"
                      onClick={() => done ? (isAppliedByCode ? onClearCode() : onRemoveOffer()) : onApply(c)}
                      className={`flex min-h-11 flex-shrink-0 items-center px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors ${
                        done ? 'text-gokez-700 hover:text-red-600 dark:text-gokez-200'
                             : 'bg-gokez-700 hover:bg-gokez-800 text-white'}`}>
                      {done ? 'Remove' : 'Apply'}
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
                className="w-full py-2.5 text-xs font-bold text-gokez-700 dark:text-gokez-200 bg-gokez-50 dark:bg-slate-900/60 hover:bg-gokez-100 dark:hover:bg-slate-900/80 rounded-xl transition-colors">
                Log in for offers →
              </button>
            )}
          </div>
        )}

        {/* Signed-in only. /campaigns/validate requires auth, so a guest typing
            here gets a bare "No token provided". Guests apply the campaign code
            with Apply & Save, and the code is printed in the offer details. */}
        {!locked && !hasMinimumOrderNotice && (
        <div className={showOffersHeader ? 'mt-3 border-t border-gray-100 pt-3 dark:border-slate-700' : ''}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300">Have a coupon code?</label>
            {appliedCode && <span className="text-[10px] font-bold text-gokez-700 dark:text-gokez-300">Applied</span>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={appliedCode || codeInput} onChange={e => onCodeInput(e.target.value)} placeholder="Enter coupon code" disabled={Boolean(appliedCode)}
              className="flex-1 min-w-0 px-3 py-2 text-xs border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-gokez-500 disabled:cursor-not-allowed disabled:border-gokez-200 disabled:bg-gokez-50 disabled:text-gokez-700 dark:disabled:border-gokez-800 dark:disabled:bg-slate-900/60 dark:disabled:text-gokez-200" />
            <button type="button" onClick={appliedCode ? onClearCode : onValidateCode} disabled={!appliedCode && (codeLoading || !codeInput.trim())}
              className={`px-3 py-2 text-xs font-bold rounded-xl disabled:opacity-50 flex items-center gap-1 whitespace-nowrap ${appliedCode ? 'text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-300 dark:bg-red-900/20 dark:hover:bg-red-900/30' : 'text-white bg-gokez-700 hover:bg-gokez-800'}`}>
              {appliedCode ? <X className="w-3 h-3" /> : codeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {appliedCode ? 'Remove' : 'Apply'}
            </button>
          </div>
          {codeSuccess && <p className="mt-1.5 text-xs text-gokez-700 dark:text-gokez-300">{codeSuccess}</p>}
          {codeError && <p className="mt-1.5 text-xs text-red-500">{codeError}</p>}
        </div>
        )}
      </div>
    </div>
  );
}

export default function CheckoutPage({ settings, zoneName, storeId, catalog, onBack, onHome, onSuccess, confirmOrder, onLogin }: CheckoutPageProps) {
  const finePointer = useFinePointer();
  const orderRequestKey = useRef(crypto.randomUUID());
  const guestNameInput = useRef<HTMLInputElement>(null);
  const guestPhoneInput = useRef<HTMLInputElement>(null);
  const profileNameInput = useRef<HTMLInputElement>(null);
  // Armed by the missing-details dialog when it sends a customer off to fill in
  // their name and mobile. It lets the address step follow automatically, so the
  // sheet only ever opens on its own as a continuation of that dialog.
  const awaitingAddress = useRef(false);
  const { items, updateQty, removeItem, subtotal, clearCart, itemSavings } = useCartStore();
  const { phone: savedPhone, name: savedName, addresses, loadAddresses, getDefaultAddress, setDefaultAddress, addAddress, updateAddress } = useCustomerStore();
  const { phone: authPhone, name: authName, address: authAddress, isLoggedIn, updateProfile, setGuestProfile } = useCustomerAuthStore();

  useEffect(() => { if (isLoggedIn) loadAddresses(); }, [isLoggedIn]);

  // "You may also like" — picked once when checkout opens and then held steady,
  // so adding one of them to the cart never makes the row shuffle under the
  // customer's thumb. Seeded synchronously from the catalogue App already has, so
  // the row is part of the first paint and never appears late.
  const [suggestions, setSuggestions] = useState<Product[]>(() => {
    const cartIds = new Set(items.map(i => i.productId));
    return (catalog || []).filter(p =>
      p.availabilityStatus === 'available'
      && p.isAvailable
      && Boolean(p.categoryId && p.categoryName)
      && !cartIds.has(p.id)
    ).slice(0, 8);
  });

  // Fallback for the one case the storefront catalogue can't cover — landing on
  // checkout without it (a shared/deep link). Fetched once; the seeded list above
  // is left untouched otherwise.
  useEffect(() => {
    if (catalog && catalog.length > 0) return;
    if (!storeId) return;
    let cancelled = false;
    storeApi.getProducts(undefined, storeId).then(r => {
      if (cancelled) return;
      const cartIds = new Set(useCartStore.getState().items.map(i => i.productId));
      setSuggestions((r.data.data || []).filter(p =>
        p.availabilityStatus === 'available'
        && p.isAvailable
        && Boolean(p.categoryId && p.categoryName)
        && !cartIds.has(p.id)
      ).slice(0, 8));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [storeId, catalog]);

  const visibleSuggestions = suggestions.filter(product =>
    product.availabilityStatus === 'available'
    && product.isAvailable
    && Boolean(product.categoryId && product.categoryName)
  );

  const defaultAddr = getDefaultAddress();

  // A guest supplies their delivery address inline (the address book is behind
  // login). It rides inside the order and the server files it into the same
  // address book when the order lands, so a later login with the same phone
  // finds it again. The full address (label + coordinates) is kept in
  // localStorage so a reload does not silently degrade it to a bare string.
  // The guest's one delivery address lives in a single reactive store (backed
  // by localStorage) shared with the account page, so a save reflects on the
  // checkout footer instantly instead of waiting for the next launch.
  const storedGuestAddress = useGuestAddressStore(s => s.address);
  const setStoredGuestAddress = useGuestAddressStore(s => s.setAddress);
  const guestAddress = storedGuestAddress?.address ?? '';
  const guestAddressLabel = storedGuestAddress?.label ?? 'Home';
  const guestAddressCoordinates: AddressCoordinates | null =
    storedGuestAddress?.latitude != null && storedGuestAddress?.longitude != null
      ? { latitude: storedGuestAddress.latitude, longitude: storedGuestAddress.longitude }
      : null;

  // Logged-in shoppers order to their saved book; a guest orders only to the
  // address they typed, never to a stale book entry left behind by a login.
  const deliveryAddress = isLoggedIn
    ? (defaultAddr?.address || authAddress || null)
    : (guestAddress || null);

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
        setGuestProfile({ name: gName, phone: gPhone, address: guestAddress || null });
      } catch {}
    }
  }, [isLoggedIn, guestName, guestPhone, guestAddress, setGuestProfile]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoggedIn && guestPhone) {
      localStorage.setItem('guest_phone', guestPhone);
    }
  }, [guestPhone, isLoggedIn]);

  // Persists a guest's address to the shared store (instant UI + localStorage)
  // and pushes it to the server so the hub reflects the change without waiting
  // for the next order. Fire-and-forget: the client copy still drives this
  // checkout if the network call fails.
  const commitGuestAddress = (label: string, address: string, coordinates: AddressCoordinates | null) => {
    const normalizedLabel = label.trim() || 'Home';
    setStoredGuestAddress(normalizedLabel, address, coordinates);
    const phone = guestPhone.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(phone) || address.trim().length < 10) return;
    void storeApi.saveGuestDetails({
      phone,
      name: guestName,
      address,
      label: normalizedLabel,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    }).catch(() => {});
  };

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
      setError(requestErrorMessage(err, 'We could not save your name. Please try again.'));
      return false;
    }
  };

  // Delivery preference
  const [deliveryPreference, setDeliveryPreference] = useState<typeof PREFERENCES[number]['value']>('within_15');
  const [showPreferences, setShowPreferences] = useState(false);
  const [scheduledSlot, setScheduledSlot] = useState<DeliverySlot | null>(null);
  const [scheduleDay, setScheduleDay] = useState(0);
  const [schedulePeriod, setSchedulePeriod] = useState<'all' | 'am' | 'pm'>('all');
  const schedule = useMemo(() => buildSchedule(settings.openingHours), [settings.openingHours]);
  const availableScheduleDays = useMemo(() => schedule.filter(day => day.slots.length > 0), [schedule]);
  const selectedSchedule = availableScheduleDays.find(day => day.offset === scheduleDay) ?? availableScheduleDays[0];
  const visibleScheduleSlots = (selectedSchedule?.slots ?? []).filter(slot => (
    schedulePeriod === 'all'
    || (schedulePeriod === 'am' ? slot.start < 12 * 60 : slot.start >= 12 * 60)
  ));

  // Delivery note
  const [deliveryNote, setDeliveryNote] = useState('Ring the bell');
  const [showNoteMenu, setShowNoteMenu] = useState(false);
  const [showCustomNote, setShowCustomNote] = useState(false);
  const [customNote, setCustomNote] = useState('');


  const [loading, setLoading] = useState(false);
  // The "To pay" figure frozen at the moment Place order was tapped, shown while
  // the request is in flight so the number the customer committed to cannot move.
  const [submittedTotal, setSubmittedTotal] = useState<number | null>(null);
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
            if (isTransportFailure(e)) {
              // Couldn't reach the server — the coupon may still be perfectly
              // valid. Removing it over a network blip would silently drop the
              // customer's discount, and blaming "your cart changed" would lie.
              setOfferNotice('Couldn\u2019t re-check your coupon right now. It stays applied for now.');
              return;
            }
            removeCampaign();
            const message = e?.response?.data?.error || 'Your cart changed, so the coupon was removed.';
            const minimumMatch = message.match(/minimum order ₹([\d.]+)/i);
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
          setOfferNotice(requestErrorMessage(e, 'This offer could not be applied.'));
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
      const message = requestErrorMessage(e, 'Invalid coupon');
      const minimumMatch = message.match(/minimum order ₹([\d.]+)/i);
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
  // Derived straight off the live cart items, so the "To pay" figure recomputes
  // on every +/- and every "You may also like" tap — no chance of a stale total.
  const sub = useMemo(() => items.reduce((s2, i) => s2 + i.price * i.quantity, 0), [items]);
  const campaignMeetsMinimum = !appliedCampaign || Number(appliedCampaign.min_order_amount || 0) <= sub;
  const displayedCampaignDiscount = appliedCampaign && campaignMeetsMinimum
    ? calcDiscount(appliedCampaign, sub)
    : 0;
  const actualDelivery = appliedCampaign?.discount_type === 'free_delivery' && campaignMeetsMinimum
    ? 0
    : (freeAbove > 0 && sub >= freeAbove ? 0 : deliveryCharge);
  const total = Math.max(0, sub + actualDelivery - displayedCampaignDiscount);
  const payAmount = loading && submittedTotal != null ? submittedTotal : total;
  const canCheckout = sub >= minOrder && items.length > 0;

  // Total the customer is saving on this order: item-level price cuts (MRP vs
  // sale price) + the delivery fee waived for crossing the free-delivery
  // threshold + any applied coupon. Recomputed off the live cart so it tracks
  // every +/- and coupon change.
  const itemLevelSavings = itemSavings();
  const freeDeliverySaving = actualDelivery === 0 && deliveryCharge > 0 ? deliveryCharge : 0;
  const totalSavings = itemLevelSavings + freeDeliverySaving + displayedCampaignDiscount;

  // Free-delivery progress (0-1). Only meaningful when a threshold is set,
  // there is a fee to unlock, and delivery is still chargeable for this cart.
  const freeDeliveryUnlocked = freeAbove > 0 && deliveryCharge > 0 && actualDelivery === 0;
  const freeDeliveryRemaining = freeAbove > 0 ? Math.max(0, freeAbove - sub) : 0;
  const freeDeliveryProgress = freeAbove > 0 ? Math.min(1, sub / freeAbove) : 0;
  // The store is not charging delivery at all (hub set no fee). Distinct from a
  // fee that was waived by crossing a threshold: there is nothing to "unlock",
  // delivery is simply free, and we say so plainly instead of implying a perk.
  const deliveryIsAlwaysFree = deliveryCharge <= 0;

  const resolvedAddress = deliveryAddress;
  // A verified customer with no saved name must supply one (captured in the
  // address sheet, just above "Flat / House No.") before they can order.
  const requiresName = isLoggedIn && !authName;
  const nameComplete = isLoggedIn ? (Boolean(authName) || isValidGuestName(profileNameDraft)) : isValidGuestName(guestName);
  const checkoutName = isLoggedIn ? (authName || profileNameDraft.trim() || 'Customer') : guestName;
  const checkoutPhone = isLoggedIn ? (authPhone || guestPhone) : guestPhone;
  const phoneComplete = isValidIndianMobile(checkoutPhone);
  const addressComplete = isValidDeliveryAddress(resolvedAddress);
  const incompleteCheckoutDetails = [
    !nameComplete && 'name',
    !phoneComplete && 'mobile number',
    !addressComplete && 'delivery address',
  ].filter(Boolean) as string[];

  // Everything a delivery needs, named in one line, in the order it appears on
  // the page. Null the moment the order is ready to place.
  const missingFirstField: CheckoutValidationField =
    !nameComplete ? 'name'
    : !phoneComplete ? 'phone'
    : !addressComplete ? 'address'
    : null;

  // Name/mobile and address are asked for in separate voices — the first is how
  // we reach the customer, the second is where we take the order — and identity
  // is always checked first, so the dialog only ever asks for one thing at a
  // time instead of one sentence that lists everything at once.
  const missingIdentity = !nameComplete || !phoneComplete;
  const missingDetailsTitle = missingIdentity ? 'Name & mobile number' : 'Delivery address';
  const missingDetailsAction = missingIdentity ? 'Add name & mobile' : 'Add delivery address';
  const missingDetailsMessage = missingIdentity
    ? (addressComplete
        ? 'Please share your name and mobile number. We need them to deliver this order and keep you updated.'
        : 'Please share your name and mobile number, then add a delivery address. We need them to complete this order.')
    : 'Please add a complete delivery address so we know where to deliver this order.';
  // Sends the customer to the top-most missing field, opening the address sheet
  // when that is what is left to fill in.
  const focusFirstMissingField = () => {
    if (!nameComplete) {
      if (isLoggedIn) {
        openAddressSheet();
        window.setTimeout(() => profileNameInput.current?.focus(), 50);
      } else {
        guestNameInput.current?.focus();
      }
      return;
    }
    if (!phoneComplete) { guestPhoneInput.current?.focus(); return; }
    if (!addressComplete) openAddressSheet();
  };

  // Carry the customer straight on to the address once the name and mobile the
  // dialog asked for are in, instead of making them tap Place order a second
  // time just to be told the same thing about the address. Address is the one
  // step that cannot be done inline — it needs the map and the saved-address
  // sheet — so it is worth a hand-off, but never an uninvited one: the flag is
  // only set by that dialog.
  useEffect(() => {
    if (!awaitingAddress.current) return;
    if (!nameComplete || !phoneComplete) return;
    awaitingAddress.current = false;
    if (!addressComplete) openAddressSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameComplete, phoneComplete, addressComplete]);

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
    // Nothing is sent until name, mobile and address are all in. The dialog
    // leads with whichever is missing first on the page — name, then mobile,
    // then address — so the customer is never bounced field by field.
    if (missingFirstField) {
      setError('');
      setValidationField(missingFirstField);
      setShowMissingDetails(true);
      return;
    }
    if (isLoggedIn && requiresName) {
      if (!(await saveProfileNameIfProvided())) return;
      name = profileNameDraft.trim();
    }
    if (!canCheckout) return;
    const orderAddress = resolvedAddress!.trim();
    // Lock the basket the instant Place order is tapped. The items and the "To
    // pay" figure are snapshotted here, so a change while the confirm dialog is
    // open or while the request is in flight can never make the order differ
    // from what the customer saw. The qty/add controls are also disabled while
    // `loading` so the cart cannot move underneath them.
    const lockedItems = items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity }));
    const lockedSubtotal = sub;
    track('checkout_address_completed', { itemCount: lockedItems.length });
    track('checkout_reviewed', { itemCount: lockedItems.length, subtotal: lockedSubtotal });
    // After validation, before the request: a customer with a form problem
    // should be told about that, not asked to confirm a delay they have not
    // reached yet. A valid customer-selected schedule already falls within
    // published store hours, so the closed-store prompt applies only to the
    // immediate Fastest option. Defaulting to "proceed" keeps checkout working
    // if this page is ever rendered without the prop.
    if (deliveryPreference !== 'scheduled' && confirmOrder && !(await confirmOrder())) return;
    setLoading(true); setError(''); setValidationField(null); setShowMissingDetails(false); setSubmittedTotal(total);
    try {
      const res = await storeApi.placeOrder({
        guestName: name, guestPhone: phone.replace(/\D/g, ''),
        guestAddress: orderAddress,
        guestAddressLabel: isLoggedIn ? undefined : guestAddressLabel,
        latitude: selectedAddress?.latitude ?? guestAddressCoordinates?.latitude ?? null,
        longitude: selectedAddress?.longitude ?? guestAddressCoordinates?.longitude ?? null,
        items: lockedItems,
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
      track('order_placed', { orderNumber: res.data.data.orderNumber, itemCount: lockedItems.length, value: res.data.data.total });
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
            // fresh: this runs after the server rejected the order, so the
            // cache may hold the very catalog that caused the rejection.
            const liveCatalog = await storeApi.getProducts(undefined, storeId, { fresh: true });
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
    } finally { setLoading(false); setSubmittedTotal(null); }
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
        <PageHeader title="Checkout" onBack={onBack} backLabel="Back to shopping" backStyle="square" backSize="md" />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="w-16 h-16 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
            <ShoppingBag className="w-7 h-7 text-gray-300" />
          </div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-1">Your cart is empty</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Add a few items to start your order.</p>
          <button type="button" onClick={onHome}
            className="w-full max-w-xs py-3.5 bg-gokez-700 hover:bg-gokez-800 text-white font-bold rounded-2xl transition-all">
            Browse products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <PageHeader title="My Cart" onBack={onBack} backLabel="Back to shopping" backStyle="square" backSize="md" />

      {/* noValidate: the required-field guidance is our own dialog, which knows
          about the whole order, not the browser's per-field bubble. Without it
          the native bubble fires on submit and the dialog never gets a chance.
          The inputs keep required/aria-required for assistive tech. */}
      <form id="checkout-form" onSubmit={handleSubmit} noValidate>
        <div className="max-w-lg mx-auto px-4 py-4 pb-8 space-y-3">

          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-2xl">{error}</div>}

          {/* ── Items ── */}
          <div className={card}>
            <div className="divide-y divide-gray-50 dark:divide-slate-700">
              {items.map(item => (
                <div key={`${item.productId}-${item.unit}`} className="flex items-center gap-3 px-4 py-3">
                  <SmartImage
                    src={item.photoUrl}
                    alt={item.productName}
                    className="w-12 h-12 rounded-xl flex-shrink-0"
                    imgClassName="object-cover"
                    fallback={<div className="w-12 h-12 rounded-xl bg-gokez-50 dark:bg-gokez-900/20 flex items-center justify-center flex-shrink-0 text-xl">🥦</div>}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.productName}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{item.unit} · ₹{item.price}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" onClick={() => updateQty(item.productId, item.unit, item.quantity - 1)} disabled={loading}
                      aria-disabled={loading}
                      className="w-7 h-7 bg-gray-100 dark:bg-slate-700 rounded-lg flex items-center justify-center disabled:opacity-40">
                      {item.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />}
                    </button>
                    <span className="text-sm font-bold text-gray-900 dark:text-white w-5 text-center">{item.quantity}</span>
                    <button type="button" onClick={() => updateQty(item.productId, item.unit, item.quantity + 1)} disabled={loading}
                      aria-disabled={loading}
                      className="w-7 h-7 bg-gokez-700 text-white rounded-lg flex items-center justify-center disabled:opacity-40">
                      <Plus className="w-3.5 h-3.5" strokeWidth={3.5} />
                    </button>
                  </div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white w-12 text-right flex-shrink-0">
                    ₹{(item.price * item.quantity).toFixed(0)}
                  </p>
                </div>
              ))}
            </div>
            {/* Free delivery progress. Shown whenever a threshold exists, even
                below the minimum order, so the nudge is never hidden from a
                shopper who is early in their cart.

                Only when there is a delivery fee to unlock. If the store
                charges nothing, delivery is already free and there is nothing
                to work towards -- the strip would claim "You've unlocked FREE
                delivery!" for a discount that never applied, and contradict
                the "free on every order" line below the total. */}
            {freeAbove > 0 && deliveryCharge > 0 && (
              <div className="px-4 py-2 bg-gokez-50 dark:bg-gokez-900/10 border-t border-gokez-100 dark:border-gokez-900">
                {freeDeliveryUnlocked ? (
                  <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-gokez-700 dark:text-gokez-400">
                    <span aria-hidden="true">🛵</span> You've unlocked FREE delivery!
                  </p>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-gokez-800 dark:text-gokez-300">
                      <span className="flex items-center gap-1">
                        <span aria-hidden="true">🛵</span> Free delivery at ₹{freeAbove.toFixed(0)}
                      </span>
                      <span>₹{freeDeliveryRemaining.toFixed(0)} away</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gokez-100 dark:bg-gokez-900/40" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(freeDeliveryProgress * 100)} aria-label="Progress toward free delivery">
                      <div
                        className="h-full rounded-full bg-gokez-500 transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.max(6, freeDeliveryProgress * 100)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Missed something */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50 dark:border-slate-700">
              <span className="text-sm text-gray-500 dark:text-slate-400">Missed something?</span>
              <button type="button" onClick={onHome} disabled={loading}
                className="flex items-center gap-1.5 bg-gray-900 dark:bg-slate-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg disabled:opacity-40">
                <Plus className="w-3.5 h-3.5" /> Add more items
              </button>
            </div>
          </div>

          {/* ── You may also like ── */}
          {/* Hidden on iOS: WebKit fails to repaint the sticky "To pay" bar after
              an ADD tap here — the cart updates but the painted total stays stale
              until the next touch, so iOS users see a wrong amount. Android and
              desktop are unaffected. Never show a total we can't trust. */}
          {!isIOSDevice() && visibleSuggestions.length > 0 && (
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-2 px-1">You may also like</p>
              {/* No scroll-snap here: iOS Safari swallows taps on buttons inside a
                  snap-mandatory horizontal scroller (the ADD tap never becomes a
                  click, so the cart and "To Pay" silently never update). The home
                  carousels already work without snap on the same devices. */}
              <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
                {visibleSuggestions.map(product => (
                  <div key={product.id} className="w-32 shrink-0">
                    <ProductCard product={product} disabled={loading} />
                  </div>
                ))}
                <div className="flex w-32 shrink-0">
                  <button type="button" onClick={onHome} disabled={loading}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gokez-300 bg-gokez-50 text-gokez-700 transition-colors hover:border-gokez-400 hover:bg-gokez-100 dark:border-gokez-800 dark:bg-gokez-900/20 dark:text-gokez-400 dark:hover:bg-gokez-900/40 disabled:opacity-40">
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
              singleAddress={!isLoggedIn}
              onClose={closeAddressSheet}
              initialEditingId={checkoutAddresses.length === 0 ? 'new' : null}
              nameSlot={profileNameField}
              requiresName={requiresName}
              focusFirstField={validationField === 'address'}
              onSelectAddress={async (address) => {
                if (!(await saveProfileNameIfProvided())) return false;
                if (isLoggedIn) {
                  const ok = await setDefaultAddress(address.id);
                  if (!ok) throw new Error('Could not select this address. Please try again.');
                } else {
                  commitGuestAddress(
                    address.label || 'Home',
                    address.address,
                    address.latitude != null && address.longitude != null
                      ? { latitude: address.latitude, longitude: address.longitude }
                      : null,
                  );
                }
                setValidationField(null);
                return true;
              }}
              onAddAddress={async (label, address, coordinates) => {
                if (!(await saveProfileNameIfProvided())) return false;
                if (isLoggedIn) {
                  const ok = await addAddress({ label, address, isDefault: addresses.length === 0, ...coordinates });
                  if (!ok) throw new Error('Could not save your address. Please check your connection and try again.');
                } else {
                  // Guests have no server address book yet; hold the full address
                  // for this checkout (persisted) and mirror it server-side so the
                  // hub sees the edit before the order lands.
                  commitGuestAddress(label.trim() || 'Home', address, coordinates);
                }
                setValidationField(null);
                return true;
              }}
              onUpdateAddress={async (id, label, address, coordinates) => {
                if (!(await saveProfileNameIfProvided())) return false;
                if (isLoggedIn) {
                  const ok = await updateAddress(id, label, address, coordinates?.latitude ?? null, coordinates?.longitude ?? null);
                  if (!ok) throw new Error('Could not save your address. Please check your connection and try again.');
                } else {
                  commitGuestAddress(label.trim() || 'Home', address, coordinates);
                }
                setValidationField(null);
                return true;
              }}
            />
          )}

          {/* One dialog for whatever a delivery still needs, asked in the order
              it appears on the page: name and mobile first, then address. Place
              order is never sent while it is open. */}
          {showMissingDetails && (
            <ConfirmDialog
              title={missingDetailsTitle}
              message={missingDetailsMessage}
              confirmLabel={missingDetailsAction}
              cancelLabel="Not now"
              danger={false}
              onConfirm={() => {
                setShowMissingDetails(false);
                // If name/mobile is what is being fixed and the address is still
                // missing, the sheet follows as soon as they are filled in.
                awaitingAddress.current = missingIdentity && !addressComplete;
                focusFirstMissingField();
              }}
              onCancel={() => setShowMissingDetails(false)}
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
                  {onLogin && <button type="button" onClick={() => onLogin()} title="Log in to use your saved details" className="shrink-0 rounded-lg border border-gokez-200 bg-gokez-50 px-2.5 py-1.5 text-xs font-semibold text-gokez-700 transition-colors hover:border-gokez-300 hover:bg-gokez-100 dark:border-gokez-900/70 dark:bg-gokez-950/30 dark:text-gokez-300 dark:hover:border-gokez-700 dark:hover:bg-gokez-950/50">Log in</button>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                    Name <span className="text-gokez-700 dark:text-gokez-400" aria-hidden="true">*</span>
                  </label>
                  <input ref={guestNameInput} type="text" value={guestName} onChange={e => { setGuestName(e.target.value); if (validationField === 'name') setValidationField(null); }}
                    onBlur={() => { if (guestName.trim() && !isValidGuestName(guestName)) setValidationField('name'); }}
                    placeholder="Enter your name" autoComplete="name" className={`${inp} h-11 px-3 py-2.5 ${validationField === 'name' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`} required aria-required="true" aria-invalid={validationField === 'name'} aria-describedby={validationField === 'name' ? 'guest-name-error' : undefined} />
                  {validationField === 'name' && <p id="guest-name-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">Enter your name using at least 2 characters.</p>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                    Phone number <span className="text-gokez-700 dark:text-gokez-400" aria-hidden="true">*</span>
                  </label>
                  <input ref={guestPhoneInput} type="tel" inputMode="numeric" value={guestPhone}
                    onChange={e => { setGuestPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); if (validationField === 'phone') setValidationField(null); }}
                    onBlur={() => { if (guestPhone && !isValidIndianMobile(guestPhone)) setValidationField('phone'); }}
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
          <div className={`${card} !overflow-visible`}>
            <button type="button"
              onClick={() => {
                setShowPreferences(open => !open);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <div className="w-9 h-9 rounded-xl bg-gokez-50 dark:bg-gokez-900/20 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-gokez-700 dark:text-gokez-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Delivery Time</p>
                <p className="text-sm text-gray-900 dark:text-white font-medium">
                  {deliveryPreference === 'scheduled' && scheduledSlot
                    ? <>{slotLabel(schedule, scheduledSlot)}</>
                    : <>Delivery in 10-15 mins</>}
                </p>
              </div>
              <span className="flex h-7 items-center flex-shrink-0 rounded-lg bg-gray-900 px-2.5 text-[11px] font-bold text-white dark:bg-slate-700">
                {showPreferences ? 'Done' : 'Schedule Delivery'}
              </span>
            </button>
            {showPreferences && (
              <div className="border-t border-gray-100 dark:border-slate-700 p-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setDeliveryPreference('within_15'); setScheduledSlot(null); }}
                    className={`rounded-lg border-2 px-3 py-2 text-left text-xs font-bold ${deliveryPreference === 'within_15' ? 'border-gokez-500 bg-gokez-50 text-gokez-700 dark:border-gokez-600 dark:bg-slate-900/60 dark:text-gokez-200' : 'border-gray-100 text-gray-700 dark:border-slate-700 dark:text-slate-200'}`}>
                    Fastest Delivery <span className="block text-[10px] font-medium opacity-70">10–15 mins</span>
                  </button>
                  <button type="button" disabled={availableScheduleDays.length === 0}
                    onClick={() => {
                      const first = availableScheduleDays[0];
                      if (!first) return;
                      const existingDay = scheduledSlot && availableScheduleDays.find(day => (
                        day.offset === scheduledSlot.offset
                        && day.slots.some(slot => slot.start === scheduledSlot.start)
                      ));
                      const day = existingDay ?? first;
                      setDeliveryPreference('scheduled');
                      setScheduleDay(day.offset);
                      setScheduledSlot(existingDay ? scheduledSlot : day.slots[0]);
                    }}
                    className={`rounded-lg border-2 px-3 py-2 text-left text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45 ${deliveryPreference === 'scheduled' ? 'border-gokez-500 bg-gokez-50 text-gokez-700 dark:border-gokez-600 dark:bg-slate-900/60 dark:text-gokez-200' : 'border-gray-100 text-gray-700 dark:border-slate-700 dark:text-slate-200'}`}>
                    Schedule Delivery <span className="block text-[10px] font-medium opacity-70">Choose your preferred time</span>
                  </button>
                </div>
                {deliveryPreference === 'scheduled' && (
                  <div className="space-y-2.5 rounded-xl border border-transparent bg-gokez-50 p-2.5 dark:border-slate-700 dark:bg-slate-900/50">
                    {availableScheduleDays.length === 0 ? <p className="py-2 text-center text-xs font-medium text-gokez-700 dark:text-gokez-200">No delivery times are available today or tomorrow.</p> : <>
                      <div className="flex gap-2">
                        {availableScheduleDays.map(day => <button key={day.offset} type="button"
                          onClick={() => { setScheduleDay(day.offset); setScheduledSlot(day.slots.find(slot => schedulePeriod === 'all' || (schedulePeriod === 'am' ? slot.start < 12 * 60 : slot.start >= 12 * 60)) ?? day.slots[0]); }}
                          className={`flex-1 rounded-lg border-2 px-3 py-1.5 text-xs font-bold ${selectedSchedule?.offset === day.offset ? 'border-gokez-500 bg-white text-gokez-700 dark:border-gokez-600 dark:bg-slate-700 dark:text-gokez-200' : 'border-transparent bg-white/70 text-gray-600 dark:bg-slate-800/80 dark:text-slate-300'}`}>{day.label}</button>)}
                      </div>
                      <div className="flex gap-1.5">
                        {(['all', 'am', 'pm'] as const).map(period => <button key={period} type="button" onClick={() => {
                          setSchedulePeriod(period);
                          const first = selectedSchedule?.slots.find(slot => period === 'all' || (period === 'am' ? slot.start < 12 * 60 : slot.start >= 12 * 60));
                          if (first) setScheduledSlot(first);
                        }} className={`flex-1 rounded-md py-1 text-[10px] font-bold uppercase ${schedulePeriod === period ? 'bg-gokez-700 text-white' : 'bg-white/70 text-gokez-700 dark:bg-slate-800 dark:text-gokez-300'}`}>{period}</button>)}
                      </div>
                      {visibleScheduleSlots.length === 0 ? <p className="py-1 text-center text-xs text-gokez-700 dark:text-gokez-200">No {schedulePeriod.toUpperCase()} times for this day.</p> : <select value={scheduledSlot && scheduledSlot.offset === selectedSchedule?.offset ? `${scheduledSlot.offset}-${scheduledSlot.start}` : ''} onChange={event => {
                        const slot = selectedSchedule?.slots.find(item => `${item.offset}-${item.start}` === event.target.value);
                        if (slot) setScheduledSlot(slot);
                      }} className="w-full rounded-lg border border-gokez-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gokez-800 dark:bg-slate-800 dark:text-white">
                        {visibleScheduleSlots.map(slot => <option key={`${slot.offset}-${slot.start}`} value={`${slot.offset}-${slot.start}`}>{slotRange(slot)}</option>)}
                      </select>}
                      {scheduledSlot && <p className="text-center text-[11px] font-semibold text-gokez-700 dark:text-gokez-200">Scheduled: {slotLabel(schedule, scheduledSlot)}</p>}
                    </>}
                  </div>
                )}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-50 dark:border-slate-700" />

            {/* Delivery note */}
            <div className="relative flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 rounded-xl bg-gokez-50 dark:bg-gokez-900/20 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-4 h-4 text-gokez-700 dark:text-gokez-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Delivery instruction</p>
                <p className="text-sm text-gray-900 dark:text-white font-medium truncate">{currentNote}</p>
              </div>
              <button type="button" onClick={() => setShowNoteMenu(open => !open)}
                className="flex h-7 shrink-0 items-center rounded-lg border border-gokez-600 bg-gokez-700 px-2.5 text-[11px] font-bold text-white dark:border-gokez-500 dark:bg-gokez-700">
                Change
              </button>
              {showNoteMenu && (
                <div className="absolute right-4 top-[calc(100%-4px)] z-20 w-52 overflow-hidden rounded-lg border border-gokez-100 bg-white py-1 shadow-lg dark:border-gokez-900 dark:bg-slate-800">
                  {NOTES.map(note => <button key={note} type="button" onClick={() => {
                    setDeliveryNote(note);
                    setShowCustomNote(false);
                    setShowNoteMenu(false);
                  }} className="w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gokez-50 dark:text-slate-200 dark:hover:bg-gokez-900/30">
                    {note}
                  </button>)}
                  <button type="button" onClick={() => { setShowCustomNote(true); setShowNoteMenu(false); }} className="w-full border-t border-gokez-100 px-3 py-2 text-left text-xs font-bold text-gokez-700 hover:bg-gokez-50 dark:border-gokez-900 dark:text-gokez-300 dark:hover:bg-gokez-900/30">
                    Write your own...
                  </button>
                </div>
              )}
            </div>
            {showCustomNote && (
              <div className="border-t border-gray-100 px-4 py-3 dark:border-slate-700">
                <textarea value={customNote} onChange={event => setCustomNote(event.target.value)}
                  className={`${inp} resize-none`} rows={2} placeholder="e.g. Come to 3rd floor" autoFocus={finePointer} />
              </div>
            )}
          </div>

          {/* ── Bill Summary ── */}
          <div className={card}>
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-700">
              <span className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Bill Summary</span>
              {totalSavings > 0 && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-2 py-1 text-[11px] font-bold text-amber-950 shadow-sm">
                <span aria-hidden="true">🎉</span> You saved ₹{totalSavings.toFixed(0)} on this order
              </span>}
            </div>
            <div className="space-y-2 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">Item total</span>
                <span className="flex items-center gap-1.5">
                  {itemLevelSavings > 0 && (
                    <span className="text-xs font-medium text-gray-400 line-through dark:text-slate-500">₹{(sub + itemLevelSavings).toFixed(0)}</span>
                  )}
                  <span className="font-medium text-gray-900 dark:text-white">₹{sub.toFixed(0)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">Delivery charge</span>
                <span className="flex items-center gap-1.5">
                  {actualDelivery === 0 && deliveryCharge > 0 && (
                    <span className="text-xs font-medium text-gray-400 line-through dark:text-slate-500">₹{deliveryCharge.toFixed(0)}</span>
                  )}
                  <span className={actualDelivery === 0 ? 'text-gokez-700 font-semibold dark:text-gokez-400' : 'text-gray-900 dark:text-white'}>
                    {actualDelivery === 0 ? 'FREE' : `₹${actualDelivery}`}
                  </span>
                </span>
              </div>
              {displayedCampaignDiscount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gokez-700 dark:text-gokez-400">🎉 {appliedCampaign?.title || 'Discount'}</span>
                  <span className="text-gokez-700 font-semibold dark:text-gokez-400">-₹{displayedCampaignDiscount.toFixed(0)}</span>
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
      <div className="checkout-sticky-footer sticky bottom-0 z-30 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
        <div className="max-w-lg mx-auto">
          {/* Address row — the same control as the account page, opens the sheet */}
          <div className="px-3 pt-1">
            <AddressButton
              address={checkoutAddress}
              error={validationField === 'address'}
              emptyLabel="No delivery address yet"
              flat
              onClick={() => { track('checkout_address_started'); openAddressSheet(); }}
            />
          </div>

          <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            {!canCheckout && sub < minOrder && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400 text-center mb-2" role="status">Add ₹{(minOrder - sub).toFixed(0)} more to reach the ₹{minOrder} minimum order.</p>
            )}

            {/* The store charges no delivery fee. Saying so here, next to the
                total, stops a "FREE" delivery row from reading as a temporary
                perk -- delivery is simply free on every order. */}
            {deliveryIsAlwaysFree && (
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-gokez-700 dark:text-gokez-400 text-center mb-2">
                <span aria-hidden="true">🛵</span> Delivery is free on every order
              </p>
            )}

            {canCheckout && showMissingDetails && incompleteCheckoutDetails.length > 0 && (
              <p className="mb-2 text-center text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
                Still needed: {joinList(incompleteCheckoutDetails)}
              </p>
            )}

            <div className="flex items-center gap-3">
              <div className="w-16 flex-shrink-0 text-center">
                <p className="text-[10px] font-semibold text-gray-500 dark:text-slate-400">To pay</p>
                {/* Keyed on the value so React replaces the node whenever the
                    amount changes; without this iOS WebKit keeps painting the
                    old string in the sticky layer (WebKit bug 209376). */}
                <p key={payAmount} className="text-lg font-bold text-gray-900 dark:text-white">₹{payAmount.toFixed(0)}</p>
              </div>
              <button type="submit" form="checkout-form" disabled={loading || couponLoading || !canCheckout}
                className="flex-1 h-14 bg-gokez-700 hover:bg-gokez-800 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm flex flex-col items-center justify-center leading-tight dark:bg-gokez-700 dark:text-white dark:hover:bg-gokez-800">
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

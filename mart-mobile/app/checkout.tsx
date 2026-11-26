import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, FlatList, Modal,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  storeApi, campaignApi, addressApi, authApi, referralApi, recommendationApi,
  type PublicSettings, type Product, type Address, type ReferralCredit,
} from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useZoneStore } from '@/store/zoneStore';
import { useFunnelStore } from '@/store/funnelStore';
import { useGuestTrackingStore } from '@/store/guestTrackingStore';
import { useThemeColors } from '@/constants/theme';
import { newIdempotencyKey } from '@/utils/idempotency';
import { syncFunnelCart, track } from '@/utils/track';
import {
  type CheckoutReferralSelection,
  calculateOrderSavings, calculateOrderTotals, canApplyCampaignDiscount,
  canApplyReferralDiscount, canUseReferralCredit, clearCheckoutReferralSelection,
  discountConflictMessage, readCheckoutReferralSelection, referralDiscountFor,
  saveCheckoutReferralSelection, sortReferralCredits,
} from '@/utils/referral';
import AsyncStorage from '@react-native-async-storage/async-storage';

type PayMethod = 'cod' | 'upi' | 'phonepay';
type DeliveryPreference = 'within_15' | 'scheduled';
type PlaceOrderPayload = Parameters<typeof storeApi.placeOrder>[0];

interface CampaignCartItemLike {
  categoryId?: string | null;
  categoryName?: string | null;
  price: number;
  quantity: number;
}

function campaignCategoryIds(camp: any): string[] {
  return (Array.isArray(camp?.categoryIds) ? camp.categoryIds : [])
    .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id));
}

function campaignCategoryNames(camp: any): string[] {
  return (Array.isArray(camp?.categoryNames) ? camp.categoryNames : [])
    .filter((name: unknown): name is string => typeof name === 'string' && Boolean(name));
}

function campaignEligibleSubtotal(camp: any, items: CampaignCartItemLike[], cartTotal: number): number {
  const ids = new Set(campaignCategoryIds(camp));
  const names = new Set(campaignCategoryNames(camp).map(name => name.toLowerCase()));
  if (ids.size === 0 && names.size === 0) return cartTotal;
  return items.reduce((sum, item) => {
    const idMatch = !!item.categoryId && ids.has(item.categoryId);
    const nameMatch = !!item.categoryName && names.has(item.categoryName.toLowerCase());
    return sum + (idMatch || nameMatch ? item.price * item.quantity : 0);
  }, 0);
}

function campaignDiscountFor(camp: any, items: CampaignCartItemLike[], cartTotal: number): number {
  const eligible = Math.max(0, campaignEligibleSubtotal(camp, items, cartTotal));
  if (camp?.discount_type === 'flat') {
    return Math.floor(Math.max(0, Math.min(Number(camp.discount_value) || 0, eligible)));
  }
  if (camp?.discount_type === 'percent') {
    const raw = (eligible * (Number(camp.discount_value) || 0)) / 100;
    const capped = camp.max_discount !== null && camp.max_discount !== undefined && camp.max_discount !== ''
      ? Math.min(raw, Math.max(0, Number(camp.max_discount) || 0))
      : raw;
    return Math.floor(Math.max(0, capped));
  }
  return 0;
}

function parseGuestCoordinates(lat: string, lng: string): { latitude: number | null; longitude: number | null } {
  const rawLat = lat.trim();
  const rawLng = lng.trim();
  if (!rawLat && !rawLng) return { latitude: null, longitude: null };
  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (
    rawLat && rawLng
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  ) return { latitude, longitude };
  return { latitude: null, longitude: null };
}

const DELIVERY_NOTES = ['Ring the bell', 'Call me when you arrive', "Don't ring the bell"];
const ADDRESS_LABELS = ['Home', 'Work', 'Other'];
const IST_OFFSET_MIN = 330;
const SLOT_MINUTES = 60;
const SLOT_LEAD_MINUTES = 30;
const SCHEDULE_DAY_OFFSET = 1;
const FALLBACK_OPEN_MIN = 8 * 60;
const FALLBACK_CLOSE_MIN = 22 * 60;
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface DeliverySlot { offset: number; start: number; end: number; at: Date }
interface DeliveryDay { offset: number; label: string; dateLabel: string; slots: DeliverySlot[] }

function istParts(d: Date = new Date()) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(),
    day: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes(),
  };
}

function istInstant(offset: number, minutes: number): Date {
  const b = istParts();
  return new Date(Date.UTC(b.y, b.mo, b.d + offset) + minutes * 60000 - IST_OFFSET_MIN * 60000);
}

function toMinutes(hhmm: string | undefined, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!match) return fallback;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value < 1440 ? value : fallback;
}

function fmtClock(minutes: number): { text: string; mer: 'AM' | 'PM' } {
  const h24 = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const mer = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: mm === 0 ? `${h}` : `${h}:${String(mm).padStart(2, '0')}`, mer };
}

function slotRange(slot: DeliverySlot): string {
  const a = fmtClock(slot.start);
  const b = fmtClock(slot.end);
  return a.mer === b.mer ? `${a.text}–${b.text} ${b.mer}` : `${a.text} ${a.mer}–${b.text} ${b.mer}`;
}

function buildSchedule(hours: PublicSettings['openingHours']): DeliveryDay[] {
  const nowMs = Date.now();
  const b = istParts();
  const offset = SCHEDULE_DAY_OFFSET;
  const date = new Date(Date.UTC(b.y, b.mo, b.d + offset));
  const key = JS_DAY_TO_KEY[date.getUTCDay()] ?? 'mon';
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(date);
  const window = hours?.[key];
  const slots: DeliverySlot[] = [];
  if (window && !window.closed) {
    const open = toMinutes(window.open, FALLBACK_OPEN_MIN);
    const close = toMinutes(window.close, FALLBACK_CLOSE_MIN);
    for (let start = open; start + SLOT_MINUTES <= close; start += SLOT_MINUTES) {
      const at = istInstant(offset, start);
      if (at.getTime() <= nowMs + SLOT_LEAD_MINUTES * 60000) continue;
      slots.push({ offset, start, end: start + SLOT_MINUTES, at });
    }
  }
  return [{ offset, label: 'Tomorrow', dateLabel, slots }];
}

function slotLabel(schedule: DeliveryDay[], slot: DeliverySlot | null): string {
  if (!slot) return '';
  const day = schedule.find(item => item.offset === slot.offset);
  return `${day?.dateLabel ?? day?.label ?? ''} · ${slotRange(slot)}`;
}

function isValidName(raw: string): boolean {
  const value = raw.trim().replace(/\s+/g, ' ');
  return value.length >= 2 && value.length <= 80 && /\p{L}/u.test(value);
}

function money(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '');
}

function Card({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 16, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
      {children}
    </View>
  );
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
      <Ionicons name={icon as any} size={15} color={colors.gray500} />
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</Text>
    </View>
  );
}

export default function CheckoutScreen() {
  const colors = useThemeColors();
  const { customer, updateProfile } = useAuthStore();
  const { items, updateQty, subtotal, clearCart, addItem, itemSavings, reconcileWithCatalog, setAppliedCampaign, setReferralSelection: setCartReferralSelection, clearReferralSelection: clearCartReferralSelection } = useCartStore();
  const { selectedZone } = useZoneStore();

  const [settings,      setSettings]      = useState<PublicSettings | null>(null);
  const [addresses,     setAddresses]     = useState<Address[]>([]);
  const [address,       setAddress]       = useState('');
  const [addressLabel,  setAddressLabel]  = useState('Delivery Address');
  const [note,          setNote]          = useState('Ring the bell');
  const [customNote,    setCustomNote]    = useState('');
  const [showNotes,     setShowNotes]     = useState(false);
  const [payment]                         = useState<PayMethod>('cod');
  const [placing,       setPlacing]       = useState(false);
  const [suggestions,   setSuggestions]   = useState<Product[]>([]);
  const [recommendationMode, setRecommendationMode] = useState<'free_delivery' | 'discovery' | null>(null);
  const [freeDeliveryRemaining, setFreeDeliveryRemaining] = useState(0);
  const [campaigns,     setCampaigns]     = useState<any[]>([]);
  const [appliedCamp,   setAppliedCamp]   = useState<any>(null);
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [campDiscount,  setCampDiscount]  = useState(0);
  const [couponInput,   setCouponInput]   = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError,   setCouponError]   = useState('');
  const [couponHint,    setCouponHint]    = useState('');
  const [showOffers,    setShowOffers]    = useState(false);
  const [billExpanded,  setBillExpanded]  = useState(false);
  const [deliveryPreference, setDeliveryPreference] = useState<DeliveryPreference>('within_15');
  const [scheduledSlot, setScheduledSlot] = useState<DeliverySlot | null>(null);
  const [draftSlot,     setDraftSlot]     = useState<DeliverySlot | null>(null);
  const [showSchedule,  setShowSchedule]  = useState(false);
  const [pendingCampaign, setPendingCampaign] = useState<any>(null);
  const [referralCredits, setReferralCredits] = useState<ReferralCredit[]>([]);
  const [referralCreditsLoaded, setReferralCreditsLoaded] = useState(false);
  const [referralApplied, setReferralApplied] = useState<CheckoutReferralSelection | null>(() => readCheckoutReferralSelection());
  const [referralHint,  setReferralHint]  = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);

  const isGuest = !customer;
  const needsName = !!customer && !customer.name?.trim();
  const [accountName, setAccountName] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestAddrDraft, setGuestAddrDraft] = useState('');
  const [guestAddressLabel, setGuestAddressLabel] = useState('Home');
  const [guestLat, setGuestLat] = useState('');
  const [guestLng, setGuestLng] = useState('');
  const [locating, setLocating] = useState(false);
  const [showGuestAddr, setShowGuestAddr] = useState(false);
  const [guestLoaded, setGuestLoaded] = useState(false);

  const orderKeyRef = useRef('');
  if (!orderKeyRef.current) orderKeyRef.current = newIdempotencyKey();
  const trackedRef = useRef(false);

  const sub = subtotal();
  const deliveryCharge = parseFloat(settings?.delivery_charge ?? '0');
  const freeAbove = parseFloat(settings?.free_delivery_above ?? '0');
  const minOrder = parseFloat(settings?.min_order_amount ?? '0');
  const schedule = buildSchedule(settings?.openingHours);
  const activeItems = items.filter(i => !i.unavailable);
  const campaignCartItems = useMemo<CampaignCartItemLike[]>(
    () => activeItems.map(i => ({ categoryId: i.categoryId, categoryName: i.categoryName, price: i.price, quantity: i.quantity })),
    [items],
  );
  const campaignEligibleTotal = appliedCamp ? campaignEligibleSubtotal(appliedCamp, campaignCartItems, sub) : sub;
  const campaignMeetsMinimum = !appliedCamp || Number(appliedCamp.min_order_amount || 0) <= campaignEligibleTotal;
  const displayedCampaignDiscount = appliedCamp && campaignMeetsMinimum
    ? campaignDiscountFor(appliedCamp, campaignCartItems, sub) : 0;
  const campaignApplied = Boolean(appliedCamp) || Boolean(appliedCouponCode);
  const actualDelivery = appliedCamp?.discount_type === 'free_delivery' && campaignMeetsMinimum
    ? 0 : (freeAbove > 0 && sub >= freeAbove ? 0 : deliveryCharge);
  const referralDiscount = Math.min(
    referralDiscountFor(referralApplied, sub, campaignApplied),
    Math.max(0, sub - displayedCampaignDiscount),
  );
  const total = calculateOrderTotals({
    subtotal: sub,
    deliveryCharge: actualDelivery,
    campaignDiscount: displayedCampaignDiscount,
    referralDiscount,
  });
  const itemLevelSavings = itemSavings();
  const freeDeliverySaving = actualDelivery === 0 && deliveryCharge > 0 ? deliveryCharge : 0;
  const totalSavings = calculateOrderSavings({
    itemSavings: itemLevelSavings,
    freeDeliverySaving,
    campaignDiscount: displayedCampaignDiscount,
    referralDiscount,
  });
  const selectedAddress = addresses.find(a => a.addressLine === address) ?? null;
  const selectedLabel = isGuest ? (addressLabel || 'Home') : (selectedAddress?.label ?? 'Delivery Address');
  const scheduledLabel = deliveryPreference === 'scheduled' && scheduledSlot ? slotLabel(schedule, scheduledSlot) : undefined;
  const canPlace = activeItems.length > 0 && sub >= minOrder && !couponLoading;
  const deliveryIsAlwaysFree = deliveryCharge <= 0;

  useEffect(() => {
    if (!isGuest) { setGuestLoaded(true); return; }
    setReferralApplied(null);
    clearCheckoutReferralSelection();
    clearCartReferralSelection();
    setAppliedCamp(null);
    setAppliedCouponCode(null);
    setCampDiscount(0);
    setAppliedCampaign(null, 0);
    let cancelled = false;
    (async () => {
      const [name, phone, addr, label, lat, lng] = await Promise.all([
        AsyncStorage.getItem('guest_name'),
        AsyncStorage.getItem('guest_phone'),
        AsyncStorage.getItem('guest_address'),
        AsyncStorage.getItem('guest_address_label'),
        AsyncStorage.getItem('guest_address_latitude'),
        AsyncStorage.getItem('guest_address_longitude'),
      ]);
      if (cancelled) return;
      setGuestName(name || '');
      setGuestPhone(phone || '');
      setGuestAddrDraft(addr || '');
      setGuestAddressLabel(label || 'Home');
      setGuestLat(lat || '');
      setGuestLng(lng || '');
      if (addr) setAddress(addr);
      setGuestLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [isGuest]);

  useEffect(() => {
    if (isGuest && guestLoaded && guestName) void AsyncStorage.setItem('guest_name', guestName);
  }, [guestName, isGuest, guestLoaded]);

  useEffect(() => {
    if (isGuest && guestLoaded && guestPhone) void AsyncStorage.setItem('guest_phone', guestPhone);
  }, [guestPhone, isGuest, guestLoaded]);

  useEffect(() => {
    if (!isGuest || !guestLoaded) return;
    if (guestAddrDraft) void AsyncStorage.setItem('guest_address', guestAddrDraft);
    void AsyncStorage.setItem('guest_address_label', guestAddressLabel || 'Home');
    const coords = parseGuestCoordinates(guestLat, guestLng);
    if (coords.latitude === null || coords.longitude === null) {
      void AsyncStorage.removeItem('guest_address_latitude');
      void AsyncStorage.removeItem('guest_address_longitude');
    } else {
      void AsyncStorage.setItem('guest_address_latitude', String(coords.latitude));
      void AsyncStorage.setItem('guest_address_longitude', String(coords.longitude));
    }
  }, [guestAddrDraft, guestAddressLabel, guestLat, guestLng, isGuest, guestLoaded]);

  const loadAddresses = useCallback(() => addressApi.list().then(r => {
    const list = r.data.data ?? [];
    setAddresses(list);
    const def = list.find(a => a.isDefault) ?? list[0];
    setAddress(def?.addressLine ?? '');
    setAddressLabel(def?.label ?? 'Delivery Address');
  }).catch(() => {}), []);

  useFocusEffect(useCallback(() => { loadAddresses(); }, [loadAddresses]));

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    storeApi.getProducts(undefined, selectedZone?.storeId, selectedZone?.id).then(r => {
      if (cancelled) return;
      reconcileWithCatalog(r.data.data ?? []);
      setCatalogRevision(v => v + 1);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedZone?.storeId, selectedZone?.id, reconcileWithCatalog]));

  useEffect(() => {
    if (isGuest) { setReferralCredits([]); setReferralCreditsLoaded(true); return; }
    let cancelled = false;
    referralApi.getCredits().then(r => {
      if (cancelled) return;
      const available = (r.data.data?.items ?? []).filter(credit => credit.status === 'available');
      setReferralCredits(sortReferralCredits(available));
    }).catch(() => {
      if (!cancelled) setReferralCredits([]);
    }).finally(() => { if (!cancelled) setReferralCreditsLoaded(true); });
    return () => { cancelled = true; };
  }, [isGuest]);

  useEffect(() => {
    if (!referralCreditsLoaded) return;
    if (!referralApplied) { clearCartReferralSelection(); return; }
    const credit = referralCredits.find(item => item.id === referralApplied.creditId);
    if (referralCreditsLoaded && !credit) {
      setReferralApplied(null);
      clearCheckoutReferralSelection();
      clearCartReferralSelection();
      return;
    }
    if (credit) setCartReferralSelection({ id: credit.id, amount: Number(credit.amount) || 0 });
  }, [referralCreditsLoaded, referralCredits, referralApplied, clearCartReferralSelection]);

  useEffect(() => {
    if (trackedRef.current || activeItems.length === 0) return;
    trackedRef.current = true;
    track('checkout_started', { itemCount: activeItems.length, subtotal: sub });
    syncFunnelCart(activeItems, { reachedCheckout: true });
  }, []);

  useEffect(() => {
    storeApi.getSettings(selectedZone?.storeId, selectedZone?.id).then(r => setSettings(r.data.data)).catch(() => {});
  }, [selectedZone?.storeId, selectedZone?.id]);

  const applyDiscount = useCallback((camp: any, cartTotal: number) => {
    const floored = campaignDiscountFor(camp, campaignCartItems, cartTotal);
    setAppliedCamp(camp);
    setCampDiscount(floored);
    setAppliedCampaign(camp, floored);
  }, [campaignCartItems, setAppliedCampaign]);

  const removeCampaign = useCallback((hint = '') => {
    setAppliedCamp(null);
    setAppliedCouponCode(null);
    setCampDiscount(0);
    setAppliedCampaign(null, 0);
    setCouponInput('');
    setCouponError('');
    setCouponHint(hint);
  }, [setAppliedCampaign]);

  const requireLoginForOffer = useCallback(() => {
    Alert.alert(
      'Login to apply',
      'Offers and coupons are available after login. Log in to use this offer on your order.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Login', onPress: () => router.push({ pathname: '/(auth)/login', params: { pendingCheckout: '1', from: 'checkout' } }) },
      ],
    );
  }, []);

  useEffect(() => {
    if (!selectedZone?.storeId) return;
    let cancelled = false;
    (async () => {
      const [welcomeRes, eligibleRes] = await Promise.allSettled([
        campaignApi.getWelcome(sub, selectedZone.storeId, selectedZone.id, campaignCartItems),
        isGuest ? Promise.resolve(null) : campaignApi.getEligible(sub, selectedZone.storeId, selectedZone.id, campaignCartItems),
      ]);
      if (cancelled) return;
      const welcome: any[] = welcomeRes.status === 'fulfilled' ? (welcomeRes.value?.data?.data ?? []) : [];
      const eligible: any[] = eligibleRes.status === 'fulfilled' && eligibleRes.value ? (eligibleRes.value.data?.data ?? []) : [];
      const merged = [...eligible, ...welcome.filter(item => !eligible.some((known: any) => known.id === item.id))];
      setCampaigns(appliedCamp && !merged.some((c: any) => c.id === appliedCamp.id) ? [appliedCamp, ...merged] : merged);
      const auto = merged.find((c: any) => !c.coupon_code && !c.requires_scheduled_delivery);
      if (!isGuest && auto && !appliedCamp && canApplyCampaignDiscount({ referralApplied: Boolean(referralApplied) })) {
        applyDiscount(auto, sub);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedZone?.storeId, selectedZone?.id, sub, isGuest, appliedCamp, referralApplied, campaignCartItems, catalogRevision, applyDiscount]);

  useEffect(() => {
    if (!selectedZone?.storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const digits = guestPhone.replace(/\D/g, '');
      const phone = isGuest && /^\d{10}$/.test(digits) ? digits : undefined;
      recommendationApi.get(selectedZone.storeId!, activeItems.map(i => ({ productId: i.productId })), sub, phone)
        .then(r => {
          if (cancelled) return;
          const data = r.data.data;
          setSuggestions(data.products ?? []);
          setRecommendationMode(data.mode ?? null);
          setFreeDeliveryRemaining(Math.max(0, Number(data.remainingForFreeDelivery) || 0));
        })
        .catch(() => {});
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedZone?.storeId, sub, items.length, isGuest, guestPhone]);

  useEffect(() => {
    if (appliedCamp && campaignEligibleTotal < Number(appliedCamp.min_order_amount || 0)) {
      const minimumOrder = Number(appliedCamp.min_order_amount || 0);
      removeCampaign(`Add ₹${Math.ceil(Math.max(0, minimumOrder - campaignEligibleTotal))} more to use this coupon (minimum cart value ₹${money(minimumOrder)}).`);
    }
  }, [campaignEligibleTotal, appliedCamp, removeCampaign]);

  const clearReferral = () => {
    setReferralApplied(null);
    clearCheckoutReferralSelection();
    clearCartReferralSelection();
    setReferralHint('');
  };

  const validateCoupon = async (rawCode?: string) => {
    if (isGuest) { requireLoginForOffer(); return; }
    const code = (rawCode ?? couponInput).trim().toUpperCase();
    if (!code || !selectedZone?.storeId) return;
    if (!canApplyCampaignDiscount({ referralApplied: Boolean(referralApplied) })) {
      setReferralHint(discountConflictMessage());
      return;
    }
    setCouponLoading(true);
    setCouponError('');
    setCouponHint('');
    try {
      const res = await campaignApi.validateCode(code, sub, selectedZone.storeId, selectedZone.id, campaignCartItems);
      const campaign = res.data.data.campaign;
      const floored = Math.floor(Math.max(0, Number(res.data.data.discount) || 0));
      setAppliedCamp(campaign);
      setAppliedCouponCode(code);
      setCampDiscount(floored);
      setAppliedCampaign(campaign, floored);
      setCouponInput('');
      setCouponHint('');
      setShowOffers(false);
    } catch (e: any) {
      const message = e?.response?.data?.error ?? 'Invalid coupon code';
      const minimumMatch = String(message).match(/Minimum order ₹([\d.]+) required/i);
      if (minimumMatch) {
        const minimumOrder = Number(minimumMatch[1]);
        setCouponHint(`Add ₹${Math.ceil(Math.max(0, minimumOrder - campaignEligibleTotal))} more to use this coupon (minimum cart value ₹${money(minimumOrder)}).`);
      } else {
        setCouponError(message);
      }
      Alert.alert('Coupon not applied', message);
    } finally { setCouponLoading(false); }
  };

  useEffect(() => {
    if (!appliedCamp || !selectedZone?.storeId || isGuest) return;
    let cancelled = false;
    const recheck = async () => {
      if (appliedCouponCode) {
        try {
          const res = await campaignApi.validateCode(appliedCouponCode, sub, selectedZone.storeId, selectedZone.id, campaignCartItems);
          if (cancelled) return;
          const campaign = res.data.data.campaign;
          const floored = Math.floor(Math.max(0, Number(res.data.data.discount) || 0));
          if (campaign.id !== appliedCamp.id || floored !== campDiscount) {
            setAppliedCamp(campaign);
            setCampDiscount(floored);
            setAppliedCampaign(campaign, floored);
          }
        } catch (e: any) {
          if (cancelled) return;
          removeCampaign();
          Alert.alert('Coupon removed', e?.response?.data?.error ?? 'Your cart changed, so the coupon was removed.');
        }
      } else {
        const floored = campaignDiscountFor(appliedCamp, campaignCartItems, sub);
        if (floored !== campDiscount) {
          setCampDiscount(floored);
          setAppliedCampaign(appliedCamp, floored);
        }
      }
    };
    void recheck();
    return () => { cancelled = true; };
  }, [appliedCamp, appliedCouponCode, campDiscount, campaignCartItems, catalogRevision, isGuest, sub, selectedZone?.storeId, selectedZone?.id, removeCampaign, setAppliedCampaign]);

  const applyCampaign = (camp: any, skipSchedulePrompt = false) => {
    if (isGuest) { requireLoginForOffer(); return; }
    if (!canApplyCampaignDiscount({ referralApplied: Boolean(referralApplied) })) {
      setReferralHint(discountConflictMessage());
      return;
    }
    const ids = new Set(campaignCategoryIds(camp));
    const names = new Set(campaignCategoryNames(camp).map(name => name.toLowerCase()));
    if ((ids.size > 0 || names.size > 0) && !campaignCartItems.some(item =>
      (!!item.categoryId && ids.has(item.categoryId)) || (!!item.categoryName && names.has(item.categoryName.toLowerCase())))) {
      setCouponError(`This offer is only valid on ${campaignCategoryNames(camp).join(', ') || 'the selected categories'}. Add an eligible item to use it.`);
      return;
    }
    if (camp.requires_scheduled_delivery && !skipSchedulePrompt && !scheduledSlot) {
      setPendingCampaign(camp);
      setDraftSlot(schedule[0]?.slots[0] ?? null);
      setShowSchedule(true);
      return;
    }
    if (!camp.requires_scheduled_delivery && scheduledSlot) {
      setDeliveryPreference('within_15');
      setScheduledSlot(null);
      setDraftSlot(null);
    }
    if (camp.coupon_code) { void validateCoupon(camp.coupon_code); return; }
    applyDiscount(camp, sub);
    setCouponHint('');
    setShowOffers(false);
  };

  const commitSchedule = () => {
    if (!draftSlot) return;
    setScheduledSlot(draftSlot);
    setDeliveryPreference('scheduled');
    setShowSchedule(false);
    const camp = pendingCampaign;
    setPendingCampaign(null);
    if (camp) applyCampaign(camp, true);
  };

  const clearSchedule = () => {
    setDraftSlot(null);
    setScheduledSlot(null);
    setDeliveryPreference('within_15');
    setPendingCampaign(null);
    setShowSchedule(false);
    if (appliedCamp?.requires_scheduled_delivery) removeCampaign();
  };

  const applyReferral = (credit: ReferralCredit) => {
    setReferralHint('');
    if (!canApplyReferralDiscount({ campaignApplied: Boolean(appliedCamp), couponApplied: Boolean(appliedCouponCode) })) {
      setReferralHint(discountConflictMessage());
      return;
    }
    if (credit.expiresAt && Date.parse(credit.expiresAt) <= Date.now()) {
      Alert.alert('Referral reward', 'This credit has expired.');
      return;
    }
    if (!canUseReferralCredit(credit, sub, customer?.orderCount === 0)) {
      const minimum = Math.max(0, Number(credit.redemptionMinOrderAmount) || 0);
      Alert.alert('Referral reward', `Add ₹${Math.ceil(Math.max(0, minimum - sub))} more to use this reward (minimum cart value ₹${money(minimum)}).`);
      return;
    }
    const selection: CheckoutReferralSelection = { creditId: credit.id, amount: Math.max(0, Number(credit.amount) || 0) };
    setReferralApplied(selection);
    saveCheckoutReferralSelection(selection);
    setCartReferralSelection({ id: selection.creditId, amount: selection.amount });
  };

  const handleRemoveReferral = () => clearReferral();

  const handleGuestLocate = async () => {
    try {
      setLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location permission', 'Allow location access to add coordinates, or enter them manually.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setGuestLat(String(position.coords.latitude));
      setGuestLng(String(position.coords.longitude));
    } catch {
      Alert.alert('Location unavailable', 'Could not get your location. Enter coordinates manually or leave them blank.');
    } finally { setLocating(false); }
  };

  const commitGuestAddress = (label: string, addr: string, lat: string, lng: string) => {
    const normalizedLabel = label.trim() || 'Home';
    const coords = parseGuestCoordinates(lat, lng);
    if ((lat.trim() || lng.trim()) && (coords.latitude === null || coords.longitude === null)) {
      Alert.alert('Invalid location', 'Enter both latitude (-90 to 90) and longitude (-180 to 180), or leave both blank.');
      return;
    }
    setAddress(addr);
    setAddressLabel(normalizedLabel);
    setGuestAddrDraft(addr);
    setGuestAddressLabel(normalizedLabel);
    setGuestLat(coords.latitude === null ? '' : String(coords.latitude));
    setGuestLng(coords.longitude === null ? '' : String(coords.longitude));
    setShowGuestAddr(false);
    void storeApi.saveGuestDetails({
      phone: guestPhone.replace(/\D/g, ''),
      name: guestName,
      address: addr,
      label: normalizedLabel,
      latitude: coords.latitude,
      longitude: coords.longitude,
    }).catch(() => undefined);
  };

  const handlePlace = async () => {
    if (sub < minOrder) { Alert.alert('Minimum order', `Add ₹${Math.ceil(minOrder - sub)} more to place order.`); return; }
    if (couponLoading) return;
    const orderName = customer?.name?.trim() || accountName.trim() || guestName.trim().replace(/\s+/g, ' ');
    if ((needsName || isGuest) && !isValidName(orderName)) {
      Alert.alert('Enter your name', 'Name is required: 2–80 characters with at least one letter.');
      return;
    }
    const orderPhone = customer?.phone ?? guestPhone.trim();
    if (!orderPhone || orderPhone.replace(/\D/g, '').length < 10) {
      Alert.alert('Phone number', 'Enter a valid 10-digit mobile number to place the order.');
      return;
    }
    if (!address.trim()) {
      if (isGuest) { setShowGuestAddr(true); return; }
      Alert.alert(
        'Add delivery address',
        'We need your address to deliver this order.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add address', onPress: () => router.push({ pathname: '/address-form', params: { returnToCheckout: 'true' } }) },
        ]
      );
      return;
    }
    if (deliveryPreference === 'scheduled' && !scheduledSlot) {
      Alert.alert('Choose a delivery slot', 'Pick a delivery slot to schedule your order, or switch to standard delivery.');
      setShowSchedule(true);
      return;
    }
    const openState = settings?.openState;
    if (openState && !openState.isOpen && deliveryPreference !== 'scheduled') {
      const message = openState.nextOpenLabel
        ? `Store is closed right now. Your order will be prepared when we reopen at ${openState.nextOpenLabel}.`
        : 'Store is closed right now. Your order will be prepared when we reopen.';
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert('Store Closed', message, [
          { text: 'Keep Shopping', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Place Order Anyway', onPress: () => resolve(true) },
        ]);
      });
      if (!confirmed) return;
    }

    const orderItems = activeItems.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity, sourceStoreId: i.sourceStoreId }));
    const phoneDigits = orderPhone.replace(/\D/g, '');
    const guestCoords = parseGuestCoordinates(guestLat, guestLng);
    const savedCoords = selectedAddress?.latitude != null && selectedAddress.longitude != null
      ? parseGuestCoordinates(String(selectedAddress.latitude), String(selectedAddress.longitude))
      : { latitude: null, longitude: null };
    const latitude = isGuest ? guestCoords.latitude : savedCoords.latitude;
    const longitude = isGuest ? guestCoords.longitude : savedCoords.longitude;
    const discountFields: Pick<PlaceOrderPayload, 'campaignId' | 'couponCode'> = isGuest || referralApplied
      ? {}
      : appliedCouponCode
        ? { couponCode: appliedCouponCode }
        : appliedCamp
          ? { campaignId: appliedCamp.id }
          : {};
    const referralFields: Pick<PlaceOrderPayload, 'referralCreditId'> = !isGuest && !appliedCamp && !appliedCouponCode && referralApplied
      ? { referralCreditId: referralApplied.creditId }
      : {};
    setPlacing(true);
    try {
      if (needsName && accountName.trim()) {
        const savedName = accountName.trim().replace(/\s+/g, ' ');
        authApi.updateProfile({ name: savedName }).then(() => updateProfile({ name: savedName })).catch(() => {});
      }
      if (isGuest) {
        await storeApi.saveGuestDetails({
          phone: phoneDigits,
          name: orderName,
          address: address.trim(),
          label: guestAddressLabel || 'Home',
          latitude,
          longitude,
        }).catch(() => undefined);
      }
      track('checkout_reviewed', { itemCount: orderItems.length, subtotal: sub, deliveryPreference });
      const payload: PlaceOrderPayload = {
        guestName: orderName,
        guestPhone: phoneDigits,
        guestAddress: address.trim(),
        guestAddressLabel: isGuest ? (guestAddressLabel || 'Home') : selectedLabel,
        latitude,
        longitude,
        zoneId: selectedZone?.id,
        zoneName: selectedZone?.name,
        storeId: selectedZone?.storeId,
        deliveryPreference,
        scheduledFor: deliveryPreference === 'scheduled' && scheduledSlot ? scheduledSlot.at.toISOString() : undefined,
        scheduledLabel,
        deliveryNote: customNote.trim() || note,
        notes: customNote.trim() || note,
        items: orderItems,
        paymentMethod: payment,
        ...discountFields,
        ...referralFields,
        funnelSessionId: useFunnelStore.getState().getSessionId(),
      };
      const res = await storeApi.placeOrder(payload, orderKeyRef.current);
      const orderId = res.data.data?.id;
      const trackingToken = res.data.data?.trackingToken;
      track('order_placed', { orderId, orderNumber: res.data.data?.orderNumber, itemCount: orderItems.length, value: res.data.data?.total });
      if (trackingToken) useGuestTrackingStore.getState().saveToken(trackingToken);
      clearCheckoutReferralSelection();
      clearCartReferralSelection();
      clearCart();
      if (isGuest) await AsyncStorage.setItem('guest_phone', phoneDigits);
      if (orderId) router.replace({ pathname: '/order/[id]', params: { id: orderId, trackingToken: trackingToken ?? '' } });
      else router.replace('/(tabs)/orders');
    } catch (e: any) {
      Alert.alert('Order failed', e?.response?.data?.error ?? 'Failed to place order. Please try again.');
    } finally { setPlacing(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Close checkout"
          style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 }}>
          <Ionicons name="close" size={20} color={colors.gray700} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>Checkout</Text>
          {settings?.openState && !settings.openState.isOpen && (
            <Text style={{ fontSize: 9, fontFamily: 'Inter-Medium', color: '#fbbf24', marginTop: -2 }}>
              {settings.openState.closedReason === 'manual' ? 'Store closed' : 'Store closed — opens ' + settings.openState.nextOpenLabel}
            </Text>
          )}
        </View>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 140 }}>

        <Card>
          <SectionTitle icon="bag-outline" title={`${items.length} Items`} />
          {items.map((item) => (
            <View key={`${item.productId}-${item.unit}`} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
              <Image source={{ uri: item.thumbnailUrl ?? item.photoUrl ?? undefined }} style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.gray100 }} contentFit="cover" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.gray900 }} numberOfLines={1}>{item.productName}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{item.unit} · ₹{item.price}{item.unavailable ? ' · Out of stock' : ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <TouchableOpacity onPress={() => updateQty(item.productId, item.unit, item.quantity - 1)}
                  style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: item.quantity === 1 ? '#fef2f2' : colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={item.quantity === 1 ? 'trash-outline' : 'remove'} size={14} color={item.quantity === 1 ? colors.red500 : colors.gray700} />
                </TouchableOpacity>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900, width: 24, textAlign: 'center' }}>{item.quantity}</Text>
                <TouchableOpacity onPress={() => updateQty(item.productId, item.unit, item.quantity + 1)}
                  style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="add" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900, width: 48, textAlign: 'right' }}>₹{item.price * item.quantity}</Text>
            </View>
          ))}
          {actualDelivery > 0 && freeAbove > 0 && deliveryCharge > 0 && (
            <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#d1fae5' }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.primary, textAlign: 'center' }}>
                🎉 Add ₹{Math.ceil(Math.max(freeAbove - sub, freeDeliveryRemaining))} more for free delivery
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Missed something?</Text>
            <TouchableOpacity onPress={() => router.back()}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.black, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}>
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' }}>Add more items</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {suggestions.length > 0 && (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900, marginHorizontal: 16, marginBottom: 10 }}>
              {recommendationMode === 'free_delivery' && freeDeliveryRemaining > 0
                ? `Add ₹${Math.ceil(freeDeliveryRemaining)} more for free delivery`
                : 'You may also like'}
            </Text>
            <FlatList
              data={suggestions} keyExtractor={p => p.id} horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item: p }) => (
                <View style={{ width: 120, backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
                  <Image source={{ uri: p.thumbnailUrl ?? p.photoVariants?.[0]?.thumbnailUrl ?? p.photoUrl ?? undefined }} style={{ width: 120, height: 100, backgroundColor: colors.gray100 }} contentFit="cover" />
                  <View style={{ padding: 8 }}>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.gray900, lineHeight: 15 }} numberOfLines={2}>{p.name}</Text>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{p.unit}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.primary }}>₹{p.price}</Text>
                      <TouchableOpacity onPress={() => {
                        if (p.weightOptions?.length) { router.push(`/product/${p.id}`); return; }
                        if (addItem(p) === 'different_unit') {
                          Alert.alert('One size per product', 'Remove the other size from your cart before adding this product.');
                        }
                      }}
                        style={{ backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: '#fff' }}>ADD</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            />
          </View>
        )}

        {isGuest && (
          <Card>
            <SectionTitle icon="person-outline" title="Your details" />
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Name <Text style={{ color: colors.red500 }}>✱</Text></Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                  value={guestName} onChangeText={setGuestName}
                  placeholder="Your name" placeholderTextColor={colors.gray400}
                />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Phone number <Text style={{ color: colors.red500 }}>✱</Text></Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                  value={guestPhone} onChangeText={t => setGuestPhone(t.replace(/[^\d]/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number" placeholderTextColor={colors.gray400}
                  keyboardType="number-pad" maxLength={10}
                />
              </View>
            </View>
          </Card>
        )}

        {!isGuest && needsName && (
          <Card>
            <SectionTitle icon="person-outline" title="Your details" />
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Name <Text style={{ color: colors.red500 }}>✱</Text></Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                  value={accountName} onChangeText={setAccountName}
                  placeholder="Your name" placeholderTextColor={colors.gray400}
                />
              </View>
            </View>
          </Card>
        )}

        <Card>
          <SectionTitle icon="time-outline" title="Delivery time" />
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 12 }}>
            <TouchableOpacity onPress={() => setDeliveryPreference('within_15')}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: deliveryPreference === 'within_15' ? colors.primary : colors.gray200, backgroundColor: deliveryPreference === 'within_15' ? colors.primaryLight : colors.surface }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: deliveryPreference === 'within_15' ? colors.primary : colors.gray600 }}>⚡ Standard</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{settings?.estimated_delivery?.trim() || '10-15 mins'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { if (schedule[0]?.slots.length) setShowSchedule(true); else Alert.alert('No slots available', 'There are no delivery slots available for tomorrow.'); }}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: deliveryPreference === 'scheduled' ? colors.primary : colors.gray200, backgroundColor: deliveryPreference === 'scheduled' ? colors.primaryLight : colors.surface }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: deliveryPreference === 'scheduled' ? colors.primary : colors.gray600 }}>📅 Schedule</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>Tomorrow's slot</Text>
            </TouchableOpacity>
          </View>
          {scheduledLabel && (
            <TouchableOpacity onPress={() => setShowSchedule(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
              <Ionicons name="calendar-outline" size={15} color={colors.primary} />
              <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray800 }}>Scheduled for {scheduledLabel}</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.primary }}>Change</Text>
            </TouchableOpacity>
          )}
        </Card>

        <Modal visible={showSchedule} transparent animationType="slide" onRequestClose={() => setShowSchedule(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowSchedule(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 }}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray200 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Choose a delivery slot</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{schedule[0]?.dateLabel} · 60-minute windows</Text>
              {schedule[0]?.slots.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {schedule[0].slots.map(slot => {
                    const active = draftSlot?.start === slot.start;
                    return (
                      <TouchableOpacity key={`${slot.offset}-${slot.start}`} onPress={() => setDraftSlot(slot)}
                        style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: active ? colors.primary : colors.gray200, backgroundColor: active ? colors.primaryLight : colors.surface }}>
                        <Text style={{ fontSize: 12, fontFamily: active ? 'Inter-Bold' : 'Inter-SemiBold', color: active ? colors.primary : colors.gray700 }}>{slotRange(slot)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginVertical: 20 }}>No delivery times are available tomorrow.</Text>
              )}
              <TouchableOpacity onPress={commitSchedule} disabled={!draftSlot}
                style={{ height: 46, borderRadius: 12, backgroundColor: draftSlot ? colors.primary : colors.gray200, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Save & continue</Text>
              </TouchableOpacity>
              {(scheduledSlot || pendingCampaign) && (
                <TouchableOpacity onPress={clearSchedule} style={{ marginTop: 10, alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.red500 }}>Clear schedule</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>

        <Card>
          <TouchableOpacity onPress={() => setShowNotes(true)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bgTint, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>Delivery instructions</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{customNote.trim() || note}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={colors.gray400} />
          </TouchableOpacity>
        </Card>

        <Modal visible={showNotes} transparent animationType="slide" onRequestClose={() => setShowNotes(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowNotes(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 }}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray200 }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.gray700} />
              </View>
              <View>
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Delivery instructions</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>How should we handle your delivery?</Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
              {DELIVERY_NOTES.map(n => (
                <TouchableOpacity key={n} onPress={() => { setNote(n); setCustomNote(''); setShowNotes(false); }}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: note === n && !customNote ? colors.black : colors.gray200, backgroundColor: note === n && !customNote ? colors.black : colors.surface, gap: 12 }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: note === n && !customNote ? '#fff' : colors.gray800, flex: 1 }}>{n}</Text>
                  {note === n && !customNote && <Ionicons name="checkmark" size={18} color="#fff" />}
                </TouchableOpacity>
              ))}
              <View style={{ borderWidth: 1.5, borderColor: customNote ? colors.gray900 : colors.gray200, borderRadius: 14, padding: 14, marginTop: 4 }}>
                <TextInput
                  style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, minHeight: 52, textAlignVertical: 'top' }}
                  value={customNote} onChangeText={setCustomNote}
                  placeholder="Write your own instruction..." placeholderTextColor={colors.gray400}
                  multiline
                />
                {customNote.trim().length > 0 && (
                  <TouchableOpacity onPress={() => setShowNotes(false)}
                    style={{ marginTop: 10, height: 42, borderRadius: 10, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>

        {(campaigns.length > 0 || appliedCamp) && (
          <Card>
            <TouchableOpacity onPress={() => setShowOffers(s => !s)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ionicons name="pricetag-outline" size={17} color="#7c3aed" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>
                  {appliedCamp ? `🎉 ${appliedCamp.title ?? 'Offer applied'}` : `${campaigns.length} offer${campaigns.length > 1 ? 's' : ''} available`}
                </Text>
                {displayedCampaignDiscount > 0 && <Text style={{ fontSize: 11, color: colors.primary, fontFamily: 'Inter-Regular', marginTop: 1 }}>Saving ₹{money(displayedCampaignDiscount)}</Text>}
              </View>
              {appliedCamp
                ? <TouchableOpacity onPress={() => removeCampaign()}><Ionicons name="close-circle" size={20} color={colors.gray400} /></TouchableOpacity>
                : <Ionicons name={showOffers ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
              }
            </TouchableOpacity>
            {showOffers && !appliedCamp && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.gray100, padding: 12, gap: 8 }}>
                {isGuest && (
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                    Log in to apply offers and coupons to this order.
                  </Text>
                )}
                {campaigns.map((c: any) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.gray100, borderRadius: 12, padding: 10, gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900 }}>{c.badge_text} {c.title}</Text>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{c.subtitle ?? c.description}</Text>
                      {c.coupon_code && <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: '#7c3aed', marginTop: 2 }}>Use code: {c.coupon_code}</Text>}
                      {Number(c.min_order_amount) > 0 && <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>Min order ₹{money(c.min_order_amount)}</Text>}
                      {campaignCategoryNames(c).length > 0 && <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>Eligible on {campaignCategoryNames(c).join(', ')}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => isGuest ? requireLoginForOffer() : applyCampaign(c)}
                      style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.primary }}>{isGuest ? 'Login' : 'Apply'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={{ flex: 1, borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                    value={couponInput} onChangeText={t => { setCouponInput(t.toUpperCase()); setCouponError(''); setCouponHint(''); }}
                    placeholder="Enter coupon code" placeholderTextColor={colors.gray400}
                  />
                  <TouchableOpacity onPress={() => isGuest ? requireLoginForOffer() : validateCoupon()} disabled={!isGuest && (couponLoading || !couponInput.trim())}
                    style={{ backgroundColor: '#7c3aed', paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                    {couponLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' }}>{isGuest ? 'Login' : 'Apply'}</Text>}
                  </TouchableOpacity>
                </View>
                {couponError ? <Text style={{ fontSize: 12, color: colors.red500, fontFamily: 'Inter-Regular' }}>{couponError}</Text> : null}
                {couponHint ? <Text style={{ fontSize: 12, color: colors.gray500, fontFamily: 'Inter-Regular' }}>{couponHint}</Text> : null}
              </View>
            )}
          </Card>
        )}

        {!isGuest && referralCredits.length > 0 && (
          <Card>
            <SectionTitle icon="gift-outline" title="Referral rewards" />
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                {referralCredits.some(c => c.benefitType === 'first_order')
                  ? 'First-order credits have no minimum spend.'
                  : `Available to use on orders above ₹${money(Math.min(...referralCredits.map(c => Number(c.redemptionMinOrderAmount) || 0)))}.`}
              </Text>
              {referralHint ? <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500 }}>{referralHint}</Text> : null}
              {referralCredits.map(credit => {
                const selected = referralApplied?.creditId === credit.id;
                const usable = canUseReferralCredit(credit, sub, customer?.orderCount === 0);
                const minimum = Math.max(0, Number(credit.redemptionMinOrderAmount) || 0);
                const expired = !!credit.expiresAt && Date.parse(credit.expiresAt) <= Date.now();
                return (
                  <View key={credit.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: selected ? colors.primary : colors.gray100, borderRadius: 12, padding: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900 }}>
                        ₹{money(credit.amount)} {credit.benefitType === 'first_order' ? 'first-order credit' : `reward${credit.stageNumber ? ` · stage ${credit.stageNumber}` : ''}`}
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
                        {credit.benefitType === 'first_order'
                          ? 'No minimum on your first order'
                          : minimum > 0 ? `Min order ₹${money(minimum)}` : 'No minimum'}
                        {expired ? ' · Expired' : credit.redeemableNow === false ? ' · Not redeemable yet' : ''}
                      </Text>
                      {!usable && !expired && credit.redeemableNow !== false && minimum > sub && (
                        <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.amber, marginTop: 2 }}>
                          Add ₹{Math.ceil(minimum - sub)} more to use this credit
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => selected ? handleRemoveReferral() : applyReferral(credit)} disabled={!selected && (!usable || expired)}
                      style={{ backgroundColor: selected ? colors.red500 : usable && !expired ? colors.primary : colors.gray200, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#fff' }}>{selected ? 'Remove' : 'Apply'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        <Modal visible={showGuestAddr} transparent animationType="slide" onRequestClose={() => setShowGuestAddr(false)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setShowGuestAddr(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 }}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray200 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Delivery address</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                No login needed — we&apos;ll save this address for your next order.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ADDRESS_LABELS.map(l => (
                  <TouchableOpacity key={l} onPress={() => setGuestAddressLabel(l)}
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', borderWidth: 1.5, borderColor: guestAddressLabel === l ? colors.primary : colors.gray200, backgroundColor: guestAddressLabel === l ? colors.primaryLight : colors.surface }}>
                    <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: guestAddressLabel === l ? colors.primary : colors.gray600 }}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={{ borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 14, padding: 14, minHeight: 90, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, textAlignVertical: 'top', backgroundColor: colors.gray50 }}
                value={guestAddrDraft} onChangeText={setGuestAddrDraft}
                placeholder="Full address, landmark, nearby store..." placeholderTextColor={colors.gray400}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={{ flex: 1, borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                  value={guestLat} onChangeText={setGuestLat} placeholder="Latitude (optional)" placeholderTextColor={colors.gray400} keyboardType="decimal-pad"
                />
                <TextInput
                  style={{ flex: 1, borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                  value={guestLng} onChangeText={setGuestLng} placeholder="Longitude (optional)" placeholderTextColor={colors.gray400} keyboardType="decimal-pad"
                />
              </View>
              <TouchableOpacity onPress={handleGuestLocate} disabled={locating}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary }}>
                {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate-outline" size={15} color={colors.primary} />}
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Use my current location</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => commitGuestAddress(guestAddressLabel, guestAddrDraft.trim(), guestLat, guestLng)}
                style={{ height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Save address</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Card>
          <TouchableOpacity onPress={() => setBillExpanded(s => !s)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14, gap: 6 }}>
            <Ionicons name="receipt-outline" size={15} color={colors.gray500} />
            <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6 }}>Bill Summary</Text>
            <Ionicons name={billExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
          </TouchableOpacity>

          {billExpanded && (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.gray100, paddingHorizontal: 14, paddingBottom: 10 }}>
              {items.map((item, i) => (
                <View key={`${item.productId}-${item.unit}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: colors.gray50 }}>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray700 }} numberOfLines={1}>{item.productName}</Text>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginHorizontal: 8 }}>{item.unit} × {item.quantity}</Text>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray900, width: 52, textAlign: 'right' }}>₹{item.price * item.quantity}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6, borderTopWidth: billExpanded ? 1 : 0, borderTopColor: colors.gray100 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600 }}>Item total</Text>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>₹{money(sub)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600 }}>Delivery charge</Text>
              <Text style={{ fontSize: 13, fontFamily: actualDelivery === 0 ? 'Inter-SemiBold' : 'Inter-Regular', color: actualDelivery === 0 ? colors.primary : colors.gray900 }}>
                {actualDelivery === 0 ? 'FREE' : `₹${money(actualDelivery)}`}
              </Text>
            </View>
            {displayedCampaignDiscount > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.primary }}>🎉 Campaign discount</Text>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>-₹{money(displayedCampaignDiscount)}</Text>
              </View>
            )}
            {referralDiscount > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.primary }}>Referral Reward</Text>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>-₹{money(referralDiscount)}</Text>
              </View>
            )}
            <View style={{ height: 1, backgroundColor: colors.gray100, marginVertical: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Total ({items.length} item{items.length > 1 ? 's' : ''})</Text>
              <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{money(total)}</Text>
            </View>
            {totalSavings > 0 && (
              <View style={{ backgroundColor: '#fef3c7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#92400e', textAlign: 'center' }}>🎉 You saved ₹{money(totalSavings)} on this order</Text>
              </View>
            )}
          </View>
        </Card>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
        <TouchableOpacity onPress={() => (isGuest
          ? setShowGuestAddr(true)
          : router.push(address
            ? { pathname: '/addresses', params: { selectForCheckout: 'true' } }
            : { pathname: '/address-form', params: { returnToCheckout: 'true' } }
          )
        )}
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 }}>
          <Ionicons name="chevron-up" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name={selectedLabel.toLowerCase() === 'home' ? 'home' : 'location'} size={16} color={colors.primary} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>
                Delivering to {selectedLabel}
              </Text>
            </View>
            {address
              ? <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }} numberOfLines={1}>{address}</Text>
              : <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>Add a delivery address to continue</Text>
            }
          </View>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>{address ? 'Change' : 'Add address'}</Text>
        </TouchableOpacity>

        <View style={{ paddingHorizontal: 16, paddingBottom: 28 }}>
          {sub < minOrder && sub > 0 && (
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 8 }}>
              Add ₹{Math.ceil(minOrder - sub)} more to reach the ₹{money(minOrder)} minimum order
            </Text>
          )}
          {deliveryIsAlwaysFree && (
            <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.primary, textAlign: 'center', marginBottom: 8 }}>
              🛵 Delivery is free on every order
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ width: '20%', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>To pay</Text>
              <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 2 }}>₹{money(total)}</Text>
            </View>
            <TouchableOpacity onPress={handlePlace} disabled={placing || !canPlace}
              style={{ flex: 1, height: 56, borderRadius: 16, backgroundColor: placing || !canPlace ? colors.gray200 : colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              {placing
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>Pay Cash / UPI</Text>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>On Delivery</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>

    </SafeAreaView>
  );
}

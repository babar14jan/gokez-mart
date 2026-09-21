import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, FlatList, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { storeApi, campaignApi, addressApi, type PublicSettings, type Product, type Address } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeColors } from '@/constants/theme';

type PayMethod = 'cod' | 'upi' | 'phonepay';
const DELIVERY_NOTES = ['Ring the bell', 'Call me when you arrive', "Don't ring the bell"];

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
  const { customer } = useAuthStore();
  const { items, updateQty, subtotal, clearCart, addItem } = useCartStore();
  const { selectedZone } = useZoneStore();

  const [settings,      setSettings]      = useState<PublicSettings | null>(null);
  const [addresses,     setAddresses]     = useState<Address[]>([]);
  const [address,       setAddress]       = useState('');
  const [note,          setNote]          = useState('Ring the bell');
  const [customNote,    setCustomNote]    = useState('');
  const [showNotes,     setShowNotes]     = useState(false);
  const [payment]                         = useState<PayMethod>('cod');
  const [placing,       setPlacing]       = useState(false);
  const [suggestions,   setSuggestions]   = useState<Product[]>([]);
  const [campaigns,     setCampaigns]     = useState<any[]>([]);
  const [appliedCamp,   setAppliedCamp]   = useState<any>(null);
  const [campDiscount,  setCampDiscount]  = useState(0);
  const [couponInput,   setCouponInput]   = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError,   setCouponError]   = useState('');
  const [showOffers,    setShowOffers]    = useState(false);
  const [billExpanded,  setBillExpanded]  = useState(false);

  // Address sheet
  const [showAddrSheet, setShowAddrSheet] = useState(false);
  const [addingNew,     setAddingNew]     = useState(false);
  const [newFlat,       setNewFlat]       = useState('');
  const [newBlock,      setNewBlock]      = useState('');
  const [newStreet,     setNewStreet]     = useState('');
  const [newPincode,    setNewPincode]    = useState('');
  const [savingAddr,    setSavingAddr]    = useState(false);

  const loadAddresses = () => addressApi.list().then(r => {
    const list = r.data.data ?? [];
    setAddresses(list);
    if (!address) {
      const def = list.find(a => a.isDefault) ?? list[0];
      if (def) setAddress(def.addressLine);
      else { setAddingNew(true); setShowAddrSheet(true); }
    }
  }).catch(() => {});

  useEffect(() => { loadAddresses(); }, []);

  const selectedLabel = addresses.find(a => a.addressLine === address)?.label ?? 'Delivery Address';

  const sub            = subtotal();
  const deliveryCharge = parseFloat(settings?.delivery_charge ?? '30');
  const freeAbove      = parseFloat(settings?.free_delivery_above ?? '299');
  const minOrder       = parseFloat(settings?.min_order_amount ?? '50');
  const actualDelivery = appliedCamp?.discount_type === 'free_delivery' ? 0 : (sub >= freeAbove ? 0 : deliveryCharge);
  const total          = Math.max(0, sub + actualDelivery - campDiscount);
  const cartProductIds = new Set(items.map(i => i.productId));

  useEffect(() => {
    storeApi.getSettings(selectedZone?.storeId).then(r => setSettings(r.data.data)).catch(() => {});
    if (selectedZone?.storeId) {
      campaignApi.getEligible(sub, selectedZone.storeId).then(r => {
        const list = r.data.data ?? [];
        setCampaigns(list);
        const auto = list.find((c: any) => !c.coupon_code);
        if (auto && !appliedCamp) applyDiscount(auto, sub);
      }).catch(() => {});
    }
    storeApi.getProducts(undefined, selectedZone?.storeId).then(r => {
      const all = r.data.data.filter(p => p.availabilityStatus === 'available' && !cartProductIds.has(p.id));
      const cartCatIds = new Set(items.map(i => {
        const p = r.data.data.find((x: Product) => x.id === i.productId);
        return p?.categoryId;
      }).filter(Boolean));
      const related = all.filter(p => cartCatIds.has(p.categoryId)).slice(0, 8);
      setSuggestions(related.length >= 3 ? related : all.slice(0, 8));
    }).catch(() => {});
  }, []);

  const applyDiscount = (camp: any, cartTotal: number) => {
    let disc = 0;
    if (camp.discount_type === 'flat') disc = Math.min(parseFloat(camp.discount_value), cartTotal);
    else if (camp.discount_type === 'percent') {
      disc = (cartTotal * parseFloat(camp.discount_value)) / 100;
      if (camp.max_discount) disc = Math.min(disc, parseFloat(camp.max_discount));
    }
    setAppliedCamp(camp); setCampDiscount(Math.round(disc));
  };

  const removeCampaign = () => { setAppliedCamp(null); setCampDiscount(0); setCouponInput(''); setCouponError(''); };

  const validateCoupon = async () => {
    if (!couponInput.trim() || !selectedZone?.storeId) return;
    setCouponLoading(true); setCouponError('');
    try {
      const res = await campaignApi.validateCode(couponInput.trim(), sub, selectedZone.storeId);
      const { campaign, discount } = res.data.data;
      setAppliedCamp(campaign); setCampDiscount(discount); setCouponInput(''); setShowOffers(false);
    } catch (e: any) {
      setCouponError(e?.response?.data?.error ?? 'Invalid coupon code');
    } finally { setCouponLoading(false); }
  };

  const saveNewAddress = async () => {
    const val = [newFlat, newBlock, newStreet, newPincode].filter(Boolean).join(', ');
    if (!val.trim()) return;
    setSavingAddr(true);
    try {
      const label = addresses.length === 0 ? 'Home' : 'Other';
      const res = await addressApi.add(label, val);
      setAddress(res.data.data.addressLine);
      await loadAddresses();
      setNewFlat(''); setNewBlock(''); setNewStreet(''); setNewPincode('');
      setAddingNew(false);
      setShowAddrSheet(false);
    } catch { Alert.alert('Error', 'Failed to save address.'); }
    finally { setSavingAddr(false); }
  };

  const handlePlace = async () => {
    if (!address.trim()) { Alert.alert('Add delivery address', 'Please add a delivery address to continue.'); setShowAddrSheet(true); return; }
    if (!customer) { router.push('/(auth)/login'); return; }
    if (sub < minOrder) { Alert.alert('Minimum order', `Add ₹${Math.ceil(minOrder - sub)} more to place order.`); return; }
    setPlacing(true);
    try {
      const res = await storeApi.placeOrder({
        guestName: customer.name ?? customer.phone,
        guestPhone: customer.phone,
        guestAddress: address.trim(),
        deliveryNote: customNote.trim() || note,
        paymentMethod: payment,
        storeId: selectedZone?.storeId,
        zoneName: selectedZone?.name,
        campaignId: appliedCamp?.id,
        couponCode: appliedCamp?.coupon_code,
        items: items.map(i => ({ productId: i.productId, productName: i.productName, unit: i.unit, price: i.price, quantity: i.quantity })),
      });
      clearCart();
      const orderId = res.data.data?.id;
      router.replace(orderId ? `/order/${orderId}` : '/(tabs)/orders');
    } catch {
      Alert.alert('Order failed', 'Failed to place order. Please try again.');
    } finally { setPlacing(false); }
  };

  const canPlace = items.length > 0 && sub >= minOrder && address.trim().length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 140 }}>

        {/* Items */}
        <Card>
          <SectionTitle icon="bag-outline" title={`${items.length} Items`} />
          {items.map((item) => (
            <View key={`${item.productId}-${item.unit}`} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
              <Image source={{ uri: item.photoUrl ?? undefined }} style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.gray100 }} contentFit="cover" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.gray900 }} numberOfLines={1}>{item.productName}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{item.unit} · ₹{item.price}</Text>
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
          {actualDelivery > 0 && (
            <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#d1fae5' }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.primary, textAlign: 'center' }}>
                🎉 Add ₹{Math.ceil(freeAbove - sub)} more for free delivery
              </Text>
            </View>
          )}
          {/* Missed something row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Missed something?</Text>
            <TouchableOpacity onPress={() => router.back()}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.black, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}>
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' }}>Add more items</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* You may also like — right after items */}
        {suggestions.length > 0 && (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900, marginHorizontal: 16, marginBottom: 10 }}>You may also like</Text>
            <FlatList
              data={suggestions} keyExtractor={p => p.id} horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item: p }) => (
                <View style={{ width: 120, backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
                  <Image source={{ uri: p.photoUrl ?? undefined }} style={{ width: 120, height: 100, backgroundColor: colors.gray100 }} contentFit="cover" />
                  <View style={{ padding: 8 }}>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.gray900, lineHeight: 15 }} numberOfLines={2}>{p.name}</Text>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{p.unit}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.primary }}>₹{p.price}</Text>
                      <TouchableOpacity onPress={() => addItem(p)}
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

        {/* Delivery note — Zepto style: title+subtitle row, opens bottom sheet */}
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
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray200 }} />
            </View>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.gray700} />
              </View>
              <View>
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Delivery instructions</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>How should we handle your delivery?</Text>
              </View>
            </View>
            {/* Options */}
            <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
              {DELIVERY_NOTES.map(n => (
                <TouchableOpacity key={n} onPress={() => { setNote(n); setCustomNote(''); setShowNotes(false); }}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: note === n && !customNote ? colors.black : colors.gray200, backgroundColor: note === n && !customNote ? colors.black : colors.surface, gap: 12 }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: note === n && !customNote ? '#fff' : colors.gray800, flex: 1 }}>{n}</Text>
                  {note === n && !customNote && <Ionicons name="checkmark" size={18} color="#fff" />}
                </TouchableOpacity>
              ))}
              {/* Custom */}
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

        {/* Offers */}
        {(campaigns.length > 0 || appliedCamp) && (
          <Card>
            <TouchableOpacity onPress={() => setShowOffers(s => !s)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ionicons name="pricetag-outline" size={17} color="#7c3aed" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>
                  {appliedCamp ? `🎉 ${appliedCamp.title}` : `${campaigns.length} offer${campaigns.length > 1 ? 's' : ''} available`}
                </Text>
                {campDiscount > 0 && <Text style={{ fontSize: 11, color: colors.primary, fontFamily: 'Inter-Regular', marginTop: 1 }}>Saving ₹{campDiscount}</Text>}
              </View>
              {appliedCamp
                ? <TouchableOpacity onPress={removeCampaign}><Ionicons name="close-circle" size={20} color={colors.gray400} /></TouchableOpacity>
                : <Ionicons name={showOffers ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
              }
            </TouchableOpacity>
            {showOffers && !appliedCamp && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.gray100, padding: 12, gap: 8 }}>
                {campaigns.map((c: any) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.gray100, borderRadius: 12, padding: 10, gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900 }}>{c.badge_text} {c.title}</Text>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{c.subtitle}</Text>
                      {c.coupon_code && <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: '#7c3aed', marginTop: 2 }}>{c.coupon_code}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => { applyDiscount(c, sub); setShowOffers(false); }}
                      style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.primary }}>Apply</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={{ flex: 1, borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                    value={couponInput} onChangeText={t => setCouponInput(t.toUpperCase())}
                    placeholder="Enter coupon code" placeholderTextColor={colors.gray400}
                  />
                  <TouchableOpacity onPress={validateCoupon} disabled={couponLoading || !couponInput.trim()}
                    style={{ backgroundColor: '#7c3aed', paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                    {couponLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' }}>Apply</Text>}
                  </TouchableOpacity>
                </View>
                {couponError ? <Text style={{ fontSize: 12, color: colors.red500, fontFamily: 'Inter-Regular' }}>{couponError}</Text> : null}
              </View>
            )}
          </Card>
        )}

        {/* Bill */}
        <Card>
          <TouchableOpacity onPress={() => setBillExpanded(s => !s)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14, gap: 6 }}>
            <Ionicons name="receipt-outline" size={15} color={colors.gray500} />
            <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6 }}>Bill Summary</Text>
            <Ionicons name={billExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
          </TouchableOpacity>

          {/* Per-item breakdown — expandable */}
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
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600 }}>Delivery charge</Text>
              <Text style={{ fontSize: 13, fontFamily: actualDelivery === 0 ? 'Inter-SemiBold' : 'Inter-Regular', color: actualDelivery === 0 ? colors.primary : colors.gray900 }}>
                {actualDelivery === 0 ? 'FREE' : `₹${actualDelivery}`}
              </Text>
            </View>
            {campDiscount > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.primary }}>🎉 Discount</Text>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>-₹{campDiscount}</Text>
              </View>
            )}
            <View style={{ height: 1, backgroundColor: colors.gray100, marginVertical: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Total ({items.length} item{items.length > 1 ? 's' : ''})</Text>
              <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{total}</Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* Sticky bottom — address + pay */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.gray100 }}>

        {/* Address row — tappable, expands sheet */}
        <TouchableOpacity onPress={() => setShowAddrSheet(true)}
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
              : <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.red500, marginTop: 2 }}>Add delivery address</Text>
            }
          </View>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Change</Text>
        </TouchableOpacity>

        <View style={{ paddingHorizontal: 16, paddingBottom: 28 }}>
          {sub < minOrder && sub > 0 && (
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500, textAlign: 'center', marginBottom: 8 }}>
              Add ₹{Math.ceil(minOrder - sub)} more for minimum order ₹{minOrder}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            {/* To pay — 1/5 width */}
            <View style={{ width: '20%', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>To pay</Text>
              <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 2 }}>₹{total}</Text>
            </View>
            {/* Pay button — rest of width */}
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

      {/* Address sheet */}
      {/* Address bottom sheet — same as profile */}
      <Modal visible={showAddrSheet} transparent animationType="slide" onRequestClose={() => { setShowAddrSheet(false); setAddingNew(false); }}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => { setShowAddrSheet(false); setAddingNew(false); }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36 }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray200 }} />
            </View>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, paddingHorizontal: 20, paddingVertical: 14 }}>Manage Address</Text>

            {!addingNew ? (
              <>
                {addresses.map(a => (
                  <TouchableOpacity key={a.id} onPress={() => { setAddress(a.addressLine); setShowAddrSheet(false); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: address === a.addressLine ? colors.primaryLight : colors.gray50, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={a.label.toLowerCase() === 'home' ? 'home-outline' : a.label.toLowerCase() === 'work' ? 'briefcase-outline' : 'location-outline'}
                        size={20} color={address === a.addressLine ? colors.primary : colors.gray500} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{a.label}</Text>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }} numberOfLines={1}>{a.addressLine}</Text>
                    </View>
                    {address === a.addressLine && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={() => setAddingNew(true)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="add-circle-outline" size={20} color={colors.gray600} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>Add new address</Text>
                    <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>Save a new delivery location</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.gray300} />
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                  <TextInput style={{ flex: 1, borderWidth: 1, borderColor: colors.gray200, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                    value={newFlat} onChangeText={setNewFlat} placeholder="Flat / House No." placeholderTextColor={colors.gray400} autoFocus />
                  <TextInput style={{ flex: 1, borderWidth: 1, borderColor: colors.gray200, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50 }}
                    value={newBlock} onChangeText={setNewBlock} placeholder="Block / Tower" placeholderTextColor={colors.gray400} />
                </View>
                <TextInput style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50, marginBottom: 10 }}
                  value={newStreet} onChangeText={setNewStreet} placeholder="Street / Area" placeholderTextColor={colors.gray400} />
                <TextInput style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, backgroundColor: colors.gray50, marginBottom: 12 }}
                  value={newPincode} onChangeText={setNewPincode} placeholder="Pincode" placeholderTextColor={colors.gray400} keyboardType="number-pad" maxLength={6} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => { setAddingNew(false); setNewFlat(''); setNewBlock(''); setNewStreet(''); setNewPincode(''); }}
                    style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveNewAddress} disabled={savingAddr || !(newFlat || newStreet)}
                    style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: (newFlat || newStreet) ? colors.primary : colors.gray200, alignItems: 'center', justifyContent: 'center' }}>
                    {savingAddr ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Save & Use</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

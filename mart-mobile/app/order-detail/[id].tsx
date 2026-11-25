import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { authApi, storeApi, type Order, type Product } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { colors as staticColors, useThemeColors } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { getTokens, saveToken, useGuestTrackingStore } from '@/store/guestTrackingStore';
import {
  ALL_CLOSED, ORDER_PROGRESS_LABELS, STATUS_LABELS,
  formatDateTime, statusProgressIndex,
} from '@/utils/orderStatus';
import { calculateOrderSavings, getOrderReferralDiscount } from '@/utils/referral';
import { downloadReceipt } from '@/utils/receipt';
import { track } from '@/utils/track';

const MAX_REORDER_ITEMS = 10;
const GUEST_ORDER_HINT = 'Sign in or open the order link from your confirmation to view this order.';

const CANCEL_REASONS: Array<{ value: string; label: string }> = [
  { value: 'ordered_by_mistake', label: 'Ordered by mistake' },
  { value: 'changed_my_mind', label: 'Changed my mind' },
  { value: 'wrong_address', label: 'Wrong address or delivery details' },
  { value: 'duplicate_order', label: 'Duplicate order' },
  { value: 'found_better_price', label: 'Found a better price elsewhere' },
  { value: 'delivery_too_slow', label: 'Delivery is taking too long' },
  { value: 'other', label: 'Other' },
];

const CANCELLATION_REASON_LABELS: Record<string, string> = {
  customer_request: 'This order was cancelled as requested.',
  ordered_by_mistake: 'This order was cancelled because it looked like it was placed by mistake.',
  changed_my_mind: 'This order was cancelled as requested.',
  wrong_address: 'This order was cancelled because the delivery details were wrong.',
  found_better_price: 'This order was cancelled as requested.',
  delivery_too_slow: 'This order was cancelled as requested.',
  duplicate_order: 'This order was cancelled because it appeared to be a duplicate.',
  out_of_stock: 'This order was cancelled because some items became unavailable. You will not be charged.',
  store_closed: 'This order was cancelled because the store had to close unexpectedly. You will not be charged.',
  outside_area: "This order was cancelled because your address is outside our delivery area right now. We're expanding soon and will be in your area! 🌱",
  incorrect_address: 'This order was cancelled because the delivery address was incorrect. You will not be charged.',
  rider_unavailable: 'This order was cancelled because no delivery partner was available. You will not be charged.',
  technical_issue: 'This order was cancelled due to a technical issue. You will not be charged.',
  other: 'This order was cancelled. You will not be charged.',
};

function statusLabel(status: string | null | undefined): string {
  const key = String(status ?? '');
  return (STATUS_LABELS[key] ?? key) || 'Order';
}

function progressStep(status: string): number {
  const index = statusProgressIndex(status);
  if (index < 0) return -1;
  if (index <= 1) return 0;
  if (index <= 3) return 1;
  if (index <= 5) return 2;
  return 3;
}

function cancelModeFor(status: string): 'direct' | 'request' | null {
  if (status === 'pending' || status === 'confirmed') return 'direct';
  if (status === 'preparing' || status === 'ready_to_pickup') return 'request';
  return null;
}

function errorText(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  const message = response?.error ?? response?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function extractOrders(response: unknown): Order[] {
  const data = (response as { data?: { data?: unknown } })?.data?.data;
  return Array.isArray(data) ? data as Order[] : [];
}

function extractProducts(response: unknown): Product[] {
  const data = (response as { data?: { data?: unknown } })?.data?.data;
  return Array.isArray(data) ? data as Product[] : [];
}

function rememberTokens(orders: Order[]): void {
  orders.forEach(entry => {
    if (typeof entry.trackingToken === 'string' && entry.trackingToken.trim()) {
      saveToken(entry.trackingToken);
    }
  });
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const colors = useThemeColors();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 16, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100, ...style }}>
      {children}
    </View>
  );
}

function CardHeader({ title, icon }: { title: string; icon: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons name={icon as any} size={15} color={colors.gray500} />
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</Text>
    </View>
  );
}

function BillRow({ label, value, bold, green, strike }: {
  label: string; value: string; bold?: boolean; green?: boolean; strike?: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 5 }}>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: green ? colors.primary : bold ? colors.gray900 : colors.gray600 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {strike ? <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, textDecorationLine: 'line-through' }}>{strike}</Text> : null}
        <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: green ? colors.primary : colors.gray900 }}>{value}</Text>
      </View>
    </View>
  );
}

export default function OrderDetailScreen() {
  const colors = useThemeColors();
  const { id, trackingToken } = useLocalSearchParams<{ id: string; trackingToken?: string }>();
  const { addItem } = useCartStore();
  const { isLoggedIn } = useAuthStore();
  const tokens = useGuestTrackingStore(state => state.tokens);
  const tokenKey = tokens.join(',');

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    if (!isLoggedIn && typeof trackingToken === 'string' && trackingToken.trim()) {
      saveToken(trackingToken.trim());
    }
  }, [isLoggedIn, trackingToken]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoadError('');
    try {
      let list: Order[] = [];
      if (isLoggedIn) {
        list = extractOrders(await authApi.getOrders());
      } else {
        const tokenList = getTokens();
        if (!tokenList.length) {
          setOrder(null);
          return [];
        }
        list = extractOrders(await storeApi.trackOrdersByTokens(tokenList));
      }
      rememberTokens(list);
      setOrder(list.find(entry => entry.id === id) ?? null);
      return list;
    } catch (error) {
      if (!silent) setLoadError(errorText(error, 'We could not load your order. Please try again.'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [id, isLoggedIn, tokenKey]);

  useEffect(() => { void load(); }, [load]);

  const handleCancel = async () => {
    if (!order) return;
    const mode = cancelModeFor(order.status);
    if (!mode) return;
    if (!cancelReason) {
      setCancelError('Choose a reason before continuing.');
      return;
    }
    if (!isLoggedIn && !order.trackingToken) {
      const message = GUEST_ORDER_HINT;
      setCancelError(message);
      Alert.alert('Cannot cancel order', message);
      return;
    }
    setCancelling(true);
    setCancelError('');
    try {
      if (isLoggedIn) {
        if (mode === 'request') await authApi.requestCancellation(order.id, cancelReason);
        else await authApi.cancelOrder(order.id, cancelReason);
      } else {
        const token = order.trackingToken as string;
        if (mode === 'request') await storeApi.requestCancellationByToken(order.id, token, cancelReason);
        else await storeApi.cancelOrderByToken(order.id, token, cancelReason);
      }
      track('order_cancelled', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        reason: cancelReason,
        method: mode === 'request' ? 'request' : 'direct',
        guest: !isLoggedIn,
      });
      await load(true);
      if (mode === 'direct') setConfirmCancel(false);
      Alert.alert(
        mode === 'request' ? 'Request sent' : 'Order cancelled',
        mode === 'request'
          ? 'The store will review your cancellation request before dispatch.'
          : 'Your order has been cancelled. You will not be charged.',
      );
    } catch (error) {
      const message = errorText(error, mode === 'request'
        ? 'Could not request cancellation. Please contact the store for help.'
        : 'Could not cancel this order. Please contact the store for help.');
      setCancelError(message);
      Alert.alert(mode === 'request' ? 'Request failed' : 'Cancellation failed', message);
    } finally {
      setCancelling(false);
    }
  };

  const handleOrderAgain = async () => {
    if (!order) return;
    if (!isLoggedIn) {
      Alert.alert('Login required', 'Login to add these items to your cart.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/(auth)/login') },
      ]);
      return;
    }
    setReordering(true);
    try {
      let catalog: Product[] = [];
      try {
        catalog = extractProducts(await storeApi.getProducts());
      } catch {}
      const byId = new Map(catalog.map(product => [product.id, product]));
      const cartItems = useCartStore.getState().items.filter(item => !item.unavailable);
      const distinct = new Set(cartItems.map(item => item.productId));
      let added = 0;
      let skippedLimit = 0;
      let skippedUnit = 0;
      for (const item of order.items.slice(0, MAX_REORDER_ITEMS)) {
        if (cartItems.some(cart => cart.productId === item.productId && cart.unit !== item.unit)) {
          skippedUnit += 1;
          continue;
        }
        if (!distinct.has(item.productId)) {
          if (distinct.size >= MAX_REORDER_ITEMS) {
            skippedLimit += 1;
            continue;
          }
          distinct.add(item.productId);
        }
        const product = byId.get(item.productId);
        if (product) {
          const option = (product.weightOptions ?? []).find(weight => weight.label === item.unit);
          const unit = product.unit === item.unit || option ? item.unit : product.unit;
          const price = option?.price ?? (product.unit === item.unit ? product.price : item.price);
          const listPrice = product.mrp ?? product.price ?? price;
          addItem(product, unit, price, listPrice);
        } else {
          addItem({
            id: item.productId, name: item.productName, localName: null, description: null,
            photoUrl: item.photoUrl ?? null, price: item.price, unit: item.unit,
            weightOptions: null, discountPercent: 0, isAvailable: true,
            availabilityStatus: 'available', categoryId: '', categoryName: '',
            mrp: item.price,
          });
        }
        added += 1;
      }
      const warnings: string[] = [];
      if (skippedLimit) warnings.push(`${skippedLimit} skipped — your cart can hold ${MAX_REORDER_ITEMS} distinct items`);
      if (skippedUnit) warnings.push(`${skippedUnit} skipped — remove the other size from your cart first`);
      Alert.alert(
        warnings.length ? 'Cart updated' : 'Added to cart',
        `${added} item${added === 1 ? '' : 's'} added${warnings.length ? `. ${warnings.join('. ')}.` : '.'}`,
      );
      if (!warnings.length) router.back();
    } finally {
      setReordering(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 14, color: colors.gray500, fontFamily: 'Inter-Regular', textAlign: 'center' }}>
          {loadError || (!isLoggedIn && !tokens.length ? GUEST_ORDER_HINT : 'Order not found')}
        </Text>
        {loadError ? (
          <TouchableOpacity onPress={() => { void load(); }} style={{ marginTop: 14, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
            <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 13 }}>Try Again</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const step = progressStep(order.status);
  const isDelivered = order.status === 'delivered';
  const isClosed = ALL_CLOSED.includes(order.status);
  const statusColor = isClosed ? (isDelivered ? colors.primary : staticColors.red500) : colors.primary;
  const itemSavings = Math.max(0, Number(order.itemSavings) || 0);
  const freeDeliverySaving = Math.max(0, Number(order.freeDeliverySaving) || 0);
  const campaign = Math.max(0, Number(order.campaignDiscount) || 0);
  const referral = getOrderReferralDiscount(order as unknown as Record<string, unknown>);
  const savings = calculateOrderSavings(order);
  const cancelMode = cancelModeFor(order.status);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}>
        {loadError ? (
          <TouchableOpacity onPress={() => { void load(); }} style={{ backgroundColor: colors.redLight, borderRadius: 10, padding: 10, marginHorizontal: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>{loadError} Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        <Card>
          <View style={{ padding: 16, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            {(order.storeName ?? order.fulfilledBy) ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fulfilled by</Text>
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 2 }}>{order.storeName ?? order.fulfilledBy}</Text>
                {order.storeAddress ? (
                  <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2, lineHeight: 15 }}>{order.storeAddress}</Text>
                ) : null}
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: statusColor }}>{statusLabel(order.status)}</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 3 }}>{formatDateTime(order.createdAt)}</Text>
              </View>
            )}
            <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
              <View style={{ backgroundColor: statusColor + '15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: statusColor }}>#{order.orderNumber}</Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: statusColor, marginTop: 6 }}>{statusLabel(order.status)}</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{formatDateTime(order.createdAt)}</Text>
            </View>
          </View>

          {!isClosed && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {ORDER_PROGRESS_LABELS.map((label, i) => (
                  <Text key={label} style={{
                    fontSize: 9, fontFamily: i <= step ? 'Inter-Bold' : 'Inter-Regular',
                    color: i <= step ? colors.primary : colors.gray400,
                    textAlign: 'center', width: '25%',
                  }}>{label}</Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', marginTop: 6, gap: 4 }}>
                {ORDER_PROGRESS_LABELS.map((label, i) => (
                  <View key={label} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.primary : colors.gray200 }} />
                ))}
              </View>
            </View>
          )}

          {order.status !== 'delivered' && order.cancellationReason && (
            <View style={{ marginHorizontal: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#fef2f2', borderRadius: 8, padding: 10 }}>
              <Ionicons name="close-circle-outline" size={14} color={staticColors.red500} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: staticColors.red500, lineHeight: 16 }}>
                {CANCELLATION_REASON_LABELS[order.cancellationReason] ?? 'This order was cancelled. You will not be charged.'}
              </Text>
            </View>
          )}
          {order.placedOutsideHours && (
            <View style={{ marginHorizontal: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fef3c7', borderRadius: 8, padding: 10 }}>
              <Ionicons name="time-outline" size={14} color="#f59e0b" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: '#92400e' }}>
                  {order.closedReason === 'manual' ? 'Store was manually closed' : 'Ordered outside store hours'}
                </Text>
                {order.scheduledForLabel && (
                  <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: '#92400e', marginTop: 2 }}>
                    Will be prepared at {order.scheduledForLabel}
                  </Text>
                )}
              </View>
            </View>
          )}
        </Card>

        <Card>
          <CardHeader title="Items Ordered" icon="bag-outline" />
          <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
            {order.items.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.gray100 }}>
                <Image
                  source={{ uri: item.photoUrl ?? undefined }}
                  style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.gray100 }}
                  contentFit="cover"
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-Medium', color: colors.gray900 }} numberOfLines={2}>{item.productName}</Text>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
                    {item.unit}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{item.total ?? item.price * item.quantity}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <CardHeader title="Bill Details" icon="receipt-outline" />
          <View style={{ paddingBottom: 14 }}>
            {savings > 0 && (
              <View style={{ backgroundColor: '#fef3c7', borderRadius: 10, paddingVertical: 8, marginHorizontal: 14, marginBottom: 10 }}>
                <Text style={{ textAlign: 'center', fontSize: 13, fontFamily: 'Inter-Bold', color: '#92400e' }}>
                  🎉 You saved ₹{savings.toFixed(0)} on this order
                </Text>
              </View>
            )}
            <BillRow label="Item total" value={`₹${order.subtotal}`} strike={itemSavings > 0 ? `₹${(Number(order.subtotal) + itemSavings).toFixed(0)}` : undefined} />
            <BillRow label="Delivery charge" value={order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}
              green={order.deliveryCharge === 0}
              strike={freeDeliverySaving > 0 ? `₹${freeDeliverySaving.toFixed(0)}` : undefined} />
            {campaign > 0 && (
              <BillRow
                label={order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'}
                value={`-₹${campaign.toFixed(0)}`}
                green
              />
            )}
            {referral > 0 && <BillRow label="Referral Reward" value={`-₹${referral.toFixed(0)}`} green />}
            <View style={{ height: 1, backgroundColor: colors.gray100, marginHorizontal: 14, marginVertical: 6 }} />
            <BillRow label="Total Paid" value={`₹${order.total}`} bold />
            <View style={{ paddingHorizontal: 14, paddingTop: 4 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
                Paid via <Text style={{ fontFamily: 'Inter-SemiBold', textTransform: 'uppercase' }}>{order.paymentMethod}</Text>
              </Text>
            </View>
          </View>
        </Card>

        <Card>
          <CardHeader title="Delivery Address" icon="location-outline" />
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Ionicons name="home-outline" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {(order.guestName || order.guestPhone) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {order.guestName ? (
                    <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900, flexShrink: 1 }} numberOfLines={1}>{order.guestName}</Text>
                  ) : <View />}
                  {order.guestPhone ? (
                    <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, flexShrink: 0 }}>{order.guestPhone}</Text>
                  ) : null}
                </View>
              ) : null}
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray700, lineHeight: 20, marginTop: (order.guestName || order.guestPhone) ? 4 : 0 }}>{order.guestAddress}</Text>
            </View>
          </View>
        </Card>

        {cancelMode && (
          <Card>
            <CardHeader title="Cancellation" icon="alert-circle-outline" />
            {confirmCancel ? (
              <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500, marginBottom: 8 }}>
                  Why are you {cancelMode === 'request' ? 'requesting cancellation' : 'cancelling this order'}?
                </Text>
                <View style={{ gap: 6, marginBottom: 10 }}>
                  {CANCEL_REASONS.map(reason => {
                    const selected = cancelReason === reason.value;
                    return (
                      <TouchableOpacity key={reason.value}
                        onPress={() => setCancelReason(reason.value)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, borderWidth: 1, borderColor: selected ? colors.red500 : colors.gray200, paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={16} color={selected ? colors.red500 : colors.gray400} />
                        <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray700 }}>{reason.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity onPress={() => { void handleCancel(); }} disabled={!cancelReason || cancelling}
                  style={{ backgroundColor: colors.red500, borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: (!cancelReason || cancelling) ? 0.5 : 1 }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter-Bold' }}>
                    {cancelling ? 'Please wait...' : cancelMode === 'request' ? 'Request cancellation' : 'Cancel order'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setConfirmCancel(false); setCancelReason(''); setCancelError(''); }} style={{ paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Keep order</Text>
                </TouchableOpacity>
                {cancelError ? <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.red500, textAlign: 'center' }}>{cancelError}</Text> : null}
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setCancelError(''); setCancelReason(''); setConfirmCancel(true); }}
                style={{ paddingHorizontal: 14, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="close-circle-outline" size={16} color={colors.red500} />
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.red500 }}>
                  {cancelMode === 'request' ? 'Request cancellation' : 'Cancel Order'}
                </Text>
              </TouchableOpacity>
            )}
          </Card>
        )}

        {isDelivered && (
          <Card>
            <CardHeader title="Receipt" icon="document-text-outline" />
            <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, lineHeight: 18 }}>
                This is a purchase receipt for your order. Not a GST invoice.
              </Text>
              <TouchableOpacity
                onPress={() => { void downloadReceipt(order); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 14, paddingVertical: 12, marginTop: 12 }}
              >
                <Ionicons name="receipt-outline" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Download Receipt</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        <View style={{ marginHorizontal: 16, gap: 10 }}>
          <TouchableOpacity
            onPress={() => { void handleOrderAgain(); }}
            disabled={reordering}
            style={{ height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: reordering ? 0.6 : 1 }}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>{reordering ? 'Adding...' : 'Order Again'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ height: 48, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gray200 }}
          >
            <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>Back to Orders</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

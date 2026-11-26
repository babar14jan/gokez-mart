import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { authApi, storeApi, type Order } from '@/services/api';
import { useThemeColors } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { getTokens, saveToken, useGuestTrackingStore } from '@/store/guestTrackingStore';
import {
  ALL_CLOSED, ORDER_PROGRESS_LABELS, STATUS_LABELS,
  formatDateTime, statusProgressIndex,
} from '@/utils/orderStatus';
import { calculateOrderSavings, getOrderReferralDiscount } from '@/utils/referral';
import { downloadReceipt } from '@/utils/receipt';
import { track } from '@/utils/track';

const STEP_ICONS = ['✅', '🍳', '🛵', '🎉'];
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

function rememberTokens(orders: Order[]): void {
  orders.forEach(entry => {
    if (typeof entry.trackingToken === 'string' && entry.trackingToken.trim()) {
      saveToken(entry.trackingToken);
    }
  });
}

function BillRow({ label, value, green, bold, strike }: {
  label: string; value: string; green?: boolean; bold?: boolean; strike?: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: green ? colors.primary : colors.gray600 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {strike ? <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, textDecorationLine: 'line-through' }}>{strike}</Text> : null}
        <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: bold ? colors.gray900 : green ? colors.primary : colors.gray900 }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export default function OrderTrackingScreen() {
  const colors = useThemeColors();
  const { id, trackingToken } = useLocalSearchParams<{ id: string; trackingToken?: string }>();
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

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(true); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 14, color: colors.gray500, fontFamily: 'Inter-Regular', textAlign: 'center' }}>
          {loadError || (!isLoggedIn && !tokens.length ? GUEST_ORDER_HINT : 'Order not found')}
        </Text>
        {loadError ? (
          <TouchableOpacity onPress={() => { void load(); }} style={{ marginTop: 14, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
            <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 13 }}>Try Again</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter-Medium' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const step = progressStep(order.status);
  const isClosed = ALL_CLOSED.includes(order.status);
  const itemSavings = Math.max(0, Number(order.itemSavings) || 0);
  const freeDeliverySaving = Math.max(0, Number(order.freeDeliverySaving) || 0);
  const campaign = Math.max(0, Number(order.campaignDiscount) || 0);
  const referral = getOrderReferralDiscount(order as unknown as Record<string, unknown>);
  const savings = calculateOrderSavings(order);
  const cancelMode = cancelModeFor(order.status);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {loadError ? (
          <TouchableOpacity onPress={() => { void load(); }} style={{ backgroundColor: colors.redLight, borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>{loadError} Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.gray100 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: isClosed ? colors.red500 : colors.primary, marginBottom: 4 }}>
            {statusLabel(order.status)}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 16 }}>
            #{order.orderNumber} · {formatDateTime(order.createdAt)}
          </Text>
          {!isClosed && ORDER_PROGRESS_LABELS.map((label, i) => {
            const done = i <= step;
            const current = i === step;
            return (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ alignItems: 'center', marginRight: 12, width: 24 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: done ? colors.primary : colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, color: '#fff', fontFamily: 'Inter-Bold' }}>{done ? '✓' : ''}</Text>
                  </View>
                  {i < ORDER_PROGRESS_LABELS.length - 1 && (
                    <View style={{ width: 2, flex: 1, minHeight: 24, backgroundColor: done ? colors.primary : colors.gray200 }} />
                  )}
                </View>
                <View style={{ paddingBottom: 16, flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: current ? 'Inter-SemiBold' : 'Inter-Regular', color: done ? colors.gray900 : colors.gray400 }}>
                    {STEP_ICONS[i]} {label}
                  </Text>
                </View>
              </View>
            );
          })}
          {order.cancellationReason && (
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500, marginTop: 6 }}>
              Reason: {order.cancellationReason.replace(/_/g, ' ')}
            </Text>
          )}
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.gray100 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 12 }}>Items</Text>
          {order.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.gray100 }}>
              <Image source={{ uri: item.photoUrl ?? undefined }} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.gray100 }} contentFit="cover" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.gray900 }} numberOfLines={1}>{item.productName}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{item.unit} × {item.quantity}</Text>
              </View>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>₹{item.total ?? item.price * item.quantity}</Text>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.gray100 }}>
          {savings > 0 && (
            <View style={{ backgroundColor: '#fef3c7', borderRadius: 10, paddingVertical: 8, marginBottom: 12 }}>
              <Text style={{ textAlign: 'center', fontSize: 13, fontFamily: 'Inter-Bold', color: '#92400e' }}>
                🎉 You saved ₹{savings.toFixed(0)} on this order
              </Text>
            </View>
          )}
          <BillRow label="Subtotal" value={`₹${order.subtotal}`} strike={itemSavings > 0 ? `₹${(Number(order.subtotal) + itemSavings).toFixed(0)}` : undefined} />
          <BillRow label="Delivery" value={order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}
            green={order.deliveryCharge === 0}
            strike={freeDeliverySaving > 0 ? `₹${freeDeliverySaving.toFixed(0)}` : undefined} />
          {campaign > 0 && (
            <BillRow label={order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'} value={`-₹${campaign.toFixed(0)}`} green />
          )}
          {referral > 0 && <BillRow label="Referral Reward" value={`-₹${referral.toFixed(0)}`} green />}
          <View style={{ height: 1, backgroundColor: colors.gray100, marginVertical: 8 }} />
          <BillRow label="Total" value={`₹${order.total}`} bold />
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, marginTop: 6 }}>
            Payment: {order.paymentMethod.toUpperCase()}
            {order.storeName ? `  ·  Fulfilled by ${order.storeName}` : ''}
          </Text>
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.gray100 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>📍 Delivery Address</Text>
          {order.guestName ? <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{order.guestName}</Text> : null}
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 18 }}>{order.guestAddress}</Text>
        </View>

        {cancelMode && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.gray100 }}>
            {confirmCancel ? (
              <View>
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
                  style={{ backgroundColor: colors.red500, borderRadius: 10, paddingVertical: 10, alignItems: 'center', opacity: (!cancelReason || cancelling) ? 0.5 : 1 }}>
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
              <TouchableOpacity onPress={() => { setCancelError(''); setCancelReason(''); setConfirmCancel(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="close-circle-outline" size={16} color={colors.red500} />
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.red500 }}>
                  {cancelMode === 'request' ? 'Request cancellation' : 'Cancel Order'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {order.status === 'delivered' && (
          <TouchableOpacity
            onPress={() => { void downloadReceipt(order); }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 14, paddingVertical: 14, marginTop: 12 }}
          >
            <Ionicons name="receipt-outline" size={18} color={colors.primary} />
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Download Receipt</Text>
          </TouchableOpacity>
        )}

        {!isLoggedIn && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.gray100, marginTop: 12 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 4 }}>Want to see all your orders?</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 12 }}>Login to track all past history and offers.</Text>
            <TouchableOpacity
              onPress={() => router.push('/(auth)/login')}
              style={{ height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Login with Phone</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

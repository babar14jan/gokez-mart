import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, Modal, Alert,
  RefreshControl, ScrollView, Dimensions,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { authApi, storeApi, type Order, type Product } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { getTokens, saveToken, useGuestTrackingStore } from '@/store/guestTrackingStore';
import { useThemeColors } from '@/constants/theme';
import CartPill from '@/components/features/CartPill';
import {
  ALL_CLOSED, ORDER_PROGRESS_LABELS, STATUS_LABELS,
  formatDateTime, isRecentlyDelivered, statusProgressIndex,
} from '@/utils/orderStatus';
import { calculateOrderSavings, getOrderReferralDiscount } from '@/utils/referral';
import { downloadReceipt } from '@/utils/receipt';
import { track } from '@/utils/track';

const SCREEN_W = Dimensions.get('window').width;
const STEP_ICONS = ['✅', '🍳', '🛵', '🎉'];
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
  customer_request: 'Cancelled as requested.',
  ordered_by_mistake: 'Cancelled — it looked like the order was placed by mistake.',
  changed_my_mind: 'Cancelled as requested.',
  wrong_address: 'The delivery address was incorrect. You will not be charged.',
  found_better_price: 'Cancelled as requested.',
  delivery_too_slow: 'Cancelled as requested.',
  duplicate_order: 'Cancelled — this appeared to be a duplicate order.',
  out_of_stock: 'Sorry — some items became unavailable. You will not be charged.',
  store_closed: 'Sorry — the store had to close unexpectedly. You will not be charged.',
  outside_area: "Sorry — your address is outside our delivery area right now. We're expanding soon and will be in your area! 🌱",
  incorrect_address: 'The delivery address was incorrect. You will not be charged.',
  rider_unavailable: 'Sorry — no delivery partner was available. You will not be charged.',
  technical_issue: 'Your order was cancelled due to a technical issue. You will not be charged.',
  other: 'Your order was cancelled. You will not be charged.',
};

type CancelMode = 'direct' | 'request';

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

function cancelModeFor(status: string): CancelMode | null {
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
  orders.forEach(order => {
    if (typeof order.trackingToken === 'string' && order.trackingToken.trim()) {
      saveToken(order.trackingToken);
    }
  });
}

function ItemThumbs({ items }: { items: Order['items'] }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {items.slice(0, 5).map((item, i) => (
        <Image key={i} source={{ uri: item.photoUrl ?? undefined }}
          style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.gray100 }}
          contentFit="cover" />
      ))}
      {items.length > 5 && (
        <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.gray500 }}>+{items.length - 5}</Text>
        </View>
      )}
    </View>
  );
}

function SavingsNote({ order }: { order: Order }) {
  const colors = useThemeColors();
  const savings = calculateOrderSavings(order);
  const campaign = Number(order.campaignDiscount);
  const referral = getOrderReferralDiscount(order as unknown as Record<string, unknown>);
  if (savings <= 0 && campaign <= 0 && referral <= 0) return null;
  return (
    <View style={{ gap: 2, marginTop: 6 }}>
      {savings > 0 && (
        <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#b45309' }}>
          🎉 You saved ₹{savings.toFixed(0)}
        </Text>
      )}
      {campaign > 0 && (
        <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.primary }}>
          {order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'} · -₹{campaign.toFixed(0)}
        </Text>
      )}
      {referral > 0 && (
        <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.primary }}>
          Referral Reward · -₹{referral.toFixed(0)}
        </Text>
      )}
    </View>
  );
}

function BillSection({ order }: { order: Order }) {
  const colors = useThemeColors();
  const itemSavings = Math.max(0, Number(order.itemSavings) || 0);
  const freeDeliverySaving = Math.max(0, Number(order.freeDeliverySaving) || 0);
  const campaign = Math.max(0, Number(order.campaignDiscount) || 0);
  const referral = getOrderReferralDiscount(order as unknown as Record<string, unknown>);
  const savings = calculateOrderSavings(order);
  return (
    <View style={{ backgroundColor: colors.gray50, borderRadius: 16, padding: 14, marginTop: 12 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Bill Details</Text>
      {savings > 0 && (
        <View style={{ backgroundColor: '#fef3c7', borderRadius: 10, paddingVertical: 8, marginBottom: 10 }}>
          <Text style={{ textAlign: 'center', fontSize: 13, fontFamily: 'Inter-Bold', color: '#92400e' }}>
            🎉 You saved ₹{savings.toFixed(0)} on this order
          </Text>
        </View>
      )}
      <Row label="Item total" value={`₹${order.subtotal}`} strike={itemSavings > 0 ? `₹${(Number(order.subtotal) + itemSavings).toFixed(0)}` : undefined} />
      <Row label="Delivery" value={order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}
        valueColor={order.deliveryCharge === 0 ? colors.primary : undefined}
        strike={freeDeliverySaving > 0 ? `₹${freeDeliverySaving.toFixed(0)}` : undefined} />
      {campaign > 0 && (
        <Row label={`🎉 ${order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'}`}
          value={`-₹${campaign.toFixed(0)}`} valueColor={colors.primary} />
      )}
      {referral > 0 && (
        <Row label="Referral Reward" value={`-₹${referral.toFixed(0)}`} valueColor={colors.primary} />
      )}
      <View style={{ height: 1, backgroundColor: colors.gray200, marginVertical: 8 }} />
      <Row label="Total Paid" value={`₹${order.total}`} bold />
    </View>
  );
}

function Row({ label, value, bold, valueColor, strike }: {
  label: string; value: string; bold?: boolean; valueColor?: string; strike?: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: bold ? colors.gray900 : colors.gray600 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {strike ? <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, textDecorationLine: 'line-through' }}>{strike}</Text> : null}
        <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: valueColor ?? colors.gray900 }}>{value}</Text>
      </View>
    </View>
  );
}

function CancelReasonBox({ mode, reason, onReason, onConfirm, onKeep, cancelling, error }: {
  mode: CancelMode;
  reason: string;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onKeep: () => void;
  cancelling: boolean;
  error: string;
}) {
  const colors = useThemeColors();
  const isRequest = mode === 'request';
  return (
    <View style={{ backgroundColor: colors.redLight, borderRadius: 12, padding: 12 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500, marginBottom: 6 }}>
        {isRequest
          ? 'The store will review this request before cancelling the order.'
          : 'This order has not started preparation yet.'}
      </Text>
      <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.red500, marginBottom: 8 }}>
        Why are you {isRequest ? 'requesting cancellation' : 'cancelling this order'}?
      </Text>
      <View style={{ gap: 6, marginBottom: 10 }}>
        {CANCEL_REASONS.map(item => {
          const selected = reason === item.value;
          return (
            <TouchableOpacity key={item.value}
              onPress={() => onReason(item.value)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, borderWidth: 1, borderColor: selected ? colors.red500 : colors.gray200, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 8 }}>
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={16} color={selected ? colors.red500 : colors.gray400} />
              <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray700 }}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity onPress={onConfirm} disabled={!reason || cancelling}
          style={{ flex: 1, backgroundColor: colors.red500, paddingVertical: 8, borderRadius: 8, alignItems: 'center', opacity: (!reason || cancelling) ? 0.5 : 1 }}>
          <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter-Bold' }}>
            {cancelling ? (isRequest ? 'Requesting...' : 'Cancelling...') : (isRequest ? 'Request cancellation' : 'Cancel order')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onKeep}
          style={{ backgroundColor: colors.gray100, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>Keep order</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.red500, marginTop: 8 }}>{error}</Text> : null}
    </View>
  );
}

function OrderDetailSheet({ order, cancelMode, confirmCancel, cancelling, cancelReason, cancelError,
  onClose, onOrderAgain, onReceipt, onReason, onStartCancel, onConfirmCancel, onKeepOrder, reordering,
}: {
  order: Order;
  cancelMode: CancelMode | null;
  confirmCancel: boolean;
  cancelling: boolean;
  cancelReason: string;
  cancelError: string;
  onClose: () => void;
  onOrderAgain: () => void;
  onReceipt: () => void;
  onReason: (value: string) => void;
  onStartCancel: () => void;
  onConfirmCancel: () => void;
  onKeepOrder: () => void;
  reordering: boolean;
}) {
  const colors = useThemeColors();
  const isDelivered = order.status === 'delivered';
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Close</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Order #{order.orderNumber}</Text>
          <TouchableOpacity onPress={onOrderAgain} disabled={reordering} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>{reordering ? 'Adding...' : 'Again'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{formatDateTime(order.createdAt)}</Text>
            <View style={{ backgroundColor: isDelivered ? colors.primaryLight : colors.redLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: isDelivered ? colors.primary : colors.red500 }}>
                {statusLabel(order.status)}
              </Text>
            </View>
          </View>

          {!ALL_CLOSED.includes(order.status) && (
            <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.primary, marginBottom: 10 }}>
              {ORDER_PROGRESS_LABELS[Math.max(0, progressStep(order.status))]}
            </Text>
          )}

          <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Items Ordered</Text>
          {order.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Image source={{ uri: item.photoUrl ?? undefined }}
                style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.gray100 }}
                contentFit="cover" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.gray900 }} numberOfLines={1}>{item.productName}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{item.unit}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</Text>
              </View>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{item.total ?? item.price * item.quantity}</Text>
            </View>
          ))}

          <BillSection order={order} />

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Delivered to</Text>
              {order.guestName ? <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{order.guestName}</Text> : null}
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray700 }}>{order.guestAddress}</Text>
            </View>
          </View>

          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.gray100, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Payment</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray900, textTransform: 'uppercase' }}>{order.paymentMethod}</Text>
            </View>
            {(order.storeName ?? order.fulfilledBy) && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Fulfilled by</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{order.storeName ?? order.fulfilledBy}</Text>
              </View>
            )}
          </View>

          {order.cancellationReason && (
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500, marginTop: 12 }}>
              {CANCELLATION_REASON_LABELS[order.cancellationReason] ?? 'This order was cancelled. You will not be charged.'}
            </Text>
          )}

          {cancelMode && (
            <View style={{ marginTop: 14 }}>
              {confirmCancel ? (
                <CancelReasonBox mode={cancelMode} reason={cancelReason} onReason={onReason}
                  onConfirm={onConfirmCancel} onKeep={onKeepOrder} cancelling={cancelling} error={cancelError} />
              ) : (
                <TouchableOpacity onPress={onStartCancel} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="close-circle-outline" size={14} color={colors.red500} />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>
                    {cancelMode === 'request' ? 'Request cancellation' : 'Cancel Order'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {isDelivered && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: colors.primaryLight, borderRadius: 14, marginTop: 16 }}
              onPress={onReceipt}
            >
              <Ionicons name="receipt-outline" size={18} color={colors.primary} />
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Download Receipt</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={onOrderAgain}
            disabled={reordering}
            style={{ marginTop: 12, height: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: reordering ? 0.6 : 1 }}
          >
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>{reordering ? 'Adding...' : 'Order Again'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function OrdersScreen() {
  const colors = useThemeColors();
  const { addItem } = useCartStore();
  const { isLoggedIn } = useAuthStore();
  const tokens = useGuestTrackingStore(state => state.tokens);
  const tokenKey = tokens.join(',');

  const [orders, setOrders] = useState<Order[]>([]);
  const [guestOrders, setGuestOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<'current' | 'past'>('current');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pagerRef = useRef<ScrollView>(null);

  const goToTab = (t: 'current' | 'past') => {
    setTab(t);
    pagerRef.current?.scrollTo({ x: t === 'current' ? 0 : SCREEN_W, animated: true });
  };

  const onPagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setTab(page === 0 ? 'current' : 'past');
  };

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await authApi.getOrders();
      const list = extractOrders(response);
      setOrders(list);
      rememberTokens(list);
      setLoadError('');
      return list;
    } catch (error) {
      if (!silent) setLoadError(errorText(error, 'We could not load your orders. Please try again.'));
      return [];
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  const fetchGuestOrders = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    const tokenList = getTokens();
    let list: Order[] = [];
    let failure: unknown = null;
    if (tokenList.length) {
      try {
        list = extractOrders(await storeApi.trackOrdersByTokens(tokenList));
      } catch (error) {
        failure = error;
      }
    }
    rememberTokens(list);
    setGuestOrders(list);
    if (!list.length && failure && !silent) {
      setLoadError(errorText(failure, 'We could not load your orders. Please try again.'));
    } else {
      setLoadError('');
    }
    setRefreshing(false);
    setLoading(false);
    return list;
  }, [tokenKey]);

  const refresh = useCallback((silent = false) => (
    isLoggedIn ? fetchOrders(silent) : fetchGuestOrders(silent)
  ), [isLoggedIn, fetchOrders, fetchGuestOrders]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const list = isLoggedIn ? orders : guestOrders;
    if (list.some(order => !ALL_CLOSED.includes(order.status))) {
      pollRef.current = setInterval(() => { void refresh(true); }, 10000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isLoggedIn, orders, guestOrders, refresh]);

  const allOrders = isLoggedIn ? orders : guestOrders;
  const selectedOrder = allOrders.find(order => order.id === selectedOrderId) ?? null;
  const active = allOrders.filter(order => !ALL_CLOSED.includes(order.status) || isRecentlyDelivered(order));
  const past = allOrders.filter(order => ALL_CLOSED.includes(order.status) && !isRecentlyDelivered(order));

  const startCancel = (order: Order) => {
    setCancelError('');
    setCancelReason('');
    setConfirmCancel(order.id);
    setSelectedOrderId(order.id);
  };

  const handleCancel = async () => {
    const order = allOrders.find(entry => entry.id === confirmCancel);
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
    setCancelling(order.id);
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
      await refresh(true);
      if (mode === 'direct') setSelectedOrderId(null);
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
      setCancelling(null);
      setConfirmCancel(null);
      setCancelReason('');
    }
  };

  const handleOrderAgain = async (order: Order) => {
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
    } finally {
      setReordering(false);
    }
  };

  const renderCancelControl = (order: Order) => {
    const mode = cancelModeFor(order.status);
    if (!mode) return null;
    if (confirmCancel === order.id) {
      return (
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <CancelReasonBox mode={mode} reason={cancelReason} onReason={setCancelReason}
            onConfirm={() => { void handleCancel(); }} onKeep={() => { setConfirmCancel(null); setCancelReason(''); }}
            cancelling={cancelling === order.id} error={cancelError} />
        </View>
      );
    }
    return (
      <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
        <TouchableOpacity onPress={() => startCancel(order)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="close-circle-outline" size={14} color={colors.red500} />
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>
            {mode === 'request' ? 'Request cancellation' : 'Cancel Order'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderActive = ({ item: order }: { item: Order }) => {
    const step = progressStep(order.status);
    return (
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={() => router.push(`/order-detail/${order.id}`)}
        style={{ backgroundColor: colors.surface, borderRadius: 20, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#d1fae5', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}
      >
        <View style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 14 }}>{statusLabel(order.status)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: 'Inter-SemiBold' }}>#{order.orderNumber}</Text>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <View style={{ position: 'absolute', top: 14, left: 16, right: 16, height: 2, backgroundColor: colors.gray100 }} />
            <View style={{ position: 'absolute', top: 14, left: 16, height: 2, backgroundColor: colors.primary, width: step >= 0 ? `${(step / (ORDER_PROGRESS_LABELS.length - 1)) * 100}%` : '0%' }} />
            {ORDER_PROGRESS_LABELS.map((label, i) => (
              <View key={label} style={{ alignItems: 'center', width: '25%', zIndex: 1 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 2, borderColor: i <= step ? colors.primary : colors.gray200, alignItems: 'center', justifyContent: 'center' }}>
                  {i <= step ? <Text style={{ fontSize: 13 }}>{STEP_ICONS[i]}</Text> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gray200 }} />}
                </View>
                <Text style={{ fontSize: 9, fontFamily: i <= step ? 'Inter-SemiBold' : 'Inter-Regular', color: i <= step ? colors.primary : colors.gray400, textAlign: 'center', marginTop: 4, lineHeight: 12 }}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <ItemThumbs items={order.items} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{order.items.length} items</Text>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{order.total}</Text>
          </View>
          <SavingsNote order={order} />
        </View>

        {order.status === 'delivered' && (
          <TouchableOpacity
            onPress={(event) => { event.stopPropagation(); void downloadReceipt(order); }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.gray100 }}
          >
            <Ionicons name="receipt-outline" size={14} color={colors.primary} />
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.primary }}>Download Receipt</Text>
          </TouchableOpacity>
        )}

        {renderCancelControl(order)}
      </TouchableOpacity>
    );
  };

  const renderPast = ({ item: order }: { item: Order }) => (
    <View style={{ backgroundColor: colors.surface, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>
              {order.status === 'delivered' ? '✅' : '❌'} {statusLabel(order.status)}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
              {formatDateTime(order.createdAt)}
            </Text>
            {order.status !== 'delivered' && order.cancellationReason && (
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 4, lineHeight: 15 }}>
                {CANCELLATION_REASON_LABELS[order.cancellationReason] ?? 'This order was cancelled. You will not be charged.'}
              </Text>
            )}
          </View>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{order.total}</Text>
        </View>
        <ItemThumbs items={order.items} />
        <SavingsNote order={order} />
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.gray100 }}>
        <TouchableOpacity onPress={() => router.push(`/order-detail/${order.id}`)}
          style={{ flex: 1, paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>View Details</Text>
        </TouchableOpacity>
        <View style={{ width: 1, backgroundColor: colors.gray100 }} />
        <TouchableOpacity onPress={() => { void handleOrderAgain(order); }} disabled={reordering}
          style={{ flex: 1, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
          <Ionicons name="refresh" size={13} color={colors.primary} />
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.primary }}>{reordering ? 'Adding...' : 'Order Again'}</Text>
        </TouchableOpacity>
        {order.status === 'delivered' && (
          <>
            <View style={{ width: 1, backgroundColor: colors.gray100 }} />
            <TouchableOpacity onPress={() => { void downloadReceipt(order); }}
              style={{ flex: 1, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              <Ionicons name="receipt-outline" size={13} color={colors.primary} />
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.primary }}>Receipt</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 4 }}>My Orders</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 16 }}>
            {tokens.length ? 'Orders linked to this device' : GUEST_ORDER_HINT}
          </Text>
          {loadError ? (
            <TouchableOpacity onPress={() => { void refresh(); }} style={{ backgroundColor: colors.redLight, borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>{loadError} Tap to retry.</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {guestOrders.length > 0 && (
          <FlatList
            data={guestOrders}
            keyExtractor={order => order.id}
            renderItem={({ item: order }) => (
              <TouchableOpacity
                onPress={() => setSelectedOrderId(order.id)}
                style={{ backgroundColor: colors.surface, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: colors.gray100 }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>#{order.orderNumber}</Text>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{order.total}</Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{statusLabel(order.status)}</Text>
                {!ALL_CLOSED.includes(order.status) && (
                  <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.primary, marginTop: 2 }}>
                    {ORDER_PROGRESS_LABELS[Math.max(0, progressStep(order.status))]}
                  </Text>
                )}
                <SavingsNote order={order} />
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingBottom: 140 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary} />}
          />
        )}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, elevation: 12 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', marginBottom: 4 }}>See all your orders & offers</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 16 }}>Login to view your full order history and exclusive offers.</Text>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/login')}
            style={{ height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
          >
            <Ionicons name="call-outline" size={18} color="#fff" />
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Login with Phone</Text>
          </TouchableOpacity>
        </View>
        {selectedOrder && (
          <OrderDetailSheet order={selectedOrder}
            cancelMode={cancelModeFor(selectedOrder.status)}
            confirmCancel={confirmCancel === selectedOrder.id}
            cancelling={cancelling === selectedOrder.id}
            cancelReason={cancelReason}
            cancelError={cancelError}
            onClose={() => { setSelectedOrderId(null); setConfirmCancel(null); }}
            onOrderAgain={() => { void handleOrderAgain(selectedOrder); }}
            onReceipt={() => { void downloadReceipt(selectedOrder); }}
            onReason={setCancelReason}
            onStartCancel={() => startCancel(selectedOrder)}
            onConfirmCancel={() => { void handleCancel(); }}
            onKeepOrder={() => { setConfirmCancel(null); setCancelReason(''); }}
            reordering={reordering} />
        )}
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900 }}>My Orders</Text>
          {orders.some(order => !ALL_CLOSED.includes(order.status)) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }} />
              <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Live</Text>
            </View>
          )}
        </View>
        {loadError ? (
          <TouchableOpacity onPress={() => { void refresh(); }} style={{ backgroundColor: colors.redLight, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>{loadError} Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}
        <View style={{ flexDirection: 'row', backgroundColor: colors.gray100, borderRadius: 14, padding: 3 }}>
          {(['current', 'past'] as const).map(t => (
            <TouchableOpacity key={t} onPress={() => goToTab(t)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: tab === t ? colors.surface : 'transparent' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: tab === t ? colors.primary : colors.gray500 }}>
                {t === 'current' ? 'Current' : 'Past'}
              </Text>
              {t === 'current' && active.length > 0 && (
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: '#fff' }}>{active.length}</Text>
                </View>
              )}
              {t === 'past' && past.length > 0 && (
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>({past.length})</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerScrollEnd}
        contentOffset={{ x: tab === 'current' ? 0 : SCREEN_W, y: 0 }}
      >
        <View style={{ width: SCREEN_W }}>
          <FlatList
            data={active}
            keyExtractor={order => order.id}
            renderItem={renderActive}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary} />}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 }}>
                <Text style={{ fontSize: 40, marginBottom: 10 }}>✅</Text>
                <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900, marginBottom: 4 }}>No active orders</Text>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 20, textAlign: 'center' }}>All your orders have been delivered</Text>
                <TouchableOpacity
                  onPress={() => router.push('/categories')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 }}
                >
                  <Ionicons name="bag-outline" size={16} color="#fff" />
                  <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Continue Shopping</Text>
                </TouchableOpacity>
              </View>
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
        <View style={{ width: SCREEN_W }}>
          <FlatList
            data={past}
            keyExtractor={order => order.id}
            renderItem={renderPast}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary} />}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ fontSize: 40, marginBottom: 10 }}>📦</Text>
                <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900, marginBottom: 4 }}>No past orders</Text>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Your completed orders will appear here</Text>
              </View>
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
      </ScrollView>

      <CartPill />
    </SafeAreaView>
  );
}

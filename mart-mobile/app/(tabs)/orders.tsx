import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, ScrollView, Dimensions, type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { authApi, type Order } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';
import CartPill from '@/components/features/CartPill';
import LoginPrompt from '@/components/features/LoginPrompt';

const STEPS       = ['pending', 'preparing', 'out_for_delivery', 'delivered'];
const STEP_LABELS = ['Placed', 'Preparing', 'On the Way', 'Delivered'];
const STEP_ICONS  = ['🛒', '🍳', '🛵', '🎉'];
const SCREEN_W    = Dimensions.get('window').width;

const STATUS_TO_STEP: Record<string, string> = {
  pending: 'pending', confirmed: 'pending',
  preparing: 'preparing', ready_to_pickup: 'preparing',
  out_for_delivery: 'out_for_delivery', picked_up: 'out_for_delivery',
  delivered: 'delivered',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed', confirmed: 'Confirmed', preparing: 'Being Prepared',
  ready_to_pickup: 'Being Prepared', out_for_delivery: 'Out for Delivery',
  picked_up: 'On the Way 🛵', delivered: 'Delivered 🎉',
  cancelled: 'Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Cancelled by Store',
};

const CLOSED = ['cancelled', 'failed_delivery', 'terminated', 'delivered'];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' at ' + new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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

function BillSection({ order }: { order: Order }) {
  const colors = useThemeColors();
  return (
    <View style={{ backgroundColor: colors.gray50, borderRadius: 16, padding: 14, marginTop: 12 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Bill Details</Text>
      <Row label="Item total" value={`₹${order.subtotal}`} />
      <Row label="Delivery" value={order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`} valueColor={order.deliveryCharge === 0 ? colors.primary : undefined} />
      {(order.campaignDiscount ?? 0) > 0 && (
        <Row label={`🎉 ${order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'}`} value={`-₹${order.campaignDiscount}`} valueColor={colors.primary} />
      )}
      <View style={{ height: 1, backgroundColor: colors.gray200, marginVertical: 8 }} />
      <Row label="Total Paid" value={`₹${order.total}`} bold />
    </View>
  );
}

function Row({ label, value, bold, valueColor }: { label: string; value: string; bold?: boolean; valueColor?: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: bold ? colors.gray900 : colors.gray600 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: valueColor ?? (bold ? colors.gray900 : colors.gray900) }}>{value}</Text>
    </View>
  );
}

function OrderDetailSheet({ order, onClose, onOrderAgain }: { order: Order; onClose: () => void; onOrderAgain: () => void }) {
  const colors = useThemeColors();
  const isDelivered = order.status === 'delivered';
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        {/* Native sheet header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Close</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Order #{order.orderNumber}</Text>
          <TouchableOpacity onPress={() => { onOrderAgain(); onClose(); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Again</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          {/* Status badge + date */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{formatDate(order.createdAt)}</Text>
            <View style={{ backgroundColor: isDelivered ? colors.primaryLight : '#fee2e2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: isDelivered ? colors.primary : colors.red500 }}>
                {STATUS_LABELS[order.status]}
              </Text>
            </View>
          </View>

          {/* Items */}
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
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{item.price * item.quantity}</Text>
            </View>
          ))}

          {/* Bill */}
          <BillSection order={order} />

          {/* Address */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Delivered to</Text>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray700 }}>{order.guestAddress}</Text>
            </View>
          </View>

          {/* Payment + fulfilled */}
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

          {/* Receipt button — delivered only */}
          {isDelivered && (
            <View style={{ marginTop: 14, borderWidth: 1, borderColor: colors.primaryLight, borderRadius: 14, overflow: 'hidden' }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: colors.primaryLight }}
                onPress={() => {}}
              >
                <Ionicons name="receipt-outline" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Download Receipt</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Order Again */}
          <TouchableOpacity
            onPress={() => { onOrderAgain(); onClose(); }}
            style={{ marginTop: 12, height: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
          >
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Order Again</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function OrdersScreen() {
  const colors         = useThemeColors();
  const { addItem }    = useCartStore();
  const { isLoggedIn } = useAuthStore();

  const [orders,        setOrders]        = useState<Order[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [tab,           setTab]           = useState<'current' | 'past'>('current');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling,    setCancelling]    = useState<string | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
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
    try { const r = await authApi.getOrders(); setOrders(r.data.data ?? []); }
    catch { /* silent */ }
    finally { setRefreshing(false); setLoading(false); }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasLive = orders.some(o => !CLOSED.includes(o.status));
    if (hasLive) pollRef.current = setInterval(() => fetchOrders(true), 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [orders]);

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try { await authApi.cancelOrder(id); await fetchOrders(true); }
    catch { /* silent */ }
    finally { setCancelling(null); setConfirmCancel(null); }
  };

  const handleOrderAgain = (order: Order) => {
    order.items.forEach(item => {
      addItem({
        id: item.productId, name: item.productName, unit: item.unit,
        price: item.price, photoUrl: item.photoUrl ?? null,
        availabilityStatus: 'available', isAvailable: true,
        discountPercent: 0, categoryId: '', categoryName: '',
        description: null, weightOptions: null, localName: null,
      });
    });
  };

  const active = orders.filter(o => !CLOSED.includes(o.status));
  const past   = orders.filter(o => CLOSED.includes(o.status));

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <LoginPrompt
          icon="receipt-outline"
          title="Track your orders"
          subtitle="Login to view your order history, track deliveries and reorder your favourites."
        />
      </SafeAreaView>
    );
  }

  const renderActive = ({ item: order }: { item: Order }) => {
    const curStep   = STEPS.indexOf(STATUS_TO_STEP[order.status] ?? order.status);
    const canCancel = ['pending', 'confirmed'].includes(order.status);
    return (
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={() => router.push(`/order-detail/${order.id}`)}
        style={{ backgroundColor: colors.surface, borderRadius: 20, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#d1fae5', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}
      >
        {/* Green banner */}
        <View style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 14 }}>{STATUS_LABELS[order.status]}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: 'Inter-SemiBold' }}>#{order.orderNumber}</Text>
        </View>

        {/* Progress tracker */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <View style={{ position: 'absolute', top: 14, left: 16, right: 16, height: 2, backgroundColor: colors.gray100 }} />
            <View style={{ position: 'absolute', top: 14, left: 16, height: 2, backgroundColor: colors.primary, width: curStep >= 0 ? `${(curStep / (STEPS.length - 1)) * 100}%` : '0%' }} />
            {STEPS.map((_, i) => (
              <View key={i} style={{ alignItems: 'center', width: '25%', zIndex: 1 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 2, borderColor: i <= curStep ? colors.primary : colors.gray200, alignItems: 'center', justifyContent: 'center' }}>
                  {i <= curStep
                    ? <Text style={{ fontSize: 13 }}>{STEP_ICONS[i]}</Text>
                    : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gray200 }} />
                  }
                </View>
                <Text style={{ fontSize: 9, fontFamily: i <= curStep ? 'Inter-SemiBold' : 'Inter-Regular', color: i <= curStep ? colors.primary : colors.gray400, textAlign: 'center', marginTop: 4, lineHeight: 12 }}>
                  {STEP_LABELS[i]}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Thumbnails + total */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <ItemThumbs items={order.items} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{order.items.length} items</Text>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{order.total}</Text>
          </View>
        </View>

        {/* Cancel */}
        {canCancel && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
            {confirmCancel === order.id ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef2f2', borderRadius: 12, padding: 10, gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500 }}>Cancel this order?</Text>
                <TouchableOpacity onPress={() => handleCancel(order.id)} disabled={cancelling === order.id}
                  style={{ backgroundColor: colors.red500, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                  <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter-Bold' }}>{cancelling === order.id ? '...' : 'Yes'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setConfirmCancel(null)}
                  style={{ backgroundColor: colors.gray100, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>No</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={(e) => { e.stopPropagation(); setConfirmCancel(order.id); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="close-circle-outline" size={14} color={colors.red500} />
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.red500 }}>Cancel Order</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderPast = ({ item: order }: { item: Order }) => (
    <View style={{ backgroundColor: colors.surface, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>
              {order.status === 'delivered' ? '✅' : '❌'} {STATUS_LABELS[order.status]}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
              {formatDate(order.createdAt)}
            </Text>
          </View>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{order.total}</Text>
        </View>
        <ItemThumbs items={order.items} />
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.gray100 }}>
        <TouchableOpacity onPress={() => router.push(`/order-detail/${order.id}`)}
          style={{ flex: 1, paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>View Details</Text>
        </TouchableOpacity>
        <View style={{ width: 1, backgroundColor: colors.gray100 }} />
        <TouchableOpacity onPress={() => handleOrderAgain(order)}
          style={{ flex: 1, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
          <Ionicons name="refresh" size={13} color={colors.primary} />
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.primary }}>Order Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      {/* Header */}
      <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900 }}>My Orders</Text>
          {orders.some(o => !CLOSED.includes(o.status)) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }} />
              <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Live</Text>
            </View>
          )}
        </View>
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
            keyExtractor={o => o.id}
            renderItem={renderActive}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchOrders()} tintColor={colors.primary} />}
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
            keyExtractor={o => o.id}
            renderItem={renderPast}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchOrders()} tintColor={colors.primary} />}
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

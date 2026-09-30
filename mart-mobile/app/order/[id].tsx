import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, storeApi, type Order } from '@/services/api';
import { useThemeColors } from '@/constants/theme';
import { ORDER_STATUS_LABELS } from '@/constants/config';
import { useAuthStore } from '@/store/authStore';

const STATUS_STEPS = [
  { key: 'pending',          label: 'Order Placed',     icon: '📋' },
  { key: 'confirmed',        label: 'Confirmed',        icon: '✅' },
  { key: 'preparing',        label: 'Preparing',        icon: '👨‍🍳' },
  { key: 'out_for_delivery', label: 'Out for Delivery', icon: '🛵' },
  { key: 'delivered',        label: 'Delivered',        icon: '🎉' },
];

function getStepIndex(status: string) {
  const map: Record<string, number> = {
    pending: 0, confirmed: 1, preparing: 2,
    ready_to_pickup: 2, out_for_delivery: 3, picked_up: 3, delivered: 4,
  };
  return map[status] ?? 0;
}

export default function OrderTrackingScreen() {
  const colors   = useThemeColors();
  const { id }    = useLocalSearchParams<{ id: string }>();
  const { isLoggedIn } = useAuthStore();
  const [order,   setOrder]   = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      if (isLoggedIn) {
        const res = await authApi.getOrders();
        setOrder((res.data.data ?? []).find((o: Order) => o.id === id) ?? null);
      } else {
        const phone = await AsyncStorage.getItem('guest_phone');
        if (phone) {
          const res = await storeApi.trackGuestOrders(phone);
          setOrder((res.data.data ?? []).find((o: Order) => o.id === id) ?? null);
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [id, isLoggedIn]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, color: colors.gray500, fontFamily: 'Inter-Regular' }}>Order not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter-Medium' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stepIdx     = getStepIndex(order.status);
  const isCancelled = order.status === 'cancelled';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* Status stepper */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.gray100 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: isCancelled ? colors.red500 : colors.primary, marginBottom: 16 }}>
            {isCancelled ? '❌ Order Cancelled' : ORDER_STATUS_LABELS[order.status]}
          </Text>
          {!isCancelled && STATUS_STEPS.map((step, i) => {
            const done    = i <= stepIdx;
            const current = i === stepIdx;
            return (
              <View key={step.key} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ alignItems: 'center', marginRight: 12, width: 24 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: done ? colors.primary : colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, color: '#fff', fontFamily: 'Inter-Bold' }}>{done ? '✓' : ''}</Text>
                  </View>
                  {i < STATUS_STEPS.length - 1 && (
                    <View style={{ width: 2, flex: 1, minHeight: 24, backgroundColor: done ? colors.primary : colors.gray200 }} />
                  )}
                </View>
                <View style={{ paddingBottom: 16, flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: current ? 'Inter-SemiBold' : 'Inter-Regular', color: done ? colors.gray900 : colors.gray400 }}>
                    {step.icon} {step.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Items */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.gray100 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 12 }}>Items</Text>
          {order.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.gray100 }}>
              <Image source={{ uri: item.photoUrl ?? undefined }} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.gray100 }} contentFit="cover" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.gray900 }} numberOfLines={1}>{item.productName}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500 }}>{item.unit} × {item.quantity}</Text>
              </View>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>₹{item.price * item.quantity}</Text>
            </View>
          ))}
        </View>

        {/* Bill */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.gray100 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600 }}>Subtotal</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray900 }}>₹{order.subtotal}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600 }}>Delivery</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: order.deliveryCharge === 0 ? colors.primary : colors.gray900 }}>
              {order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`}
            </Text>
          </View>
          <View style={{ height: 1, backgroundColor: colors.gray100, marginVertical: 8 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Total</Text>
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{order.total}</Text>
          </View>
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, marginTop: 6 }}>
            Payment: {order.paymentMethod.toUpperCase()}
            {order.storeName ? `  ·  Fulfilled by ${order.storeName}` : ''}
          </Text>
        </View>

        {/* Address */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.gray100 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>📍 Delivery Address</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 18 }}>{order.guestAddress}</Text>
        </View>

        {/* Guest login prompt */}
        {!isLoggedIn && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.gray100 }}>
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

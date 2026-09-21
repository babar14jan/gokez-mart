import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { authApi, type Order } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { colors as staticColors, useThemeColors } from '@/constants/theme';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed', confirmed: 'Confirmed', preparing: 'Being Prepared',
  ready_to_pickup: 'Being Prepared', out_for_delivery: 'Out for Delivery',
  picked_up: 'On the Way 🛵', delivered: 'Delivered 🎉',
  cancelled: 'Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Cancelled by Store',
};

const STATUS_COLOR: Record<string, string> = {
  delivered: staticColors.primary, cancelled: staticColors.red500,
  failed_delivery: staticColors.red500, terminated: staticColors.red500,
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    + ' · ' + new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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

function BillRow({ label, value, bold, green, strike }: { label: string; value: string; bold?: boolean; green?: boolean; strike?: boolean }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 5 }}>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: bold ? colors.gray900 : colors.gray600 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: bold ? 'Inter-Bold' : 'Inter-Regular', color: green ? colors.primary : bold ? colors.gray900 : colors.gray900, textDecorationLine: strike ? 'line-through' : 'none' }}>{value}</Text>
    </View>
  );
}

export default function OrderDetailScreen() {
  const colors     = useThemeColors();
  const { id }      = useLocalSearchParams<{ id: string }>();
  const { addItem } = useCartStore();
  const [order,   setOrder]   = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await authApi.getOrders();
      setOrder((res.data.data ?? []).find((o: Order) => o.id === id) ?? null);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleOrderAgain = () => {
    if (!order) return;
    order.items.forEach(item => {
      addItem({
        id: item.productId, name: item.productName, unit: item.unit,
        price: item.price, photoUrl: item.photoUrl ?? null,
        availabilityStatus: 'available', isAvailable: true,
        discountPercent: 0, categoryId: '', categoryName: '',
        description: null, weightOptions: null, localName: null,
      });
    });
    router.back();
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
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, color: colors.gray500, fontFamily: 'Inter-Regular' }}>Order not found</Text>
      </View>
    );
  }

  const isDelivered = order.status === 'delivered';
  const isClosed    = ['delivered', 'cancelled', 'failed_delivery', 'terminated'].includes(order.status);
  const statusColor = STATUS_COLOR[order.status] ?? colors.primary;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}>

        {/* Status banner */}
        <Card>
          <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: statusColor }}>{STATUS_LABELS[order.status]}</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 3 }}>{formatDate(order.createdAt)}</Text>
            </View>
            <View style={{ backgroundColor: statusColor + '15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: statusColor }}>#{order.orderNumber}</Text>
            </View>
          </View>
          {(order.storeName ?? order.fulfilledBy) && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="storefront-outline" size={13} color={colors.gray400} />
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                Fulfilled by <Text style={{ fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>{order.storeName ?? order.fulfilledBy}</Text>
              </Text>
            </View>
          )}
        </Card>

        {/* Items */}
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
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{item.price * item.quantity}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Bill */}
        <Card>
          <CardHeader title="Bill Details" icon="receipt-outline" />
          <View style={{ paddingBottom: 14 }}>
            <BillRow label="Item total" value={`₹${order.subtotal}`} />
            <BillRow label="Delivery charge" value={order.deliveryCharge === 0 ? 'FREE' : `₹${order.deliveryCharge}`} green={order.deliveryCharge === 0} />
            {(order.campaignDiscount ?? 0) > 0 && (
              <BillRow
                label={`🎉 ${order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer discount'}`}
                value={`-₹${order.campaignDiscount}`}
                green
              />
            )}
            <View style={{ height: 1, backgroundColor: colors.gray100, marginHorizontal: 14, marginVertical: 6 }} />
            <BillRow label="Total Paid" value={`₹${order.total}`} bold />
            <View style={{ paddingHorizontal: 14, paddingTop: 4 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
                Paid via <Text style={{ fontFamily: 'Inter-SemiBold', textTransform: 'uppercase' }}>{order.paymentMethod}</Text>
              </Text>
            </View>
          </View>
        </Card>

        {/* Delivery address */}
        <Card>
          <CardHeader title="Delivery Address" icon="location-outline" />
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Ionicons name="home-outline" size={17} color={colors.primary} />
            </View>
            <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray700, lineHeight: 20, paddingTop: 8 }}>{order.guestAddress}</Text>
          </View>
        </Card>

        {/* Receipt — delivered only */}
        {isDelivered && (
          <Card>
            <CardHeader title="Receipt" icon="document-text-outline" />
            <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 12, lineHeight: 18 }}>
                This is a purchase receipt for your order. Not a GST invoice.{'\n'}
                Powered by Gokez Technologies Pvt. Ltd.
              </Text>
              <TouchableOpacity
                style={{ height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onPress={() => {}}
              >
                <Ionicons name="download-outline" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Download Receipt (PDF)</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Actions */}
        <View style={{ marginHorizontal: 16, gap: 10 }}>
          <TouchableOpacity
            onPress={handleOrderAgain}
            style={{ height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Order Again</Text>
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

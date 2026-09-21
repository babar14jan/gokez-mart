import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCartStore } from '@/store/cartStore';

export default function CartPill() {
  const items      = useCartStore(s => s.items);
  const subtotalFn = useCartStore(s => s.subtotal);
  const insets     = useSafeAreaInsets();

  const count  = items.reduce((s, i) => s + i.quantity, 0);
  const sub    = subtotalFn();

  if (count === 0) return null;

  // Sit just above the tab bar
  const bottomOffset = 56 + Math.max(insets.bottom, 8) - 37;

  return (
    <View style={{ position: 'absolute', bottom: bottomOffset, left: 0, right: 0, alignItems: 'center', pointerEvents: 'box-none' }}>
      <TouchableOpacity
        onPress={() => router.push('/checkout')}
        activeOpacity={0.9}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: '#047857',
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: 999,
        }}
      >
        <Ionicons name="cart-outline" size={20} color="#fff" />

        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter-Bold', lineHeight: 17 }}>View Cart</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontFamily: 'Inter-Medium', lineHeight: 13 }}>
            {count} {count === 1 ? 'item' : 'items'} · ₹{sub}
          </Text>
        </View>

        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

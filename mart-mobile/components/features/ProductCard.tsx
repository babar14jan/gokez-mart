import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useCartStore } from '@/store/cartStore';
import type { Product } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

const SCREEN_W   = Dimensions.get('window').width;
// Default: 3-col grid on home horizontal scroll
export const CARD_W_HOME = 148;
// 2-col grid: full width minus sidebar minus padding
export const CARD_W_GRID = Math.floor((SCREEN_W - 6) / 2) - 6; // (screen - padding*2) / 2 - gap

interface Props {
  product: Product;
  width?: number;
}

export default function ProductCard({ product, width = CARD_W_HOME }: Props) {
  const colors = useThemeColors();
  const { items, addItem, updateQty } = useCartStore();
  const cartItem = items.find(i => i.productId === product.id && i.unit === product.unit);
  const qty      = cartItem?.quantity ?? 0;

  return (
    <TouchableOpacity
      style={{ width, backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden' }}
      activeOpacity={0.9}
      onPress={() => router.push(`/product/${product.id}`)}
    >
      {/* Square image */}
      <View style={{ width, height: width, position: 'relative', backgroundColor: colors.gray100 }}>
        <Image
          source={{ uri: product.photoUrl ?? undefined }}
          style={{ width, height: width }}
          contentFit="cover"
        />
        {product.discountPercent > 0 && (
          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: colors.primary, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
            <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'Inter-Bold' }}>
              {product.discountPercent}% OFF
            </Text>
          </View>
        )}
        {/* ADD / Stepper */}
        <View style={{ position: 'absolute', bottom: 6, right: 6 }}>
          {qty === 0 ? (
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 }}
              onPress={e => { e.stopPropagation(); addItem(product); }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter-Bold' }}>ADD</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: 8, overflow: 'hidden' }}>
              <TouchableOpacity
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                onPress={e => { e.stopPropagation(); updateQty(product.id, product.unit, qty - 1); }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter-Bold', lineHeight: 18 }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter-Bold', width: 22, textAlign: 'center' }}>{qty}</Text>
              <TouchableOpacity
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                onPress={e => { e.stopPropagation(); addItem(product); }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter-Bold', lineHeight: 18 }}>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Info */}
      <View style={{ padding: 8 }}>
        <Text style={{ fontSize: 10, color: colors.gray400, fontFamily: 'Inter-Regular', marginBottom: 2 }}>{product.unit}</Text>
        <Text style={{ fontSize: 12, color: colors.gray900, fontFamily: 'Inter-Medium', lineHeight: 16 }} numberOfLines={2}>
          {product.name}
        </Text>
        {product.localName ? (
          <Text style={{ fontSize: 10, color: colors.gray400, fontFamily: 'Inter-Regular', marginTop: 1 }} numberOfLines={1}>
            {product.localName}
          </Text>
        ) : null}
        <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter-Bold', marginTop: 4 }}>₹{product.price}</Text>
      </View>
    </TouchableOpacity>
  );
}

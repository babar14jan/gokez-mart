import { View, Text, TouchableOpacity, Dimensions, Alert } from 'react-native';
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
  const optionLabels = product.weightOptions?.length ? product.weightOptions.map(option => option.label) : null;
  const productCartItems = items.filter(i => i.productId === product.id && (!optionLabels || i.unit === product.unit || optionLabels.includes(i.unit)));
  const qty = productCartItems.reduce((sum, i) => sum + i.quantity, 0);
  const primaryOption = product.weightOptions?.find(option => option.label === product.unit) || null;
  const defaultOption = primaryOption || product.weightOptions?.[0] || null;
  const defaultUnit = defaultOption ? defaultOption.label : product.unit;
  const basePrice = defaultOption ? defaultOption.price : product.price;
  const baseDiscount = defaultOption
    ? (defaultOption === primaryOption ? (defaultOption.discountPercent ?? product.discountPercent ?? 0) : (defaultOption.discountPercent ?? 0))
    : (product.discountPercent || 0);
  const discountedPrice = baseDiscount > 0 ? Math.round(basePrice * (1 - baseDiscount / 100)) : basePrice;
  // The local (Hindi) name, shown in brackets only when it adds information.
  const localName = product.localName?.trim() && product.localName.trim() !== product.name?.trim()
    ? product.localName.trim()
    : '';

  const openProduct = () => router.push(`/product/${product.id}`);
  const handleAdd = () => {
    if (optionLabels) {
      const entry = productCartItems.find(i => i.quantity > 0);
      if (entry) {
        const result = addItem(product, entry.unit, entry.price);
        if (result === 'different_unit') {
          Alert.alert('One size per product', 'Remove the other size from your cart before adding this product.');
        }
        return;
      }
      openProduct();
      return;
    }
    if (addItem(product, defaultUnit, discountedPrice) === 'different_unit') {
      Alert.alert('One size per product', 'Remove the other size from your cart before adding this product.');
    }
  };
  const handleDecrease = () => {
    if (optionLabels) {
      const entry = productCartItems.find(i => i.quantity > 0);
      if (entry) updateQty(product.id, entry.unit, entry.quantity - 1);
      return;
    }
    updateQty(product.id, product.unit, qty - 1);
  };

  return (
    <TouchableOpacity
      style={{ width, backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden' }}
      activeOpacity={0.9}
      onPress={openProduct}
    >
      {/* Square image */}
      <View style={{ width, height: width, position: 'relative', backgroundColor: colors.gray100 }}>
        <Image
          source={{ uri: product.thumbnailUrl ?? product.photoVariants?.[0]?.thumbnailUrl ?? product.photoUrl ?? undefined }}
          style={{ width, height: width }}
          contentFit="cover"
        />
        {baseDiscount > 0 && (
          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: colors.primary, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
            <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'Inter-Bold' }}>
              {baseDiscount}% OFF
            </Text>
          </View>
        )}
        {/* ADD / Stepper */}
        <View style={{ position: 'absolute', bottom: 6, right: 6 }}>
          {qty === 0 ? (
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 }}
              onPress={e => { e.stopPropagation(); handleAdd(); }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter-Bold' }}>ADD</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: 8, overflow: 'hidden' }}>
              <TouchableOpacity
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                onPress={e => { e.stopPropagation(); handleDecrease(); }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter-Bold', lineHeight: 18 }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter-Bold', width: 22, textAlign: 'center' }}>{qty}</Text>
              <TouchableOpacity
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                onPress={e => { e.stopPropagation(); handleAdd(); }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter-Bold', lineHeight: 18 }}>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Info */}
      <View style={{ padding: 8 }}>
        <Text style={{ fontSize: 10, color: colors.gray400, fontFamily: 'Inter-Regular', marginBottom: 2 }}>{defaultUnit}</Text>
        {/* Three lines, matching the web card: the label carries the Hindi
            name too, and two lines cut it off for most products. */}
        <Text style={{ fontSize: 12, color: colors.gray900, fontFamily: 'Inter-Medium', lineHeight: 16 }} numberOfLines={3}>
          {product.name}
          {/* Local (Hindi) name in brackets, at the same size and weight as the
              main name, so it reads as an alternate label for the same product
              instead of a muted subtitle. */}
          {localName ? <Text>{` (${localName})`}</Text> : null}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
          <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter-Bold' }}>₹{discountedPrice}</Text>
          {baseDiscount > 0 && (
            <Text style={{ fontSize: 11, color: colors.gray400, fontFamily: 'Inter-Regular', textDecorationLine: 'line-through' }}>₹{basePrice}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

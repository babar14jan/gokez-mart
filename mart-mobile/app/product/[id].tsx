import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { storeApi, type Product } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useThemeColors } from '@/constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const IMG_H = Math.round(SCREEN_W * 0.75);

export default function ProductDetailScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, addItem, updateQty } = useCartStore();

  const [product,  setProduct]  = useState<Product | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [selUnit,  setSelUnit]  = useState('');
  const [selPrice, setSelPrice] = useState(0);

  useEffect(() => {
    storeApi.getProducts().then(res => {
      const found = res.data.data.find(p => p.id === id) ?? null;
      if (found) { setProduct(found); setSelUnit(found.unit); setSelPrice(found.price); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const cartItem = items.find(i => i.productId === id && i.unit === selUnit);
  const qty      = cartItem?.quantity ?? 0;

  const discountedPrice = product && product.discountPercent > 0
    ? Math.round(product.price * (1 - product.discountPercent / 100))
    : product?.price ?? 0;
  const savings = product && product.discountPercent > 0
    ? Math.round(product.price - discountedPrice) : 0;
  const isOutOfStock = product?.availabilityStatus === 'out_of_stock' || !product?.isAvailable;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Product not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter-Medium' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Image */}
        <View style={{ marginHorizontal: 16, marginTop: 8, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.gray50, height: IMG_H }}>
          {product.photoUrl ? (
            <Image source={{ uri: product.photoUrl }} style={{ width: '100%', height: IMG_H, opacity: isOutOfStock ? 0.5 : 1 }} contentFit="cover" transition={200} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 64 }}>🥦</Text>
            </View>
          )}
          {product.discountPercent > 0 && (
            <View style={{ position: 'absolute', top: 12, left: 12, backgroundColor: colors.red500, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Inter-Bold' }}>{product.discountPercent}% OFF</Text>
            </View>
          )}
          {isOutOfStock && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter-Bold' }}>Out of Stock</Text>
              </View>
            </View>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
          {/* Name */}
          <View>
            <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, lineHeight: 26 }}>
              {product.name}{product.localName ? ` (${product.localName})` : ''}
            </Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 3 }}>{product.unit}</Text>
            {product.categoryName ? (
              <View style={{ marginTop: 6, alignSelf: 'flex-start', backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.primary }}>{product.categoryName}</Text>
              </View>
            ) : null}
          </View>

          {/* Price */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ fontSize: 28, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{discountedPrice}</Text>
            {savings > 0 && (
              <>
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Regular', color: colors.gray400, textDecorationLine: 'line-through' }}>₹{product.price}</Text>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Save ₹{savings}</Text>
              </>
            )}
          </View>

          {/* Weight options */}
          {product.weightOptions && product.weightOptions.length > 0 && (
            <View>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Select Weight</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity onPress={() => { setSelUnit(product.unit); setSelPrice(product.price); }}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: selUnit === product.unit ? colors.primary : colors.gray200, backgroundColor: selUnit === product.unit ? colors.primaryLight : colors.surface }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: selUnit === product.unit ? colors.primary : colors.gray700 }}>{product.unit} — ₹{product.price}</Text>
                </TouchableOpacity>
                {product.weightOptions.map((opt, i) => (
                  <TouchableOpacity key={i} onPress={() => { setSelUnit(opt.label); setSelPrice(opt.price); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: selUnit === opt.label ? colors.primary : colors.gray200, backgroundColor: selUnit === opt.label ? colors.primaryLight : colors.surface }}>
                    <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: selUnit === opt.label ? colors.primary : colors.gray700 }}>{opt.label} — ₹{opt.price}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Description */}
          {product.description ? (
            <View style={{ backgroundColor: colors.gray50, borderRadius: 16, padding: 14 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>About this product</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray700, lineHeight: 20 }}>{product.description}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
        {isOutOfStock ? (
          <View style={{ height: 56, borderRadius: 16, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Out of Stock</Text>
          </View>
        ) : qty === 0 ? (
          <TouchableOpacity onPress={() => addItem(product, selUnit, selPrice)}
            style={{ height: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>Add to Cart — ₹{selPrice}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ height: 56, borderRadius: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }}>
            <TouchableOpacity onPress={() => updateQty(product.id, selUnit, qty - 1)}
              style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="remove" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>{qty} in cart</Text>
            <TouchableOpacity onPress={() => addItem(product, selUnit, selPrice)}
              style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

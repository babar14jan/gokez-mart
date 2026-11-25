import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storeApi, type Product } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeColors } from '@/constants/theme';
import { track } from '@/utils/track';
import StoreClosedStrip from '@/components/StoreClosedStrip';

const IMG_H = Math.round(Dimensions.get('window').width * 0.75);

const sellingPrice = (price: number, discount?: number) => (
  discount && discount > 0 ? Math.round(price * (1 - discount / 100)) : price
);

export default function ProductDetailScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { id, unit } = useLocalSearchParams<{ id: string; unit?: string }>();
  const selectedZone = useZoneStore(state => state.selectedZone);
  const storeId = selectedZone?.storeId;
  const zoneId = selectedZone?.id;
  const { items, addItem, updateQty } = useCartStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selUnit, setSelUnit] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await storeApi.getProduct(id, storeId, zoneId);
        const found = response.data.data;
        const units = [found.unit, ...(found.weightOptions ?? []).map(option => option.label)];
        const cachedUnit = await AsyncStorage.getItem(`mart-product-unit:${id}`).catch(() => null);
        const inCart = useCartStore.getState().items.find(item => item.productId === id && units.includes(item.unit));
        const requestedUnit = Array.isArray(unit) ? unit[0] : unit;
        const nextUnit = requestedUnit && units.includes(requestedUnit)
          ? requestedUnit
          : inCart?.unit ?? (cachedUnit && units.includes(cachedUnit) ? cachedUnit : found.unit);
        if (cancelled) return;
        setProduct(found);
        setSelUnit(nextUnit);
        track('product_viewed', {
          productId: found.id,
          categoryId: found.categoryId,
          localName: found.localName ?? null,
        });
      } catch {
        if (!cancelled) setProduct(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, storeId, zoneId, unit]);

  const localizedName = product?.localName?.trim() || product?.name || '';
  useEffect(() => {
    if (localizedName) navigation.setOptions({ title: localizedName });
  }, [localizedName, navigation]);

  const selectUnit = useCallback((next: string) => {
    setSelUnit(next);
    if (id) void AsyncStorage.setItem(`mart-product-unit:${id}`, next).catch(() => undefined);
  }, [id]);

  const optionChips = product?.weightOptions?.length
    ? product.weightOptions.filter(option => option.label !== product.unit)
    : [];
  const primaryOption = product?.weightOptions?.find(option => option.label === product?.unit);
  const primaryDiscount = primaryOption ? (primaryOption.discountPercent ?? product?.discountPercent ?? 0) : (product?.discountPercent ?? 0);
  const selectedOption = product?.weightOptions?.find(option => option.label === selUnit) || null;
  const selectedBasePrice = selectedOption ? selectedOption.price : (product?.price ?? 0);
  const selectedDiscount = selectedOption
    ? (selectedOption.label === product?.unit ? (selectedOption.discountPercent ?? product?.discountPercent ?? 0) : (selectedOption.discountPercent ?? 0))
    : (product?.discountPercent ?? 0);
  const discountedPrice = selectedDiscount > 0
    ? Math.round(selectedBasePrice * (1 - selectedDiscount / 100))
    : selectedBasePrice;
  const savings = selectedDiscount > 0
    ? Math.round(selectedBasePrice - discountedPrice)
    : 0;

  const cartItem = items.find(item => item.productId === id && item.unit === selUnit);
  const qty = cartItem?.quantity ?? 0;
  const isOutOfStock = product?.availabilityStatus === 'out_of_stock' || !product?.isAvailable;
  const otherUnitItem = items.find(item => item.productId === id && item.unit !== selUnit);

  const handleAdd = () => {
    if (!product) return;
    const result = addItem(product, selUnit, discountedPrice);
    if (result === 'different_unit' && otherUnitItem) {
      Alert.alert(
        'One size per product',
        `Remove ${otherUnitItem.unit} from your cart before adding ${selUnit}.`,
      );
    }
  };

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

  const imageUri = product.largeUrl ?? product.photoVariants?.[0]?.largeUrl ?? product.photoUrl;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StoreClosedStrip />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={{ marginHorizontal: 16, marginTop: 8, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.gray50, height: IMG_H }}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={{ width: '100%', height: '100%', opacity: isOutOfStock ? 0.5 : 1 }} contentFit="cover" transition={200} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 64 }}>🥦</Text>
            </View>
          )}
          {selectedDiscount > 0 ? (
            <View style={{ position: 'absolute', top: 12, left: 12, backgroundColor: colors.red500, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Inter-Bold' }}>{selectedDiscount}% OFF</Text>
            </View>
          ) : null}
          {isOutOfStock ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter-Bold' }}>Out of Stock</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
          <View>
            <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, lineHeight: 26 }}>
              {localizedName}
            </Text>
            {product.localName?.trim() && product.localName.trim() !== product.name?.trim() ? (
              <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 3 }}>{product.name}</Text>
            ) : null}
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 3 }}>{selUnit || product.unit}</Text>
            {product.categoryName ? (
              <View style={{ marginTop: 6, alignSelf: 'flex-start', backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.primary }}>{product.categoryName}</Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ fontSize: 28, fontFamily: 'Inter-Bold', color: colors.gray900 }}>₹{discountedPrice}</Text>
            {savings > 0 ? (
              <>
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Regular', color: colors.gray400, textDecorationLine: 'line-through' }}>₹{selectedBasePrice}</Text>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: colors.primary }}>Save ₹{savings}</Text>
              </>
            ) : null}
          </View>

          {product.weightOptions && product.weightOptions.length > 0 ? (
            <View>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Select Weight</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity onPress={() => selectUnit(product.unit)}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: selUnit === product.unit ? colors.primary : colors.gray200, backgroundColor: selUnit === product.unit ? colors.primaryLight : colors.surface }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: selUnit === product.unit ? colors.primary : colors.gray700 }}>{product.unit} — ₹{sellingPrice(product.price, primaryDiscount)}</Text>
                </TouchableOpacity>
                {optionChips.map((option, index) => (
                  <TouchableOpacity key={`${option.label}-${index}`} onPress={() => selectUnit(option.label)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: selUnit === option.label ? colors.primary : colors.gray200, backgroundColor: selUnit === option.label ? colors.primaryLight : colors.surface }}>
                    <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: selUnit === option.label ? colors.primary : colors.gray700 }}>{option.label} — ₹{sellingPrice(option.price, option.discountPercent)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {product.description ? (
            <View style={{ backgroundColor: colors.gray50, borderRadius: 16, padding: 14 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>About this product</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray700, lineHeight: 20 }}>{product.description}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, borderTopWidth: 1, borderTopColor: colors.gray100 }}>
        {isOutOfStock ? (
          <View style={{ height: 56, borderRadius: 16, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Out of Stock</Text>
          </View>
        ) : qty === 0 ? (
          <TouchableOpacity onPress={handleAdd}
            style={{ height: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>Add to Cart — ₹{discountedPrice}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ height: 56, borderRadius: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }}>
            <TouchableOpacity onPress={() => updateQty(product.id, selUnit, qty - 1)}
              style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="remove" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#fff' }}>{qty} in cart</Text>
            <TouchableOpacity onPress={handleAdd}
              style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

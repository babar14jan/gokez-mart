import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storeApi, type Category, type Product } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useThemeColors } from '@/constants/theme';
import ProductCard from '@/components/features/ProductCard';
import CartPill from '@/components/features/CartPill';

const SCREEN_W = Dimensions.get('window').width;
// Full-width 2-col grid: screen - (6 outer padding * 2) - (6 gap between cols)
const CARD_W   = Math.floor((SCREEN_W - 18) / 2);

export default function CategoriesScreen() {
  const colors     = useThemeColors();
  const params     = useLocalSearchParams<{ id?: string }>();
  const cartItems  = useCartStore(s => s.items);
  const totalItems = () => cartItems.reduce((s, i) => s + i.quantity, 0);

  const [categories,  setCategories]  = useState<Category[]>([]);
  const [products,    setProducts]    = useState<Product[]>([]);
  const [selected,    setSelected]    = useState<Category | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [prodLoading, setProdLoading] = useState(false);
  const [search,      setSearch]      = useState('');

  const loadCategories = useCallback(async () => {
    try {
      const res = await storeApi.getCategories();
      const cats = res.data.data;
      setCategories(cats);
      const initial = params.id ? cats.find(c => c.id === params.id) ?? cats[0] : cats[0];
      if (initial) { setSelected(initial); loadProducts(initial.id); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [params.id]);

  const loadProducts = async (categoryId: string) => {
    setProdLoading(true);
    try {
      const res = await storeApi.getProducts(categoryId);
      setProducts(res.data.data.filter(p => p.availabilityStatus === 'available'));
    } catch { /* silent */ }
    finally { setProdLoading(false); }
  };

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const selectCategory = (cat: Category) => {
    setSelected(cat);
    loadProducts(cat.id);
  };

  const filteredProducts = products.filter(p => {
    const q = search.toLowerCase();
    return !search || p.name.toLowerCase().includes(q) || (p.localName ?? '').toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgTint }} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
        <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 10 }}>Vegetables</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.gray100 }}>
          <Ionicons name="search-outline" size={16} color={colors.gray400} style={{ marginRight: 8 }} />
          <TextInput
            style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, paddingVertical: 0 }}
            placeholder="Search in this category..."
            placeholderTextColor={colors.gray500}
            value={search} onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.gray400} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Horizontal category chips — gives the grid the full width instead of
          reserving a permanent vertical sidebar. */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
        <FlatList
          data={categories}
          keyExtractor={c => c.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
          renderItem={({ item }) => {
            const active = selected?.id === item.id;
            return (
              <TouchableOpacity
                onPress={() => selectCategory(item)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? colors.primary : colors.gray100,
                }}
              >
                <Image
                  source={{ uri: item.icon }}
                  style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: colors.gray100 }}
                  contentFit="contain"
                />
                <Text style={{ fontSize: 12, fontFamily: active ? 'Inter-SemiBold' : 'Inter-Regular', color: active ? '#fff' : colors.gray600 }}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Products grid — full width */}
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        {selected && (
          <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray800 }}>
              {selected.name}
            </Text>
          </View>
        )}
        {prodLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={filteredProducts}
            keyExtractor={p => p.id}
            numColumns={2}
            contentContainerStyle={{ padding: 6, paddingBottom: 120 }}
            columnWrapperStyle={{ gap: 6, marginBottom: 6 }}
            renderItem={({ item }) => <ProductCard product={item} width={CARD_W} />}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ fontSize: 28, marginBottom: 8 }}>📦</Text>
                <Text style={{ fontSize: 13, color: colors.gray400, fontFamily: 'Inter-Regular' }}>
                  {search ? 'No matching products' : 'No products here'}
                </Text>
              </View>
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {totalItems() > 0 && <CartPill />}
    </SafeAreaView>
  );
}

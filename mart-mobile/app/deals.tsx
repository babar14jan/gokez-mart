import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Dimensions, FlatList, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useZoneStore } from '@/store/zoneStore';
import { useCartStore } from '@/store/cartStore';
import { useThemeColors } from '@/constants/theme';
import { fetchCatalogBundle, reconcileCatalog, type CatalogBundle } from '@/components/HomeSections';
import StoreClosedStrip from '@/components/StoreClosedStrip';
import CartPill from '@/components/features/CartPill';
import ProductCard from '@/components/features/ProductCard';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = Math.floor((SCREEN_W - 32 - 16) / 3);

export default function DealsScreen() {
  const colors = useThemeColors();
  const selectedZone = useZoneStore(state => state.selectedZone);
  const storeId = selectedZone?.storeId;
  const zoneId = selectedZone?.id;
  const cartCount = useCartStore(state => state.totalItems);
  const [bundle, setBundle] = useState<CatalogBundle>({ categories: [], products: [], settings: null, sections: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefresh = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await fetchCatalogBundle(storeId, zoneId, false);
      setBundle(next);
      reconcileCatalog(next);
    } catch {
      return;
    }
  }, [storeId, zoneId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < 15_000) return;
      lastRefresh.current = now;
      void load();
    };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const interval = setInterval(() => { lastRefresh.current = Date.now(); void load(); }, 3 * 60 * 1000);
    return () => { subscription.remove(); clearInterval(interval); };
  }, [load]);

  const deals = bundle.products
    .filter(product => product.discountPercent > 0 && product.availabilityStatus !== 'hidden')
    .sort((a, b) => b.discountPercent - a.discountPercent);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StoreClosedStrip />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={deals}
          keyExtractor={product => product.id}
          numColumns={3}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}
          columnWrapperStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 8 }}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Today&apos;s Deals</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
                Limited-time price drops on everyday essentials
              </Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray500, marginTop: 8, textTransform: 'uppercase' }}>
                {deals.length} deal{deals.length !== 1 ? 's' : ''}
              </Text>
            </View>
          }
          renderItem={({ item }) => <ProductCard product={item} width={CARD_W} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="pricetag-outline" size={40} color={colors.gray400} style={{ marginBottom: 8 }} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>No deals right now</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 4 }}>Check back soon — fresh offers are added often.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
      {cartCount() > 0 ? <CartPill /> : null}
    </View>
  );
}

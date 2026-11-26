import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCartStore } from '@/store/cartStore';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeColors } from '@/constants/theme';
import { fetchCatalogBundle, reconcileCatalog, type CatalogBundle } from '@/components/HomeSections';
import CatalogSearchSheet from '@/components/CatalogSearchSheet';
import CartPill from '@/components/features/CartPill';

export default function CategoriesScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id?: string; slug?: string }>();
  const selectedZone = useZoneStore(state => state.selectedZone);
  const storeId = selectedZone?.storeId;
  const zoneId = selectedZone?.id;
  const cartCount = useCartStore(state => state.totalItems);
  const [bundle, setBundle] = useState<CatalogBundle>({ categories: [], products: [], settings: null, sections: [] });
  const [loading, setLoading] = useState(true);
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

  const initialCategoryId = useMemo(() => {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
    if (id && bundle.categories.some(category => category.id === id)) return id;
    if (slug) {
      const match = bundle.categories.find(category => String(category.slug).toLowerCase() === String(slug).toLowerCase());
      if (match) return match.id;
    }
    return null;
  }, [bundle.categories, params.id, params.slug]);

  const handleRefresh = useCallback(async () => {
    await load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
        <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: colors.gray900 }}>Categories</Text>
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <CatalogSearchSheet
          categories={bundle.categories}
          products={bundle.products}
          placeholder="Search any product, all categories"
          initialCategoryId={initialCategoryId}
          onRefresh={handleRefresh}
        />
      )}
      {cartCount() > 0 ? <CartPill /> : null}
    </SafeAreaView>
  );
}

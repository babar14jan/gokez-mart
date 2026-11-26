import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useZoneStore } from '@/store/zoneStore';
import { useCartStore } from '@/store/cartStore';
import { useThemeColors } from '@/constants/theme';
import { fetchCatalogBundle, reconcileCatalog, type CatalogBundle } from '@/components/HomeSections';
import CatalogSearchSheet from '@/components/CatalogSearchSheet';
import StoreClosedStrip from '@/components/StoreClosedStrip';
import CartPill from '@/components/features/CartPill';

export default function SearchScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const selectedZone = useZoneStore(state => state.selectedZone);
  const storeId = selectedZone?.storeId;
  const zoneId = selectedZone?.id;
  const cartCount = useCartStore(state => state.totalItems);
  const [bundle, setBundle] = useState<CatalogBundle>({ categories: [], products: [], settings: null, sections: [] });
  const [loading, setLoading] = useState(true);
  const lastRefresh = useRef(0);

  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const categorySlug = Array.isArray(params.category) ? params.category[0] : params.category;

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

  const initialCategoryId = categorySlug
    ? bundle.categories.find(category => String(category.slug).toLowerCase() === String(categorySlug).toLowerCase())?.id ?? null
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StoreClosedStrip />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <CatalogSearchSheet
          categories={bundle.categories}
          products={bundle.products}
          placeholder="Search any product, all categories"
          initialQuery={query ?? null}
          initialCategoryId={initialCategoryId}
          autoFocus
          onRefresh={load}
        />
      )}
      {cartCount() > 0 ? <CartPill /> : null}
    </View>
  );
}

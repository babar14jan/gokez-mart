import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AppState, FlatList, Modal, RefreshControl, ScrollView,
  Text, TouchableOpacity, View, ActivityIndicator, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  authApi, campaignApi, storeApi,
  type CarouselCard, type Category, type HomeSection, type MartZone, type Product, type PublicSettings,
} from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';
import { getUserLocation, requestAndGetLocation, findMatchingZone } from '@/services/geofence';
import { readClosedCopy, rememberClosedCopy } from '@/utils/storeClosed';
import ProductCard from '@/components/features/ProductCard';
import HomeCarousel from '@/components/features/HomeCarousel';
import CartPill from '@/components/features/CartPill';
import HomeSections, {
  fetchCatalogBundle, reconcileCatalog, resolveSections, type CatalogBundle, type ResolvedSection,
} from '@/components/HomeSections';
import StoreClosedCard from '@/components/StoreClosedCard';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = Math.floor((SCREEN_W - 32 - 8) / 3);

interface ClosedNotice {
  greeting?: string | null;
  message?: string | null;
  resumeLabel?: string | null;
}

export default function HomeScreen() {
  const colors = useThemeColors();
  const isDark = useThemeStore(state => state.isDark);
  const toggleTheme = useThemeStore(state => state.toggle);
  const isLoggedIn = useAuthStore(state => state.isLoggedIn);
  const cartItems = useCartStore(state => state.items);
  const clearCart = useCartStore(state => state.clearCart);
  const zones = useZoneStore(state => state.zones);
  const selectedZone = useZoneStore(state => state.selectedZone);
  const setZones = useZoneStore(state => state.setZones);
  const setSelectedZone = useZoneStore(state => state.setSelectedZone);
  const storeId = selectedZone?.storeId;
  const zoneId = selectedZone?.id;

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [carousel, setCarousel] = useState<CarouselCard[]>([]);
  const [activeCat, setActiveCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [outsideWarning, setOutsideWarning] = useState(false);
  const [closedNotice, setClosedNotice] = useState<ClosedNotice | null>(null);
  const [buyAgainIds, setBuyAgainIds] = useState<string[]>([]);

  const stampRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const selectionRef = useRef({ storeId, zoneId });
  const closedShownRef = useRef(false);
  const lastResumeRefresh = useRef(Date.now());
  selectionRef.current = { storeId, zoneId };

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const applyBundle = useCallback((bundle: CatalogBundle) => {
    setCategories(bundle.categories);
    setProducts(bundle.products);
    setSections(bundle.sections);
    setSettings(bundle.settings);
    reconcileCatalog(bundle);
    rememberClosedCopy(bundle.settings?.store_closed_greeting, bundle.settings?.store_closed_message);
    if (bundle.settings?.openState?.isOpen === false && !closedShownRef.current) {
      closedShownRef.current = true;
      const cached = readClosedCopy();
      setClosedNotice({
        greeting: bundle.settings?.store_closed_greeting?.trim() || cached?.greeting || null,
        message: bundle.settings?.store_closed_message?.trim() || cached?.message || null,
        resumeLabel: bundle.settings?.openState?.closedUntilLabel ?? bundle.settings?.openState?.nextOpenLabel ?? null,
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let bodyDone = false;
    setLoading(true);
    stampRef.current = null;
    void storeApi.getCatalogStamp(storeId, zoneId).then(response => {
      if (!cancelled && !bodyDone) stampRef.current = response.data.data?.stamp ?? null;
    }).catch(() => undefined);
    void fetchCatalogBundle(storeId, zoneId)
      .then(bundle => {
        if (!cancelled) applyBundle(bundle);
      })
      .catch(() => undefined)
      .finally(() => {
        bodyDone = true;
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [storeId, zoneId, applyBundle]);

  const refreshCatalog = useCallback(async (force = false) => {
    const generation = ++generationRef.current;
    const isStale = () => generation !== generationRef.current
      || selectionRef.current.storeId !== storeId
      || selectionRef.current.zoneId !== zoneId;
    let stamp: string | null = null;
    try {
      const response = await storeApi.getCatalogStamp(storeId, zoneId);
      stamp = response.data.data?.stamp ?? null;
      if (!force && stamp !== null && stamp === stampRef.current) return;
    } catch {
      stamp = null;
    }
    try {
      const bundle = await fetchCatalogBundle(storeId, zoneId);
      if (isStale()) return;
      applyBundle(bundle);
      stampRef.current = stamp;
    } catch {
      return;
    }
  }, [storeId, zoneId, applyBundle]);

  const refreshCatalogRef = useRef(refreshCatalog);
  refreshCatalogRef.current = refreshCatalog;

  const switchZone = useCallback((zone: MartZone) => {
    const applyZone = () => {
      setSelectedZone(zone, true);
      setOutsideWarning(false);
      void refreshCatalogRef.current(true);
    };
    const current = useZoneStore.getState().selectedZone;
    const changed = !!current && (current.id !== zone.id || current.storeId !== zone.storeId);
    if (changed && useCartStore.getState().items.length > 0) {
      Alert.alert(
        'Change delivery area?',
        `Your cart was built for ${current?.name || 'the current area'}. Switching to ${zone.name} will clear it because products and prices can differ by area.`,
        [
          { text: 'Keep current area', style: 'cancel' },
          { text: 'Change and clear cart', style: 'destructive', onPress: () => { clearCart(); applyZone(); } },
        ],
      );
      return;
    }
    applyZone();
  }, [clearCart, setSelectedZone]);

  useEffect(() => {
    const refresh = (force = false) => {
      const now = Date.now();
      if (!force && now - lastResumeRefresh.current < 15_000) return;
      lastResumeRefresh.current = now;
      void refreshCatalog(force);
    };
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const interval = setInterval(() => { lastResumeRefresh.current = Date.now(); void refreshCatalog(); }, 3 * 60 * 1000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [refreshCatalog]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [zonesRes, carouselRes] = await Promise.all([
          storeApi.getZones(),
          campaignApi.getCarousel(),
        ]);
        if (cancelled) return;
        const fetchedZones = zonesRes.data.data ?? [];
        setZones(fetchedZones);
        setCarousel(carouselRes.data.data ?? []);
        const { zoneSelected, autoDetect } = useZoneStore.getState();
        const current = useZoneStore.getState().selectedZone;
        const zoneToUse = current ?? fetchedZones[0] ?? null;
        if (zoneToUse && !current) setSelectedZone(zoneToUse);
        if (!zoneSelected && autoDetect && fetchedZones.length) {
          const location = await getUserLocation();
          if (cancelled || !location) return;
          const match = findMatchingZone(location.lat, location.lng, fetchedZones);
          if (match) {
            const matchedZone = fetchedZones.find(zone => zone.id === match.zone.id) ?? match.zone;
            if (useZoneStore.getState().selectedZone?.id !== matchedZone.id) {
              switchZone(matchedZone);
            }
          } else {
            setOutsideWarning(true);
          }
        }
      } catch {
        return;
      }
    })();
    return () => { cancelled = true; };
  }, [setZones, setSelectedZone, switchZone]);

  const hasBuyAgain = sections.some(section => section.isEnabled
    && (section.kind === 'buy_again' || section.sectionKey === 'buy_again'));
  useEffect(() => {
    if (!isLoggedIn || !hasBuyAgain) {
      setBuyAgainIds([]);
      return;
    }
    let cancelled = false;
    void authApi.getOrders().then(response => {
      if (cancelled) return;
      const ids = (response.data.data ?? [])
        .flatMap(order => order.items ?? [])
        .map(item => item.productId);
      setBuyAgainIds([...new Set(ids)]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isLoggedIn, hasBuyAgain]);

  const nextOpenAt = settings?.openState?.isOpen === false ? settings.openState.nextOpenAt : null;
  useEffect(() => {
    if (!nextOpenAt) return;
    const delay = Date.parse(nextOpenAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
    const timer = setTimeout(() => {
      stampRef.current = null;
      setClosedNotice(null);
      void refreshCatalog(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [nextOpenAt, refreshCatalog]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshCatalog(true).finally(() => setRefreshing(false));
  }, [refreshCatalog]);

  const handleDetectLocation = async () => {
    const location = await requestAndGetLocation();
    if (!location) return;
    const match = findMatchingZone(location.lat, location.lng, zones);
    if (!match) {
      setOutsideWarning(true);
      return;
    }
    switchZone(match.zone);
  };

  const resolvedSections: ResolvedSection[] = useMemo(
    () => resolveSections(sections, products, categories, buyAgainIds),
    [sections, products, categories, buyAgainIds],
  );

  const browseProducts = useMemo(() => {
    const scoped = activeCat === 'all' ? products : products.filter(product => product.categoryId === activeCat);
    return scoped;
  }, [products, activeCat]);

  const handleViewAll = useCallback((section: HomeSection, items: Product[]) => {
    const kind = section.kind ?? section.sectionKey ?? '';
    if (kind === 'deals') {
      router.push('/deals' as any);
      return;
    }
    const slug = section.config?.categorySlug ?? section.config?.categorySlugs?.[0];
    if (slug) {
      router.push({ pathname: '/search', params: { category: slug } } as any);
      return;
    }
    if (kind === 'buy_again' && items.length) {
      router.push({ pathname: '/search', params: { q: items[0].localName?.trim() || items[0].name } } as any);
      return;
    }
    router.push('/search' as any);
  }, []);

  const handleSelectCategory = useCallback((slug: string) => {
    router.push({ pathname: '/search', params: { category: slug } } as any);
  }, []);

  const categoryChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
      <TouchableOpacity
        onPress={() => setActiveCat('all')}
        style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: activeCat === 'all' ? colors.primary : colors.surface, borderWidth: 1, borderColor: activeCat === 'all' ? colors.primary : colors.gray200 }}
      >
        <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: activeCat === 'all' ? '#fff' : colors.gray700 }}>All</Text>
      </TouchableOpacity>
      {categories.map(category => (
        <TouchableOpacity
          key={category.id}
          onPress={() => setActiveCat(category.id)}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: activeCat === category.id ? colors.primary : colors.surface, borderWidth: 1, borderColor: activeCat === category.id ? colors.primary : colors.gray200 }}
        >
          <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: activeCat === category.id ? '#fff' : colors.gray700 }}>{category.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const listHeader = (
    <>
      {carousel.length > 0 ? <HomeCarousel cards={carousel} /> : null}
      {categoryChips}
      {activeCat !== 'all' ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>
            {categories.find(category => category.id === activeCat)?.name}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
            {browseProducts.length} product{browseProducts.length !== 1 ? 's' : ''}
          </Text>
        </View>
      ) : (
        <HomeSections
          entries={resolvedSections}
          categories={categories}
          onViewAll={handleViewAll}
          onSelectCategory={handleSelectCategory}
        />
      )}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgTint }} edges={['top']}>
      <View style={{ backgroundColor: colors.bgTint, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Image
            source={isDark ? require('../../assets/brand_dark.png') : require('../../assets/brand_light.png')}
            style={{ width: 168, height: 48, marginLeft: -28 }}
            contentFit="contain"
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={toggleTheme} style={{ padding: 4 }}>
              <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.gray700} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDetectLocation} style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Delivering to</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.gray900, maxWidth: 120 }} numberOfLines={1}>
                  {selectedZone ? selectedZone.name : 'Detect location'}
                </Text>
                <Text style={{ color: colors.primary, fontSize: 12 }}>▾</Text>
              </View>
            </TouchableOpacity>
            {totalItems > 0 ? (
              <TouchableOpacity onPress={() => router.push('/checkout')} style={{ position: 'relative', padding: 4 }}>
                <Ionicons name="bag-outline" size={24} color={colors.gray700} />
                <View style={{ position: 'absolute', top: 0, right: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Inter-Bold', color: '#fff' }}>{totalItems}</Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/search' as any)}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.gray100 }}
        >
          <Ionicons name="search-outline" size={16} color={colors.gray400} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500 }}>Fresh Vegetables, Groceries...</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={activeCat === 'all' ? [] : browseProducts}
          keyExtractor={product => product.id}
          numColumns={3}
          ListHeaderComponent={listHeader}
          columnWrapperStyle={{ paddingHorizontal: 16, gap: 4, marginBottom: 4 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item }) => <ProductCard product={item} width={CARD_W} />}
          ListEmptyComponent={activeCat !== 'all' ? (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>🛒</Text>
              <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>No products found</Text>
            </View>
          ) : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {totalItems > 0 ? <CartPill /> : null}

      <StoreClosedCard
        open={!!closedNotice}
        onClose={() => setClosedNotice(null)}
        greeting={closedNotice?.greeting}
        message={closedNotice?.message}
        resumeLabel={closedNotice?.resumeLabel}
      />

      <Modal visible={outsideWarning} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 24, padding: 24, width: '100%', alignItems: 'center' }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📍</Text>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', marginBottom: 8 }}>We&apos;re not in your area yet</Text>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 4 }}>
              Gokez Mart currently delivers within <Text style={{ fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>{selectedZone?.radiusKm ?? 5}km of {selectedZone?.name ?? 'your area'}</Text>.
            </Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary, textAlign: 'center', marginBottom: 20 }}>🚀 We&apos;re expanding soon!</Text>
            <TouchableOpacity style={{ width: '100%', height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }} onPress={() => setOutsideWarning(false)}>
              <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 15 }}>Continue Browsing</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Modal, ScrollView, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { storeApi, campaignApi, type Product, type Category, type CarouselCard } from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';
import { getUserLocation, requestAndGetLocation, findMatchingZone } from '@/services/geofence';
import ProductCard from '@/components/features/ProductCard';
import HomeCarousel from '@/components/features/HomeCarousel';
import CartPill from '@/components/features/CartPill';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W   = Math.floor((SCREEN_W - 32 - 8) / 3); // 3 cols, 16px side padding, 4px gaps

export default function HomeScreen() {
  const cartItems  = useCartStore(s => s.items);
  const totalItems = () => cartItems.reduce((s, i) => s + i.quantity, 0);
  const { zones, selectedZone, setZones, setSelectedZone } = useZoneStore();
  const colors     = useThemeColors();
  const isDark     = useThemeStore(s => s.isDark);
  const toggleTheme = useThemeStore(s => s.toggle);

  const [categories,     setCategories]     = useState<Category[]>([]);
  const [products,       setProducts]       = useState<Product[]>([]);
  const [carousel,       setCarousel]       = useState<CarouselCard[]>([]);
  const [activeCat,      setActiveCat]      = useState('all');
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [outsideWarning, setOutsideWarning] = useState(false);

  const loadProducts = useCallback(async (storeId?: string) => {
    try {
      const [catRes, prodRes] = await Promise.all([
        storeApi.getCategories(),
        storeApi.getProducts(undefined, storeId),
      ]);
      setCategories(catRes.data.data);
      setProducts(prodRes.data.data.filter(p => p.availabilityStatus === 'available'));
    } catch { /* silent */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const [zonesRes, carRes] = await Promise.all([
        storeApi.getZones(),
        campaignApi.getCarousel(),
      ]);
      const fetchedZones = zonesRes.data.data ?? [];
      setZones(fetchedZones);
      setCarousel(carRes.data.data ?? []);
      const currentZone = useZoneStore.getState().selectedZone;
      const zoneToUse   = currentZone ?? (fetchedZones.length > 0 ? fetchedZones[0] : null);
      if (zoneToUse && !currentZone) setSelectedZone(zoneToUse);
      await loadProducts(zoneToUse?.storeId);
      if (fetchedZones.length > 0) {
        const loc = await getUserLocation();
        if (loc) {
          const match = findMatchingZone(loc.lat, loc.lng, fetchedZones);
          if (match) { setSelectedZone(match.zone, true); await loadProducts(match.zone.storeId); }
          else setOutsideWarning(true);
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDetectLocation = async () => {
    const loc = await requestAndGetLocation();
    if (!loc) return;
    const match = findMatchingZone(loc.lat, loc.lng, zones);
    if (match) {
      setSelectedZone(match.zone, true);
      setOutsideWarning(false);
      setLoading(true);
      await loadProducts(match.zone.storeId);
      setLoading(false);
    } else { setOutsideWarning(true); }
  };

  // Filter products
  const filtered = products.filter(p => {
    const matchCat    = activeCat === 'all' || p.categoryId === activeCat;
    const q           = search.toLowerCase();
    const matchSearch = !search || p.name.toLowerCase().includes(q) || (p.localName ?? '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const ListHeader = () => (
    <>
      {/* Carousel */}
      {carousel.length > 0 && <HomeCarousel cards={carousel} />}

      {/* Category tabs */}
      {categories.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
        >
          <TouchableOpacity
            onPress={() => setActiveCat('all')}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: activeCat === 'all' ? colors.primary : colors.surface, borderWidth: 1, borderColor: activeCat === 'all' ? colors.primary : colors.gray200 }}
          >
            <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: activeCat === 'all' ? '#fff' : colors.gray700 }}>All</Text>
          </TouchableOpacity>
          {categories.map(cat => (
            <TouchableOpacity key={cat.id} onPress={() => setActiveCat(cat.id)}
              style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: activeCat === cat.id ? colors.primary : colors.surface, borderWidth: 1, borderColor: activeCat === cat.id ? colors.primary : colors.gray200 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: activeCat === cat.id ? '#fff' : colors.gray700 }}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Category label when filtered */}
      {activeCat !== 'all' && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900 }}>
            {categories.find(c => c.id === activeCat)?.name}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>
            {filtered.length} product{filtered.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgTint }} edges={['top']}>
      {/* Header */}
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
            {totalItems() > 0 && (
              <TouchableOpacity onPress={() => router.push('/checkout')} style={{ position: 'relative', padding: 4 }}>
                <Ionicons name="bag-outline" size={24} color={colors.gray700} />
                <View style={{ position: 'absolute', top: 0, right: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Inter-Bold', color: '#fff' }}>{totalItems()}</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {/* Search */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.gray100 }}>
          <Ionicons name="search-outline" size={16} color={colors.gray400} style={{ marginRight: 8 }} />
          <TextInput
            style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, paddingVertical: 0 }}
            placeholder="Fresh Vegetables, Groceries..."
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

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={p => p.id}
          numColumns={3}
          ListHeaderComponent={<ListHeader />}
          columnWrapperStyle={{ paddingHorizontal: 16, gap: 4, marginBottom: 4 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item }) => <ProductCard product={item} width={CARD_W} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>🛒</Text>
              <Text style={{ fontSize: 15, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>No products found</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {totalItems() > 0 && <CartPill />}

      {/* Outside zone warning */}
      <Modal visible={outsideWarning} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 24, padding: 24, width: '100%', alignItems: 'center' }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📍</Text>
            <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', marginBottom: 8 }}>We're not in your area yet</Text>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 4 }}>
              Gokez Mart currently delivers within <Text style={{ fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>{selectedZone?.radiusKm ?? 5}km of {selectedZone?.name ?? 'your area'}</Text>.
            </Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-SemiBold', color: colors.primary, textAlign: 'center', marginBottom: 20 }}>🚀 We're expanding soon!</Text>
            <TouchableOpacity style={{ width: '100%', height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }} onPress={() => setOutsideWarning(false)}>
              <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 15 }}>Continue Browsing</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

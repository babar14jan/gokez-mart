import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, FlatList, Keyboard, RefreshControl,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Category, Product } from '@/services/api';
import { useThemeColors } from '@/constants/theme';
import ProductCard from '@/components/features/ProductCard';
import { searchProducts, sortProductsForCustomer } from '@/utils/productMatch';
import { track } from '@/utils/track';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = Math.floor((SCREEN_W - 32 - 16) / 3);
const RECENT_KEY = 'mart_recent_searches';

interface Props {
  categories: Category[];
  products: Product[];
  placeholder?: string;
  initialQuery?: string | null;
  initialCategoryId?: string | null;
  autoFocus?: boolean;
  onRefresh?: () => Promise<void>;
}

export default function CatalogSearchSheet({
  categories,
  products,
  placeholder = 'Search any product, all categories',
  initialQuery,
  initialCategoryId,
  autoFocus = false,
  onRefresh,
}: Props) {
  const colors = useThemeColors();
  const [query, setQuery] = useState(initialQuery ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId ?? null);
  const [recent, setRecent] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const lastTracked = useRef('');

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then(raw => {
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecent(parsed.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 8));
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== null) setQuery(initialQuery);
    if (initialCategoryId !== undefined) setCategoryId(initialCategoryId);
  }, [initialQuery, initialCategoryId]);

  const normalized = query.trim().toLowerCase();
  const ordered = useMemo(() => sortProductsForCustomer(products), [products]);
  const results = useMemo(() => {
    if (normalized) return searchProducts(products, normalized);
    return ordered.filter(product => !categoryId || product.categoryId === categoryId);
  }, [normalized, products, ordered, categoryId]);
  const suggestions = useMemo(
    () => (normalized ? results.slice(0, 8) : []),
    [normalized, results],
  );
  const categoriesWithProducts = useMemo(
    () => categories.filter(category => products.some(product => product.categoryId === category.id)),
    [categories, products],
  );

  useEffect(() => {
    if (normalized.length < 2) return;
    const timer = setTimeout(() => {
      if (lastTracked.current === normalized) return;
      lastTracked.current = normalized;
      track('product_search', { itemCount: results.length });
      if (results.length === 0) track('search_zero_results');
    }, 700);
    return () => clearTimeout(timer);
  }, [normalized, results.length]);

  const recordRecent = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecent(current => {
      const next = [trimmed, ...current.filter(item => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
      void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    void AsyncStorage.removeItem(RECENT_KEY).catch(() => undefined);
  }, []);

  const selectCategory = useCallback((id: string | null) => {
    setCategoryId(id);
    setQuery('');
    if (id) track('category_viewed', { categoryId: id });
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const header = useCallback(() => (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.gray100, backgroundColor: colors.surface, paddingHorizontal: 12, gap: 8 }}>
        <Ionicons name="search-outline" size={17} color={colors.gray400} />
        <TextInput
          autoFocus={autoFocus}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.gray500}
          returnKeyType="search"
          onSubmitEditing={() => { recordRecent(query); Keyboard.dismiss(); }}
          style={{ flex: 1, fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray900, paddingVertical: 0 }}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.gray400} />
          </TouchableOpacity>
        ) : null}
      </View>

      {!normalized ? (
        <FlatList
          data={[{ id: 'all', name: 'All' }, ...categoriesWithProducts]}
          keyExtractor={item => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => {
            const active = item.id === 'all' ? !categoryId : categoryId === item.id;
            return (
              <TouchableOpacity
                onPress={() => selectCategory(item.id === 'all' ? null : item.id)}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: active ? colors.primary : colors.gray100 }}
              >
                <Text style={{ fontSize: 12, fontFamily: active ? 'Inter-SemiBold' : 'Inter-Regular', color: active ? '#fff' : colors.gray700 }}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      ) : null}

      {!normalized && suggestions.length === 0 && recent.length > 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: colors.gray700 }}>Recent searches</Text>
            <TouchableOpacity onPress={clearRecent}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Clear</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={recent}
            keyExtractor={item => item}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => { setQuery(item); recordRecent(item); }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gray200 }}
              >
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray700 }}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : null}

      {normalized ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>
            Showing results for “{query.trim()}”
          </Text>
          {suggestions.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.slice(0, 4).map(product => (
                <TouchableOpacity
                  key={product.id}
                  onPress={() => { setQuery(product.localName?.trim() || product.name); recordRecent(product.localName?.trim() || product.name); }}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.gray100 }}
                >
                  <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray700 }} numberOfLines={1}>
                    {product.localName?.trim() || product.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  ), [autoFocus, categoryId, clearRecent, colors, normalized, placeholder, query, recordRecent, selectCategory, suggestions, categoriesWithProducts]);

  return (
    <FlatList
      data={results}
      keyExtractor={product => product.id}
      numColumns={3}
      columnWrapperStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 8 }}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 120, paddingHorizontal: 0 }}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <View style={{ width: CARD_W }}>
          <ProductCard product={item} width={CARD_W} />
        </View>
      )}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 }}>
          {products.length === 0 ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Ionicons name="search-outline" size={36} color={colors.gray400} style={{ marginBottom: 8 }} />
              <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900, textAlign: 'center' }}>
                {normalized ? `No products found for “${query.trim()}”` : 'No products here'}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginTop: 4 }}>
                Try another spelling, a local name, or browse another category.
              </Text>
            </>
          )}
        </View>
      }
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={refreshing} onRefresh={() => { void handleRefresh(); }} tintColor={colors.primary} />
      ) : undefined}
      showsVerticalScrollIndicator={false}
    />
  );
}

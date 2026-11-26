import { ScrollView, Text, TouchableOpacity, View, Dimensions, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import ProductCard from '@/components/features/ProductCard';
import {
  storeApi,
  type Category,
  type HomeSection,
  type Product,
  type PublicSettings,
} from '@/services/api';
import { useCartStore } from '@/store/cartStore';
import { useThemeColors } from '@/constants/theme';

const SCREEN_W = Dimensions.get('window').width;
const SIDE_PAD = 16;
const GAP = 8;

export interface CatalogBundle {
  categories: Category[];
  products: Product[];
  settings: PublicSettings | null;
  sections: HomeSection[];
}

export async function fetchCatalogBundle(
  storeId?: string,
  zoneId?: string,
  includeSections = true,
): Promise<CatalogBundle> {
  const requests: Promise<unknown>[] = [
    storeApi.getCategories(),
    storeApi.getProducts(undefined, storeId, zoneId),
    storeApi.getSettings(storeId, zoneId),
    includeSections ? storeApi.getHomeSections(storeId) : Promise.resolve(null),
  ];
  const [catRes, prodRes, settingsRes, sectionsRes] = await Promise.all(requests);
  const categories = ((catRes as Awaited<ReturnType<typeof storeApi.getCategories>>).data.data) ?? [];
  const products = ((prodRes as Awaited<ReturnType<typeof storeApi.getProducts>>).data.data) ?? [];
  const settings = ((settingsRes as Awaited<ReturnType<typeof storeApi.getSettings>>).data.data) ?? null;
  const sections = includeSections
    ? ((sectionsRes as Awaited<ReturnType<typeof storeApi.getHomeSections>> | null)?.data.data ?? [])
    : [];
  return { categories, products, settings, sections };
}

export function reconcileCatalog(bundle: CatalogBundle): void {
  const enforceOutOfStock = bundle.settings?.inventory_tracking === 'true'
    && bundle.settings?.auto_out_of_stock === 'on_zero';
  useCartStore.getState().reconcileWithCatalog(bundle.products, enforceOutOfStock);
}

export function sectionKind(section: HomeSection): string {
  return section.kind || section.sectionKey || 'manual';
}

function categoryIdsForSlugs(section: HomeSection, categories: Category[]): string[] {
  const raw = section.config?.categorySlugs?.length
    ? section.config.categorySlugs
    : section.config?.categorySlug ? [section.config.categorySlug] : [];
  const wanted = new Set(raw.map(slug => String(slug).toLowerCase()));
  return categories
    .filter(category => wanted.has(String(category.slug ?? '').toLowerCase()))
    .map(category => category.id);
}

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sortByConfig(list: Product[], section: HomeSection): Product[] {
  const sort = section.config?.sort ?? 'catalogue';
  const sorted = [...list];
  if (sort === 'discount') {
    return sorted.sort((a, b) => finite(b.discountPercent) - finite(a.discountPercent));
  }
  if (sort === 'price_asc') {
    return sorted.sort((a, b) => finite(a.price) - finite(b.price));
  }
  if (sort === 'price_desc') {
    return sorted.sort((a, b) => finite(b.price) - finite(a.price));
  }
  if (sort === 'newest') {
    return sorted.sort((a, b) => finite(b.sortOrder) - finite(a.sortOrder) || a.name.localeCompare(b.name));
  }
  if (sort === 'bestselling') {
    return sorted.sort((a, b) => finite(b.sortOrder) - finite(a.sortOrder) || a.name.localeCompare(b.name));
  }
  return sorted.sort((a, b) => finite(a.sortOrder) - finite(b.sortOrder) || a.name.localeCompare(b.name));
}

export function resolveSectionItems(
  section: HomeSection,
  products: Product[],
  categories: Category[],
  buyAgainIds: string[] = [],
): Product[] {
  const kind = sectionKind(section);
  if (kind === 'referral_banner' || kind === 'category_tiles') return [];

  const byId = new Map(products.map(product => [product.id, product]));
  const config = section.config ?? {};
  const excluded = new Set(config.excludeProductIds ?? []);
  const minDiscount = Math.max(0, finite(config.minDiscount));
  const categoryIds = categoryIdsForSlugs(section, categories);
  const hasSlugs = !!config.categorySlug || !!config.categorySlugs?.length;
  let list = products.filter(product => product.availabilityStatus !== 'hidden' && !excluded.has(product.id));

  if (config.inStockOnly) {
    list = list.filter(product => product.isAvailable && product.availabilityStatus === 'available');
  }
  if (hasSlugs) {
    if (!categoryIds.length) return [];
    const wanted = new Set(categoryIds);
    list = list.filter(product => wanted.has(product.categoryId));
  }

  if (Array.isArray(section.items) && section.items.length) {
    list = section.items
      .map(item => byId.get(item.id) ?? item)
      .filter(product => product && !excluded.has(product.id));
  } else if (kind === 'manual' || kind === 'top_picks') {
    const ids = config.productIds ?? [];
    if (!ids.length) return [];
    list = ids.map(id => byId.get(id)).filter((product): product is Product => !!product && !excluded.has(product.id));
  } else if (kind === 'combo' || kind === 'todays_combos') {
    list = list.filter(product => product.isBundle);
    if (config.productIds?.length) {
      const wanted = new Set(config.productIds);
      list = list.filter(product => wanted.has(product.id));
    }
  } else if (kind === 'deals') {
    list = list.filter(product => finite(product.discountPercent) > minDiscount);
  } else if (kind === 'buy_again') {
    const ids = buyAgainIds.length ? buyAgainIds : (config.productIds ?? []);
    if (!ids.length) return [];
    list = ids.map(id => byId.get(id)).filter((product): product is Product => !!product && !excluded.has(product.id));
  } else if (kind === 'fresh' || kind === 'fresh_vegetables') {
    list = list.filter(product => !product.isBundle);
  } else if (kind === 'banner' || kind === 'referral_banner') {
    return [];
  }

  list = sortByConfig(list, section);
  if (kind === 'deals' && !config.sort) {
    list = [...list].sort((a, b) => finite(b.discountPercent) - finite(a.discountPercent));
  }
  if (kind === 'category' && config.productIds?.length) {
    const picked = new Set(config.productIds);
    list = [
      ...config.productIds.map(id => byId.get(id)).filter((product): product is Product => !!product),
      ...list.filter(product => !picked.has(product.id)),
    ];
  }

  const limit = finite(config.limit);
  return limit > 0 ? list.slice(0, limit) : list;
}

export function sectionLayout(section: HomeSection): 'row' | 'grid' | 'hero' | 'tiles' {
  const layout = section.layout ?? section.config?.layout;
  if (layout === 'row' || layout === 'grid' || layout === 'hero' || layout === 'tiles') return layout;
  const kind = sectionKind(section);
  if (kind === 'banner' || kind === 'referral_banner') return 'hero';
  if (kind === 'category_tiles') return 'tiles';
  if (kind === 'category' || kind === 'fresh' || kind === 'fresh_vegetables') return 'grid';
  return 'row';
}

export interface ResolvedSection {
  section: HomeSection;
  items: Product[];
}

export function resolveSections(
  sections: HomeSection[],
  products: Product[],
  categories: Category[],
  buyAgainIds: string[] = [],
): ResolvedSection[] {
  const now = Date.now();
  return [...sections]
    .filter(section => {
      if (!section.isEnabled) return false;
      if (section.startsAt && Date.parse(section.startsAt) > now) return false;
      if (section.endsAt && Date.parse(section.endsAt) < now) return false;
      return true;
    })
    .sort((a, b) => {
      const aTiles = sectionKind(a) === 'category_tiles';
      const bTiles = sectionKind(b) === 'category_tiles';
      if (aTiles !== bTiles) return aTiles ? 1 : -1;
      return finite(a.sortOrder) - finite(b.sortOrder);
    })
    .map(section => ({ section, items: resolveSectionItems(section, products, categories, buyAgainIds) }))
    .filter(entry => entry.items.length > 0 || sectionLayout(entry.section) === 'tiles' || !!entry.section.config?.imageUrl);
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, char => char.toUpperCase());
}

function gridColumns(section: HomeSection): number {
  const columns = finite(section.config?.columns ?? null);
  if (columns === 2 || columns === 3 || columns === 4) return columns;
  return SCREEN_W >= 600 ? 4 : 3;
}

function gridCardWidth(columns: number): number {
  return Math.floor((SCREEN_W - SIDE_PAD * 2 - GAP * (columns - 1)) / columns);
}

function resolveHref(
  href: string,
  onSelectCategory: (slug: string) => void,
): void {
  if (href.startsWith('/category/')) {
    const slug = href.split('/category/')[1]?.split('?')[0];
    if (slug) onSelectCategory(decodeURIComponent(slug));
    return;
  }
  if (href.startsWith('/product/')) {
    router.push(`/product/${encodeURIComponent(href.split('/product/')[1]?.split('?')[0] ?? '')}`);
    return;
  }
  if (href.startsWith('#deals') || href.startsWith('/deals')) {
    router.push('/deals' as any);
    return;
  }
  if (href.startsWith('#') || href.startsWith('/search')) {
    router.push('/search' as any);
  }
}

interface Props {
  entries: ResolvedSection[];
  categories: Category[];
  onViewAll: (section: HomeSection, items: Product[]) => void;
  onSelectCategory: (slug: string) => void;
}

export default function HomeSections({ entries, categories, onViewAll, onSelectCategory }: Props) {
  const colors = useThemeColors();
  const tileColumns = SCREEN_W >= 600 ? 6 : 4;

  return (
    <View style={styles.container}>
      {entries.map(({ section, items }) => {
        const layout = sectionLayout(section);
        const config = section.config ?? {};
        const cta = String((config as Record<string, unknown>).buttonText
          ?? (config as Record<string, unknown>).cta
          ?? section.badge
          ?? (config.href ? 'Shop now' : ''));
        const heading = titleCase(section.title || '');

        if (layout === 'hero' && config.imageUrl) {
          return (
            <View key={section.id} style={styles.section}>
              <TouchableOpacity
                activeOpacity={config.href ? 0.9 : 1}
                onPress={() => { if (config.href) resolveHref(config.href, onSelectCategory); }}
                style={styles.hero}
              >
                <Image source={{ uri: config.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={styles.heroOverlay}>
                  {heading ? <Text style={styles.heroTitle}>{heading}</Text> : null}
                  {section.subtitle ? <Text style={styles.heroSubtitle}>{titleCase(section.subtitle)}</Text> : null}
                  {cta ? (
                    <View style={styles.heroButton}>
                      <Text style={[styles.heroButtonText, { color: colors.gray900 }]}>{cta}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            </View>
          );
        }

        if (layout === 'tiles') {
          const slugs = config.categorySlugs?.length
            ? config.categorySlugs
            : categories.slice(0, 6).map(category => category.slug);
          const tiles = slugs
            .map(slug => categories.find(category => String(category.slug).toLowerCase() === String(slug).toLowerCase()))
            .filter((category): category is Category => !!category);
          if (!tiles.length) return null;
          const width = gridCardWidth(tileColumns);
          return (
            <View key={section.id} style={styles.section}>
              {heading ? <Text style={[styles.heading, { color: colors.gray900 }]}>{heading}</Text> : null}
              <View style={styles.tileGrid}>
                {tiles.map(category => (
                  <TouchableOpacity
                    key={category.id}
                    onPress={() => onSelectCategory(category.slug)}
                    style={{ width, alignItems: 'center', gap: 6 }}
                  >
                    <View style={[styles.tileImage, { width, height: width, backgroundColor: colors.gray100 }]}>
                      {category.icon?.startsWith('http') || category.icon?.startsWith('/') ? (
                        <Image source={{ uri: category.icon }} style={{ width: width - 12, height: width - 12 }} contentFit="contain" />
                      ) : (
                        <Text style={{ fontSize: width * 0.38 }}>{category.icon || '🛒'}</Text>
                      )}
                    </View>
                    <Text style={[styles.tileLabel, { color: colors.gray700 }]} numberOfLines={2}>{category.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        }

        if (!items.length) return null;
        const columns = layout === 'grid' ? gridColumns(section) : 1;
        const cardWidth = layout === 'row' || layout === 'hero' ? 148 : gridCardWidth(columns);
        const viewAllLabel = section.badge || 'View all';

        return (
          <View key={section.id} style={styles.section}>
            <View style={styles.headingRow}>
              <View style={{ flexShrink: 1 }}>
                {heading ? <Text style={[styles.heading, { color: colors.gray900 }]}>{heading}</Text> : null}
                {section.subtitle ? <Text style={[styles.subtitle, { color: colors.gray500 }]}>{titleCase(section.subtitle)}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => onViewAll(section, items)}>
                <Text style={[styles.viewAll, { color: colors.primary }]}>{viewAllLabel}</Text>
              </TouchableOpacity>
            </View>
            {layout === 'row' || layout === 'hero' ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: SIDE_PAD, gap: GAP }}
              >
                {items.map(product => (
                  <ProductCard key={product.id} product={product} width={cardWidth} />
                ))}
              </ScrollView>
            ) : (
              <View style={styles.grid}>
                {(layout === 'grid' ? items : items.slice(0, 6)).map(product => (
                  <ProductCard key={product.id} product={product} width={cardWidth} />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 22, paddingTop: 8 },
  section: { gap: 10 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SIDE_PAD },
  heading: { fontSize: 16, fontFamily: 'Inter-Bold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter-Regular', marginTop: 2 },
  viewAll: { fontSize: 12, fontFamily: 'Inter-SemiBold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SIDE_PAD, gap: GAP },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SIDE_PAD, gap: GAP },
  tileImage: { borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 11, fontFamily: 'Inter-SemiBold', textAlign: 'center' },
  hero: { marginHorizontal: SIDE_PAD, height: 176, borderRadius: 20, overflow: 'hidden' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', padding: 16, backgroundColor: 'rgba(0,0,0,0.28)' },
  heroTitle: { fontSize: 18, fontFamily: 'Inter-Bold', color: '#fff' },
  heroSubtitle: { fontSize: 12, fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  heroButton: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  heroButtonText: { fontSize: 12, fontFamily: 'Inter-Bold' },
});

import type { Category, HomeSection, Product } from '../services/api';
import ProductCard from './ProductCard';

/**
 * Resolve the products a section should show, using only live catalogue data.
 *
 * - `config.categorySlug` scopes the section to one category. If that category
 *   is not present for the current store we return nothing rather than ignoring
 *   the scope, so a mis-set slug can never widen a section beyond what the admin
 *   chose.
 * - `todays_combos` shows bundle products; `fresh_vegetables` shows the
 *   remaining (individual) products so the same item never appears twice.
 * - `deals` shows every product with a discount, biggest discount first (a deal
 *   is just a discounted item; discounts are set on the product in Hub).
 * - `top_picks` (Top Picks) shows the admin's hand-picked, ordered list.
 *   Leave that list empty and the server fills it with the store's bestsellers,
 *   so the row is always populated either way.
 * - `config.limit` caps how many items render.
 */
export function resolveSectionItems(
  section: HomeSection,
  products: Product[],
  categories: Category[],
): Product[] {
  const cfg = section.config || ({} as HomeSection['config']);
  const slug = cfg.categorySlug || null;
  let list = products;

  if (section.sectionKey === 'top_picks') {
    const byId = new Map(products.map(p => [p.id, p]));
    list = (cfg.productIds || []).map(id => byId.get(id)).filter((p): p is Product => Boolean(p));
    if (slug) {
      const category = categories.find(c => c.slug === slug);
      if (!category) return [];
      list = list.filter(p => p.categoryId === category.id);
    }
  } else {
    if (slug) {
      const category = categories.find(c => c.slug === slug);
      if (!category) return [];
      list = list.filter(p => p.categoryId === category.id);
    }
    if (section.sectionKey === 'todays_combos') list = list.filter(p => p.isBundle);
    else if (section.sectionKey === 'fresh_vegetables') list = list.filter(p => !p.isBundle);
    else if (section.sectionKey === 'deals')
      list = list
        .filter(p => (p.discountPercent || 0) > 0)
        .sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  }

  const limit = typeof cfg.limit === 'number' && cfg.limit > 0 ? cfg.limit : null;
  // Combos always resolve the full bundle catalogue: home caps the preview at
  // four and the remaining products belong in the dedicated Combo sheet.
  if (section.sectionKey === 'todays_combos') return list;
  return limit ? list.slice(0, limit) : list;
}

/** The layout a section renders in: an explicit override, else a per-key default. */
function sectionLayout(section: HomeSection): 'row' | 'grid' {
  const l = section.config?.layout;
  if (l === 'row' || l === 'grid') return l;
  // Combos fill a two-column grid; Top Picks remains a horizontal discovery row.
  if (section.sectionKey === 'todays_combos') return 'grid';
  if (section.sectionKey === 'top_picks') return 'row';
  return section.sectionKey === 'fresh_vegetables' ? 'grid' : 'row';
}

/** Grid columns: the two-section home is 2-across; other grids stay 3-4 across. */
function gridCols(section: HomeSection): string {
  if (section.sectionKey === 'todays_combos' || section.sectionKey === 'top_picks') return 'grid-cols-2';
  return 'grid-cols-3 sm:grid-cols-4';
}

export interface ResolvedSection {
  section: HomeSection;
  items: Product[];
}

interface HomeSectionsProps {
  entries: ResolvedSection[];
  onViewAll: (section: HomeSection, items: Product[]) => void;
}

export default function HomeSections({ entries, onViewAll }: HomeSectionsProps) {
  return (
    <div className="space-y-8">
      {entries.map(({ section, items }) => {
        const layout = sectionLayout(section);
        const isComboSection = section.sectionKey === 'todays_combos';
        const isStoreFavourites = section.sectionKey === 'top_picks';
        const visibleItems = isComboSection ? items.slice(0, 4) : items;
        const canViewAll = !isComboSection || items.length > 4;
        return (
          <section key={section.id}>
            <div className="flex items-end justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">{section.title}</h2>
                {section.subtitle && (
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{section.subtitle}</p>
                )}
              </div>
              {canViewAll && !isComboSection && !isStoreFavourites && (
                <button
                  onClick={() => onViewAll(section, items)}
                  className="flex-shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
                >
                  View All
                </button>
              )}
            </div>

            {layout === 'row' ? (
              <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {visibleItems.map(p => (
                  <div key={p.id} className="w-[42%] min-w-[140px] sm:w-[170px] md:w-[190px] flex-shrink-0">
                    <ProductCard product={p} />
                  </div>
                ))}
              </div>
            ) : (
              <div className={`grid ${gridCols(section)} gap-2.5`}>
                {visibleItems.map(p => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}

            {isComboSection && canViewAll && (
              <button
                type="button"
                onClick={() => onViewAll(section, items)}
                className="mt-3 w-full rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
              >
                View all Today&apos;s Combo
              </button>
            )}
            {isStoreFavourites && canViewAll && (
              <button
                type="button"
                onClick={() => onViewAll(section, items)}
                className="mt-3 w-full rounded-xl border border-sky-600 bg-sky-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
              >
                View all products
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

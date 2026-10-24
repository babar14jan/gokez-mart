import type { Category, HomeSection, Product } from '../services/api';
import ProductCard from './ProductCard';

function getKind(section: HomeSection) {
  return section.kind || section.sectionKey || 'manual';
}

export function resolveSectionItems(
  section: HomeSection,
  products: Product[],
  categories: Category[],
): Product[] {
  if (Array.isArray((section as any).items) && (section as any).items.length) {
    const byId = new Map(products.map(p => [p.id, p]));
    const merged: Product[] = [];
    for (const it of (section as any).items) {
      const m = byId.get(it.id) || it;
      if (m) merged.push(m as Product);
    }
    return merged;
  }

  const cfg: any = section.config || {};
  const kind = (section as any).kind || (section as any).sectionKey || 'manual';
  const slugs: string[] = Array.isArray(cfg.categorySlugs) && cfg.categorySlugs.length ? cfg.categorySlugs : (cfg.categorySlug ? [cfg.categorySlug] : []);
  let list: Product[] = products as Product[];

  if (kind === 'top_picks' || kind === 'manual') {
    const byId = new Map((products as Product[]).map(p => [p.id, p]));
    list = ((cfg.productIds || []) as string[]).map(id => byId.get(id)).filter((p): p is Product => Boolean(p));
    if (slugs.length) {
      const cats = new Set((categories as Category[]).filter(c => slugs.includes((c as any).slug)).map(c => (c as any).id));
      if (!cats.size) return [];
      list = list.filter(p => (p as any).categoryId && cats.has((p as any).categoryId));
    }
  } else {
    if (slugs.length) {
      const cats = new Set((categories as Category[]).filter(c => slugs.includes((c as any).slug)).map(c => (c as any).id));
      if (!cats.size) return [];
      list = list.filter(p => (p as any).categoryId && cats.has((p as any).categoryId));
    }
    if (kind === 'combo' || kind === 'todays_combos') {
      list = list.filter(p => (p as any).isBundle);
      const ids = (cfg.productIds || []) as string[];
      if (ids.length) {
        const byId = new Map(list.map(p => [(p as any).id, p]));
        list = ids.map(id => byId.get(id)).filter((p): p is Product => Boolean(p));
      }
    } else if (kind === 'fresh_vegetables') {
      list = list.filter(p => !(p as any).isBundle);
    } else if (kind === 'deals') {
      list = list
        .filter(p => ((p as any).discountPercent || 0) > 0)
        .sort((a, b) => ((b as any).discountPercent || 0) - ((a as any).discountPercent || 0));
    } else if (kind === 'category') {
      if ((cfg.productIds || []).length) {
        const byId = new Map(list.map(p => [(p as any).id, p]));
        const picked: Product[] = ((cfg.productIds) as string[]).map(id => byId.get(id)).filter((p): p is Product => Boolean(p));
        const rest = list.filter((p: any) => !((cfg.productIds) as string[]).includes(p.id));
        list = [...picked, ...rest];
      }
      if (cfg.sort === 'price_asc') list = [...list].sort((a,b) => ((a as any).price||0)-((b as any).price||0));
      else if (cfg.sort === 'price_desc') list = [...list].sort((a,b) => ((b as any).price||0)-((a as any).price||0));
    }
  }

  const limit = typeof cfg.limit === 'number' && cfg.limit > 0 ? cfg.limit : null;
  if (kind === 'combo' || kind === 'todays_combos') return list as Product[];
  return (limit ? list.slice(0, limit) : list) as Product[];
}


function sectionLayout(section: HomeSection): 'row' | 'grid' | 'hero' | 'tiles' {
  const l = section.layout || section.config?.layout;
  if (l === 'row' || l === 'grid' || l === 'hero' || l === 'tiles') return l;
  const kind = getKind(section);
  if (kind === 'combo' || kind === 'todays_combos' || kind === 'top_picks' || kind === 'manual' || kind === 'bestsellers' || kind === 'new_arrivals') return 'row';
  if (kind === 'banner') return 'hero';
  if (kind === 'category_tiles') return 'tiles';
  return kind === 'fresh_vegetables' || kind === 'category' ? 'grid' : 'row';
}

function gridCols(section: HomeSection): string {
  const kind = getKind(section);
  if (kind === 'combo' || kind === 'todays_combos' || kind === 'top_picks') return 'grid-cols-2';
  if (section.config?.columns === 4) return 'grid-cols-4';
  if (section.config?.columns === 3) return 'grid-cols-3';
  return 'grid-cols-3 sm:grid-cols-4';
}

export interface ResolvedSection {
  section: HomeSection;
  items: Product[];
}

interface HomeSectionsProps {
  entries: ResolvedSection[];
  categories: Category[];
  onViewAll: (section: HomeSection, items: Product[]) => void;
}

export default function HomeSections({ entries, categories, onViewAll }: HomeSectionsProps) {
  return (
    <div className="space-y-8">
      {entries.map(({ section, items }) => {
        const kind = getKind(section);
        const layout = sectionLayout(section);
  const isComboSection = kind === 'combo' || kind === 'todays_combos';
  const isStoreFavourites = kind === 'top_picks';
  const isDeals = kind === 'deals';
  const isBanner = kind === 'banner' || layout === 'hero';
  const isTiles = kind === 'category_tiles' || layout === 'tiles';
  const visibleItems = items;
        const canViewAll = items.length >= 4;

  const viewAll = isComboSection
    ? { label: section.badge || 'View all', cls: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500' }
    : isDeals
    ? { label: section.badge || 'View all', cls: 'bg-purple-600 text-white hover:bg-purple-700 focus-visible:ring-purple-500' }
    : isStoreFavourites
    ? { label: section.badge || 'View all', cls: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500' }
    : { label: section.badge || 'View all', cls: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500' };

        if (isBanner && section.config?.imageUrl) {
          const href = section.config.href;
          const btnText = (section.config as any).buttonText || (section.config as any).cta || section.badge || (href ? 'Shop now' : null);
          const el = (
            <div className="relative w-full rounded-2xl overflow-hidden">
              <img src={section.config.imageUrl} alt={section.config.alt || section.title} className="w-full h-44 sm:h-56 object-cover" />
              {(section.title || section.subtitle || btnText) && (
                <div className="absolute inset-0 flex flex-col justify-end p-4 bg-gradient-to-t from-black/60 to-transparent">
                  {section.title && <p className="text-base font-bold text-white">{typeof section.title === 'string' ? section.title.replace(/\b\w/g, c => c.toUpperCase()) : section.title}</p>}
                  {section.subtitle && <p className="text-xs text-white/90 mt-0.5">{typeof section.subtitle === 'string' ? section.subtitle.replace(/\b\w/g, c => c.toUpperCase()) : section.subtitle}</p>}
                  {btnText && href && (
                    <button type="button" onClick={(e:any)=>{ e.preventDefault(); e.stopPropagation(); if(href.startsWith('#')){window.location.hash = href; window.dispatchEvent(new HashChangeEvent('hashchange'));} else if(href.startsWith('/category/')){const slug = href.split('/category/')[1]?.split('?')[0]; window.dispatchEvent(new CustomEvent('gokez:select-category',{detail:{slug}}));}}} className="mt-2 self-start inline-flex items-center px-3 py-1.5 rounded-lg bg-white/90 text-gray-900 text-xs font-semibold border border-white/60 shadow-sm">{btnText}</button>
                  )}
                  {btnText && !href && (
                    <span className="mt-2 self-start inline-flex items-center px-3 py-1.5 rounded-lg bg-white/90 text-gray-900 text-xs font-semibold border border-white/60 shadow-sm">{btnText}</span>
                  )}
                </div>
              )}
            </div>
          );
          const onClick = (e: any) => {
            if (!href) return;
            e.preventDefault();
            e.stopPropagation();
            if (href.startsWith('#')) {
              window.location.hash = href;
              return;
            } else if (href.startsWith('/category/')) {
              const slug = href.split('/category/')[1]?.split('?')[0];
              window.dispatchEvent(new CustomEvent('gokez:select-category', { detail: { slug } }));
              return;
            }
          };
          return (
            <section key={section.id}>
              {href ? <div onClick={onClick} role="button" tabIndex={0} className="block cursor-pointer">{el}</div> : el}
            </section>
          );
        }

        return (
          <section key={section.id}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">{typeof section.title === 'string' ? section.title.replace(/\b\w/g, c => c.toUpperCase()) : section.title}</h2>
                {section.subtitle && (
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{typeof section.subtitle === 'string' ? section.subtitle.replace(/\b\w/g, c => c.toUpperCase()) : section.subtitle}</p>
                )}
              </div>
              {canViewAll && !isStoreFavourites && !isTiles && items.length >= 4 && (
                <button
                  type="button"
                  onClick={() => onViewAll(section, items)}
                  className={`flex-shrink-0 whitespace-nowrap rounded-xl px-5 py-2 text-sm font-bold shadow-md transition-all hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${viewAll.cls}`}
                >
                  {viewAll.label}
                </button>
              )}
            </div>

            {isTiles ? (
              <div className={`grid ${gridCols(section)} gap-2.5`}>
                {(section.config.categorySlugs && section.config.categorySlugs.length ? section.config.categorySlugs : categories.slice(0, 6).map(c => c.slug)).map((slug: string) => {
                  const cat = categories.find(c => c.slug === slug);
                  if (!cat) return null;
                  return (
                    <button key={slug} type="button" onClick={() => { window.location.hash = '#categories'; }} className="rounded-xl border border-gray-100 dark:border-slate-700 p-3 text-sm font-semibold text-gray-900 dark:text-white text-left">
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            ) : layout === 'row' ? (
              <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {visibleItems.slice(0, items.length > 4 ? 4 : items.length).map((p: any) => (
                  <div key={p.id} className="w-[42%] min-w-[140px] sm:w-[170px] md:w-[190px] flex-shrink-0">
                    <ProductCard product={p} />
                  </div>
                ))}
                {items.length > 4 && (
                  <button
                    type="button"
                    onClick={() => onViewAll(section, items)}
                    className="w-[42%] min-w-[140px] sm:w-[170px] md:w-[190px] flex-shrink-0 rounded-xl border-2 border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 flex flex-col items-center justify-center gap-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xl">→</div>
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{viewAll.label}</span>
                  </button>
                )}
              </div>
            ) : layout === 'grid' ? (
              <div className={`grid ${gridCols(section)} gap-2.5`}>
                {visibleItems.slice(0, items.length >= 4 ? 4 : items.length).map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : layout === 'hero' ? (
              <div className="space-y-2.5">
                {visibleItems.slice(0, 2).map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className={`grid ${gridCols(section)} gap-2.5`}>
                {visibleItems.slice(0, items.length >= 4 ? 4 : items.length).map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}

            {canViewAll && isStoreFavourites && !isTiles && items.length >= 4 && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => onViewAll(section, items)}
                  className={`flex-shrink-0 whitespace-nowrap rounded-xl px-5 py-2 text-sm font-bold shadow-md transition-all hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${viewAll.cls}`}
                >
                  {viewAll.label}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

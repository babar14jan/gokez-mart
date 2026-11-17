import type { Category, Product } from '../services/api';
import CategoryIcon from './CategoryIcon';
import SmartImage from './SmartImage';

interface ProductSuggestionListProps {
  products: Product[];
  categoryById: Map<string, Category>;
  onPick: (product: Product) => void;
}

/**
 * The live-suggestion rows used by every search surface (catalog search sheet,
 * Fresh and Categories). Rendered inside a `space-y-1` container; the caller
 * owns the surrounding block so the suggestion area looks the same everywhere.
 */
export default function ProductSuggestionList({ products, categoryById, onPick }: ProductSuggestionListProps) {
  return (
    <>
      {products.map(product => {
        const category = categoryById.get(product.categoryId);
        const localName = product.localName?.trim() && product.localName.trim() !== product.name.trim()
          ? product.localName.trim()
          : '';
        return (
          <button type="button" key={product.id} onClick={() => onPick(product)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-yellow-200/50 active:bg-yellow-200/70 dark:hover:bg-yellow-900/30">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-gray-100 dark:bg-slate-800 dark:ring-slate-600">
              <SmartImage
                src={product.smallUrl || product.thumbnailUrl || product.photoVariants?.[0]?.smallUrl || product.photoVariants?.[0]?.thumbnailUrl || product.photoUrl}
                alt=""
                className="h-full w-full"
                imgClassName="object-cover"
                fallback={<CategoryIcon icon={category?.icon || ''} name={category?.name || product.name} className="h-5 w-5 object-contain" />}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">
                {product.name}
                {localName && <span> ({localName})</span>}
              </p>
            </div>
          </button>
        );
      })}
    </>
  );
}

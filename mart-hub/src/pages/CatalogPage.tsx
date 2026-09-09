import { useEffect, useState, useMemo } from 'react';
import { Package, Plus, Search, Check, Loader2, X } from 'lucide-react';
import { categoriesApi, api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { getActiveStoreId } from '../utils/store';
import CategoryIcon from '../components/CategoryIcon';

interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
}

interface Category { id: string; name: string; icon: string; }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

export default function CatalogPage() {
  const { role } = useAuthStore();
  const isSuperAdmin = role === 'super_admin';

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('all');
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({ price: '', unit: '1 kg', discountPercent: '0' });
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const [catRes, prodRes] = await Promise.all([
        categoriesApi.getAll(),
        api.get('/admin/catalog'),
      ]);
      setCategories(catRes.data.data || []);
      setProducts(prodRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchCat = activeCat === 'all' || p.categoryId === activeCat;
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [products, activeCat, search]);

  const handleAssign = async (productId: string) => {
    if (!assignForm.price) return;
    setAssigningId(productId);
    try {
      await api.post(`/admin/catalog/${productId}/assign`, {
        storeId: getActiveStoreId(),
        price: parseFloat(assignForm.price),
        unit: assignForm.unit,
        discountPercent: parseFloat(assignForm.discountPercent) || 0,
      });
      setAssigned(s => new Set([...s, productId]));
      setAssigning(null);
      setAssignForm({ price: '', unit: '1 kg', discountPercent: '0' });
    } catch { alert('Failed to assign product'); }
    finally { setAssigningId(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
            {isSuperAdmin ? 'Master product catalog — all stores can use these products' : 'Pick products to add to your store'}
          </p>
        </div>
        {isSuperAdmin && (
          <a href="/products" className="btn-primary text-xs flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add to Catalog
          </a>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search catalog..." className={`${inp} pl-9`} />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button onClick={() => setActiveCat('all')}
          className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${activeCat === 'all' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700'}`}>
          All
        </button>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${activeCat === cat.id ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700'}`}>
            <CategoryIcon icon={cat.icon} name={cat.name} className="w-4 h-4 object-contain" />{cat.name}
          </button>
        ))}
      </div>

      {/* Product count */}
      <p className="text-xs text-gray-400">{filtered.length} product{filtered.length !== 1 ? 's' : ''} in catalog</p>

      {/* Products grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No products found.</p>
          {isSuperAdmin && <p className="text-xs mt-1">Add products from the Products page to build the catalog.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(product => {
            const isAssigned = assigned.has(product.id);
            const isAssigning = assigning === product.id;

            return (
              <div key={product.id} className={`bg-white dark:bg-slate-800 rounded-xl border overflow-hidden shadow-sm flex flex-col transition-all ${isAssigned ? 'border-emerald-300 dark:border-emerald-700' : 'border-gray-100 dark:border-slate-700'}`}>
                {/* Photo */}
                <div className="relative aspect-square bg-gray-50 dark:bg-slate-700">
                  {product.photoUrl
                    ? <img src={product.photoUrl} alt={product.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-3xl">🥦</div>
                  }
                  {isAssigned && (
                    <div className="absolute top-1.5 right-1.5 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  {product.categoryName && (
                    <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[9px] font-bold bg-black/50 text-white px-1.5 py-0.5 rounded-md">
                      <CategoryIcon icon={product.categoryIcon || ''} name={product.categoryName} className="w-3 h-3 object-contain" />
                      {product.categoryName}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-2 flex flex-col flex-1">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight">{product.name}</p>
                  {product.description && (
                    <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{product.description}</p>
                  )}

                  {/* Action */}
                  {!isSuperAdmin && (
                    <div className="mt-auto pt-2">
                      {isAssigned ? (
                        <div className="flex items-center gap-1 text-emerald-600 text-[10px] font-bold">
                          <Check className="w-3 h-3" /> Added to store
                        </div>
                      ) : isAssigning ? (
                        <div className="space-y-1.5">
                          <input type="number" value={assignForm.price} onChange={e => setAssignForm(f => ({ ...f, price: e.target.value }))}
                            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                            placeholder="Price (₹)" autoFocus />
                          <input type="text" value={assignForm.unit} onChange={e => setAssignForm(f => ({ ...f, unit: e.target.value }))}
                            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                            placeholder="Unit (e.g. 1 kg)" />
                          <div className="flex gap-1">
                            <button onClick={() => setAssigning(null)}
                              className="flex-1 py-1 text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 rounded-lg">Cancel</button>
                            <button onClick={() => handleAssign(product.id)} disabled={!assignForm.price || assigningId === product.id}
                              className="flex-1 py-1 text-[10px] font-semibold text-white bg-emerald-500 rounded-lg disabled:opacity-50 flex items-center justify-center">
                              {assigningId === product.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setAssigning(product.id); setAssignForm({ price: '', unit: '1 kg', discountPercent: '0' }); }}
                          className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-emerald-600 border border-emerald-300 dark:border-emerald-700 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                          <Plus className="w-3 h-3" /> Add to Store
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

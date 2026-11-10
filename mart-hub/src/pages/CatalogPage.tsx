import { useEffect, useState, useMemo } from 'react';
import { Package, Plus, Search, Loader2, X, Pencil, Trash2, Camera, Upload, FileSpreadsheet, Download } from 'lucide-react';
import { categoriesApi, catalogApi, productsApi } from '../services/api';
import * as XLSX from 'xlsx';
import CategoryIcon from '../components/CategoryIcon';
import SmartImage from '../components/SmartImage';
import { useAuthStore } from '../store/authStore';
import PageSkeleton from '../components/PageSkeleton';

interface ProductImageVariant { assetId?: string; smallUrl?: string; thumbnailUrl: string; largeUrl: string; }

interface CatalogProduct {
  id: string;
  productCode: string;
  name: string;
  localName: string | null;
  searchAliases: string[];
  description: string | null;
  photoUrl: string | null;
  photos?: string[];
  photoVariants?: ProductImageVariant[];
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
}

interface Category { id: string; name: string; slug?: string; icon: string; }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';
const parseSearchAliases = (value: string) => value.split(',').map(alias => alias.trim()).filter(Boolean);

export default function CatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [form, setForm] = useState({ name: '', localName: '', searchAliases: '', description: '', categoryId: '' });
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoVariants, setPhotoVariants] = useState<ProductImageVariant[]>([]);
  const [primaryPhoto, setPrimaryPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cleaningStorage, setCleaningStorage] = useState(false);
  const [storageResult, setStorageResult] = useState<any>(null);

  // Bulk image upload state
  interface BulkUploadItem { file: File; name: string; preview: string; categoryId: string; status: 'pending' | 'uploading' | 'done' | 'error'; }
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkItems, setBulkItems] = useState<BulkUploadItem[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  // Excel upload state
  interface ExcelRow { name: string; localName: string; searchAliases: string; categoryRaw: string; categoryId: string; description: string; photoPath: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string; }
  const [showExcelUpload, setShowExcelUpload] = useState(false);
  const [excelRows, setExcelRows] = useState<ExcelRow[]>([]);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelProgress, setExcelProgress] = useState(0);

  const resolveCategory = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v) return '';
    const c = categories.find(cat => cat.id === raw.trim() || cat.name.toLowerCase() === v || (cat.slug || '').toLowerCase() === v);
    return c?.id || '';
  };

  const recomputeRowError = (row: ExcelRow): ExcelRow => {
    const name = row.name.trim();
    const rawCat = row.categoryRaw.trim();
    const categoryId = row.categoryId || resolveCategory(rawCat);
    let error: string | undefined;
    if (!name) error = 'Name required';
    else if (!rawCat) error = 'Category required';
    else if (!categoryId) error = 'Category not found';
    return { ...row, categoryId, error };
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Product Name *', 'Local Name', 'Search aliases (hidden from customers)', 'Category', 'Description', 'Photo path (optional)'],
      ['Fresh Tomatoes', 'Tamatar', 'Tomato, Tamatar', 'Fresh Vegetables', 'Fresh red tomatoes', 'uploads/products/tomato.jpg'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalog');
    XLSX.writeFile(wb, 'catalog-bulk-upload-template.xlsx');
  };

  const handleExcelFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = ev.target?.result;
        if (!result) return;
        const wb = isCsv
          ? XLSX.read(result as string, { type: 'string' })
          : XLSX.read(new Uint8Array(result as ArrayBuffer), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
        if (!rows.length) { alert('Empty file'); return; }
        const first = rows[0].map((c: any) => String(c).trim().toLowerCase());
        const hasHeader = first.some(c => c.includes('product') || c.includes('name') || c.includes('category') || c.includes('description') || c.includes('alias') || c.includes('local') || c.includes('hindi'));
        const header = hasHeader ? first : [];
        const dataRows = hasHeader ? rows.slice(1) : rows;
        const findCol = (candidates: string[]) => header.findIndex(h => candidates.some(c => h === c || h.includes(c)));
        const colMap = header.length
          ? { name: findCol(['product name', 'product', 'name']), local: findCol(['local name', 'local', 'hindi']), alias: findCol(['search aliases', 'alias', 'search']), cat: findCol(['category']), desc: findCol(['description']), photo: findCol(['photo', 'image', 'local storage path', 'photo path', 'image path']) }
          : { name: 0, local: 1, alias: 2, cat: 3, desc: 4, photo: 5 };
        const get = (row: any[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
        const parsed: ExcelRow[] = dataRows
          .filter(r => Array.isArray(r) && r.some((c: any) => String(c).trim() !== ''))
          .map(r => {
            const rawCat = get(r, colMap.cat);
            const row: ExcelRow = {
              name: get(r, colMap.name),
              localName: get(r, colMap.local),
              searchAliases: get(r, colMap.alias),
              categoryRaw: rawCat,
              categoryId: resolveCategory(rawCat),
              description: get(r, colMap.desc),
              photoPath: get(r, colMap.photo),
              status: 'pending',
            };
            return recomputeRowError(row);
          });
        if (!parsed.length) { alert('No data rows found'); return; }
        setExcelRows(parsed);
        setShowExcelUpload(true);
      } catch (err) {
        if (file.name.toLowerCase().endsWith('.numbers')) {
          alert('Apple Numbers (.numbers) files are not supported directly. In Numbers, use File > Export To > Excel or CSV, then upload the exported file.');
        } else {
          alert('Failed to read file. Please use .xlsx, .xls, or .csv format.');
        }
      }
    };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  };

  const handleExcelUpload = async () => {
    const pending = excelRows.filter(i => i.status === 'pending' && !i.error);
    if (!pending.length) return;
    setExcelUploading(true);
    setExcelProgress(0);
    let done = 0;
    for (let idx = 0; idx < excelRows.length; idx++) {
      const item = excelRows[idx];
      if (item.status !== 'pending' || item.error) { done++; setExcelProgress(Math.round((done / excelRows.length) * 100)); continue; }
      setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, status: 'uploading' } : r));
      try {
        await catalogApi.create({
          name: item.name.trim(),
          localName: item.localName || undefined,
          searchAliases: parseSearchAliases(item.searchAliases),
          description: item.description || undefined,
          categoryId: item.categoryId || undefined,
          photoLocalPath: item.photoPath || undefined,
        });
        setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, status: 'done' } : r));
      } catch (e: any) {
        setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, status: 'error', error: e?.response?.data?.error || 'Failed' } : r));
      }
      done++;
      setExcelProgress(Math.round((done / excelRows.length) * 100));
    }
    setExcelUploading(false);
    await load();
  };

  const handleBulkFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const items: BulkUploadItem[] = files.map(file => ({
      file,
      name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      preview: URL.createObjectURL(file),
      categoryId: '',
      status: 'pending',
    }));
    setBulkItems(prev => [...prev, ...items]);
    e.target.value = '';
  };

  const handleBulkUpload = async () => {
    const pending = bulkItems.filter(i => i.status === 'pending');
    if (!pending.length) return;
    setBulkUploading(true);
    setBulkProgress(0);
    let done = 0;
    for (const item of pending) {
      setBulkItems(prev => prev.map(i => i.file === item.file ? { ...i, status: 'uploading' } : i));
      try {
        const uploadRes = await productsApi.uploadPhoto(item.file, undefined, 'product');
        const upload = uploadRes.data.data;
        const photoUrl = upload.url;
        await catalogApi.create({ name: item.name, photoUrl, photos: [photoUrl], photoVariants: [upload.photoVariants], imageAssetIds: [upload.photoVariants.assetId], categoryId: item.categoryId || undefined });
        setBulkItems(prev => prev.map(i => i.file === item.file ? { ...i, status: 'done' } : i));
      } catch {
        setBulkItems(prev => prev.map(i => i.file === item.file ? { ...i, status: 'error' } : i));
      }
      done++;
      setBulkProgress(Math.round((done / pending.length) * 100));
    }
    setBulkUploading(false);
    await load();
  };

  const load = async () => {
    try {
      const [catRes, prodRes] = await Promise.all([categoriesApi.getAll(), catalogApi.getAll()]);
      setCategories(catRes.data.data || []);
      setProducts(prodRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => products.filter(p => {
    const matchCat = activeCat === 'all' || p.categoryId === activeCat;
    const query = search.trim().toLowerCase();
    const matchSearch = !query || p.productCode.toLowerCase().includes(query) || p.name.toLowerCase().includes(query) || (p.localName || '').toLowerCase().includes(query)
      || (p.searchAliases ?? []).some(alias => alias.toLowerCase().includes(query));
    return matchCat && matchSearch;
  }), [products, activeCat, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', localName: '', searchAliases: '', description: '', categoryId: categories[0]?.id || '' });
    setPhotos([]); setPhotoVariants([]); setPrimaryPhoto(null);
    setShowModal(true);
  };

  const openEdit = (p: CatalogProduct) => {
    setEditing(p);
    const initialPhotos = p.photos?.length ? p.photos : p.photoUrl ? [p.photoUrl] : [];
    setPhotos(initialPhotos);
    setPhotoVariants(p.photoVariants?.length ? p.photoVariants : initialPhotos.map(url => ({ thumbnailUrl: url, largeUrl: url })));
    setPrimaryPhoto(initialPhotos[0] || null);
    setForm({ name: p.name, localName: p.localName || '', searchAliases: p.searchAliases.join(', '), description: p.description || '', categoryId: p.categoryId || '' });
    setShowModal(true);
  };

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      if (photos.length >= 4) break;
      const uploadRes = await productsApi.uploadPhoto(file, undefined, 'product');
      const upload = uploadRes.data.data;
      const url = upload.url;
      setPhotos(prev => [...prev, url]);
      setPhotoVariants(prev => [...prev, upload.photoVariants]);
      setPrimaryPhoto(current => current || url);
    }
  };

  const handleRemovePhoto = (url: string) => {
    setPhotos(prev => {
      const next = prev.filter(photo => photo !== url);
      if (next.length && primaryPhoto === url) setPrimaryPhoto(next[0]);
      if (!next.length) setPrimaryPhoto(null);
      return next;
    });
    setPhotoVariants(prev => prev.filter(variant => variant.largeUrl !== url));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const photosToSave = photos.length ? photos : (editing?.photoUrl ? [editing.photoUrl] : []);
      const orderedPhotos = primaryPhoto
        ? [primaryPhoto, ...photosToSave.filter(photo => photo !== primaryPhoto)]
        : photosToSave;
      const orderedVariants = orderedPhotos.map(url =>
        photoVariants.find(variant => variant.largeUrl === url) || { thumbnailUrl: url, largeUrl: url }
      );
      const data = {
        name: form.name.trim(),
        localName: form.localName || undefined,
        searchAliases: parseSearchAliases(form.searchAliases),
        description: form.description || undefined,
        photoUrl: orderedPhotos[0] || undefined,
        photos: orderedPhotos,
        photoVariants: orderedVariants,
        imageAssetIds: orderedVariants.flatMap(variant => variant.assetId ? [variant.assetId] : []),
        categoryId: form.categoryId || undefined,
      };
      if (editing) await catalogApi.update(editing.id, data);
      else await catalogApi.create(data);
      setShowModal(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await catalogApi.delete(id);
      setConfirmDeleteId(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to delete');
    } finally { setDeleting(false); }
  };

  const isSuperAdmin = useAuthStore(s => s.isSuperAdmin());

  const handleCleanStorage = async (dryRun: boolean) => {
    setCleaningStorage(true);
    try {
      const res = await productsApi.cleanStorage(dryRun);
      setStorageResult(res.data.data);
      if (!dryRun) await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Storage cleanup failed');
    } finally {
      setCleaningStorage(false);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Bulk Upload
            <input type="file" accept="image/*" multiple className="hidden" onChange={e => { handleBulkFileSelect(e); setShowBulkUpload(true); }} />
          </label>
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-emerald-400 hover:text-emerald-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors cursor-pointer">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Upload Excel
            <input type="file" accept=".xlsx,.xls,.csv,.numbers" className="hidden" onChange={handleExcelFileSelect} />
          </label>
          <button onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-gray-400 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <Download className="w-3.5 h-3.5" /> Template
          </button>
          {isSuperAdmin && (
            <button onClick={() => handleCleanStorage(true)} disabled={cleaningStorage}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-red-400 hover:text-red-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
              {cleaningStorage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Clean Storage
            </button>
          )}
          <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Add Product
          </button>
        </div>
      </div>

      {storageResult && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Storage Cleanup {storageResult.dryRun ? '(Dry Run)' : ''}</h3>
            <div className="text-xs text-gray-600 dark:text-slate-300 space-y-1">
              <p>Preserved assets: {storageResult.preservedAssets}</p>
              <p>Orphaned assets: {storageResult.orphanedAssets}</p>
              <p>Local files scanned: {storageResult.scannedLocalFiles}; unused: {storageResult.pendingLocalFiles}</p>
              <p>Supabase files scanned: {storageResult.scannedSupabaseFiles}; unused: {storageResult.pendingSupabaseFiles}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStorageResult(null)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl">Close</button>
              {storageResult.dryRun && (storageResult.pendingLocalFiles > 0 || storageResult.pendingSupabaseFiles > 0) && (
                <button onClick={() => handleCleanStorage(false)} disabled={cleaningStorage}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl disabled:opacity-50">
                  {cleaningStorage ? 'Cleaning...' : 'Clean Now'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or code..." className={`${inp} pl-9`} />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-500" /></button>}
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

      <p className="text-xs text-gray-500">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search || activeCat !== 'all' ? 'No products match.' : 'No products in catalog yet.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(p => (
            <div key={p.id} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 overflow-hidden shadow-sm flex flex-col">
              <div className="relative aspect-square bg-gray-50 dark:bg-slate-700">
                <SmartImage
                  src={p.photoUrl}
                  alt={p.name}
                  className="h-full w-full"
                  imgClassName="object-cover"
                  fallback={<div className="w-full h-full flex items-center justify-center text-3xl">🥦</div>}
                />
                {p.categoryName && (
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[9px] font-bold bg-black/50 text-white px-1.5 py-0.5 rounded-md">
                    <CategoryIcon icon={p.categoryIcon || ''} name={p.categoryName} className="w-3 h-3 object-contain" />
                    {p.categoryName}
                  </span>
                )}
              </div>
              <div className="p-2 flex flex-col flex-1">
                <p className="text-xs font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight">{p.name}</p>
                <p className="mt-0.5 text-[10px] font-medium tabular-nums text-indigo-600 dark:text-indigo-300">{p.productCode}</p>
                {p.localName && <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{p.localName}</p>}
                {p.description && <p className="mt-1 text-[10px] leading-snug text-gray-500 dark:text-slate-400 line-clamp-2">{p.description}</p>}
                <div className="mt-auto pt-2 flex gap-1.5">
                  <button onClick={() => openEdit(p)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => setConfirmDeleteId(p.id)}
                    className="flex items-center justify-center px-2 py-1.5 text-[10px] text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Catalog Product' : 'Add to Catalog'}</p>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Photo gallery */}
              <div className="space-y-3">
                {primaryPhoto ? (
                  <div className="flex justify-center">
                    <div className="relative">
                      <img src={primaryPhoto} alt={form.name} className="w-32 h-32 rounded-2xl object-cover border-2 border-emerald-400 shadow-sm" />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(primaryPhoto)}
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md"
                        aria-label="Remove primary photo"
                        title="Remove photo"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <label className="w-32 h-32 rounded-2xl bg-gray-100 dark:bg-slate-700 border-2 border-dashed border-gray-300 dark:border-slate-500 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                      <Camera className="w-6 h-6 text-gray-500" />
                      <span className="text-[10px] text-gray-500">Add photo</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleAddPhotos} />
                    </label>
                  </div>
                )}
                {primaryPhoto && (
                  <div className="flex justify-center">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                      <Upload className="h-3.5 w-3.5" /> Add secondary photos
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleAddPhotos} />
                    </label>
                  </div>
                )}
                {photos.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {photos.map(photo => (
                      <button
                        key={photo}
                        type="button"
                        onClick={() => setPrimaryPhoto(photo)}
                        className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 flex-shrink-0 ${primaryPhoto === photo ? 'border-emerald-500' : 'border-gray-200 dark:border-slate-600'}`}
                      >
                        <img src={photo} alt="" className="h-full w-full object-cover" />
                        {primaryPhoto === photo && (
                          <span className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">PRIMARY</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                {editing && (
                  <>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Product Code</label>
                    <input type="text" value={editing.productCode} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60 font-mono`} />
                  </>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Product Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Fresh Tomatoes" maxLength={40} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Local Name</label>
                <input type="text" value={form.localName} onChange={e => setForm(f => ({ ...f, localName: e.target.value }))} className={inp} placeholder="e.g. Tamatar, Aloo" maxLength={30} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Search aliases <span className="text-gray-500 font-normal">(hidden from customers)</span></label>
                <input type="text" value={form.searchAliases} onChange={e => setForm(f => ({ ...f, searchAliases: e.target.value }))} className={inp} placeholder="e.g. Piyaj, Peeyaz, Pyaz" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Category</label>
                <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className={inp}>
                  <option value="">Uncategorised</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className={`${inp} resize-none`} rows={2} placeholder="Optional" />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add to Catalog'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Remove from Catalog?</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Cannot delete if already used in a store.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteId(null)} disabled={deleting} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={() => handleDelete(confirmDeleteId)} disabled={deleting}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Upload Modal ── */}
      {showBulkUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !bulkUploading && setShowBulkUpload(false)} />
          <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Bulk Upload from Images</p>
                <p className="text-xs text-gray-500 mt-0.5">Filename becomes product name. Edit before saving.</p>
              </div>
              {!bulkUploading && (
                <button onClick={() => { setShowBulkUpload(false); setBulkItems([]); setBulkProgress(0); }}
                  className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>

            {/* Add more images */}
            {!bulkUploading && (
              <div className="px-5 pt-3 flex-shrink-0">
                <label className="flex items-center justify-center gap-2 w-full py-2.5 border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl text-xs font-semibold text-gray-500 hover:border-emerald-400 hover:text-emerald-600 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" /> Add more images
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleBulkFileSelect} />
                </label>
              </div>
            )}

            {/* Progress bar */}
            {bulkUploading && (
              <div className="px-5 pt-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Uploading...</p>
                  <p className="text-xs text-gray-500">{bulkProgress}%</p>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${bulkProgress}%` }} />
                </div>
              </div>
            )}

            {/* Items list */}
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {bulkItems.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  <Upload className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Select images to upload</p>
                </div>
              ) : bulkItems.map((item, idx) => (
                <div key={idx} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  item.status === 'done' ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/10'
                  : item.status === 'error' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
                  : item.status === 'uploading' ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/10'
                  : 'border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50'
                }`}>
                  <img src={item.preview} alt={item.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      type="text"
                      value={item.name}
                      disabled={bulkUploading}
                      maxLength={40}
                      onChange={e => setBulkItems(prev => prev.map((bi, i) => i === idx ? { ...bi, name: e.target.value } : bi))}
                      className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                    />
                    <select
                      value={item.categoryId}
                      disabled={bulkUploading}
                      onChange={e => setBulkItems(prev => prev.map((bi, i) => i === idx ? { ...bi, categoryId: e.target.value } : bi))}
                      className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60">
                      <option value="">No category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="flex-shrink-0 w-6 text-center">
                    {item.status === 'done' && <span className="text-emerald-500 text-sm">✓</span>}
                    {item.status === 'error' && <span className="text-red-500 text-sm">✗</span>}
                    {item.status === 'uploading' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
                    {item.status === 'pending' && !bulkUploading && (
                      <button onClick={() => setBulkItems(prev => prev.filter((_, i) => i !== idx))}>
                        <X className="w-4 h-4 text-gray-300 hover:text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0 flex gap-3">
              {bulkItems.some(i => i.status === 'done') && !bulkUploading ? (
                <button onClick={() => { setShowBulkUpload(false); setBulkItems([]); setBulkProgress(0); }}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 transition-colors">
                  Done
                </button>
              ) : (
                <>
                  <button onClick={() => { setShowBulkUpload(false); setBulkItems([]); }} disabled={bulkUploading}
                    className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={handleBulkUpload}
                    disabled={bulkUploading || bulkItems.filter(i => i.status === 'pending').length === 0}
                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                    {bulkUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {bulkUploading ? 'Uploading...' : `Upload ${bulkItems.filter(i => i.status === 'pending').length} product${bulkItems.filter(i => i.status === 'pending').length !== 1 ? 's' : ''}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Excel Upload Modal ── */}
      {showExcelUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !excelUploading && setShowExcelUpload(false)} />
          <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-3xl rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Bulk Upload from Excel</p>
                <p className="text-xs text-gray-500 mt-0.5">Name &amp; Category are required. Category accepts name or slug.</p>
                <p className="text-xs text-gray-400 mt-0.5">Expected columns: Product Name *, Local Name, Search aliases (hidden from customers), Category, Description, Photo path (optional)</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="text-[10px] border border-gray-200 dark:border-slate-600 rounded-lg overflow-hidden">
                    <thead className="bg-gray-50 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400">
                      <tr>
                        <th className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Product Name *</th>
                        <th className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Local Name</th>
                        <th className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Search aliases (hidden from customers)</th>
                        <th className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Category</th>
                        <th className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Description</th>
                        <th className="px-2 py-1">Photo path (optional)</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-700 dark:text-slate-300">
                      <tr>
                        <td className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Fresh Tomatoes</td>
                        <td className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Tamatar</td>
                        <td className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Tomato, Tamatar</td>
                        <td className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Fresh Vegetables</td>
                        <td className="px-2 py-1 border-r border-gray-200 dark:border-slate-600">Fresh red tomatoes</td>
                        <td className="px-2 py-1">uploads/products/tomato.jpg</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {!excelUploading && (
                <button onClick={() => { setShowExcelUpload(false); setExcelRows([]); setExcelProgress(0); }}
                  className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>

            {excelUploading && (
              <div className="px-5 pt-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Uploading...</p>
                  <p className="text-xs text-gray-500">{excelProgress}%</p>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${excelProgress}%` }} />
                </div>
              </div>
            )}

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-slate-400">
                    <th className="pb-2 pr-2">Product Name *</th>
                    <th className="pb-2 pr-2">Local Name</th>
                    <th className="pb-2 pr-2">Search aliases (hidden from customers)</th>
                    <th className="pb-2 pr-2">Category *</th>
                    <th className="pb-2 pr-2">Description</th>
                    <th className="pb-2 pr-2">Photo path (optional)</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {excelRows.map((row, idx) => (
                    <tr key={idx} className={`border-t border-gray-100 dark:border-slate-700 ${row.status === 'done' ? 'bg-emerald-50 dark:bg-emerald-900/10' : row.status === 'error' ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                      <td className="py-2 pr-2">
                        <input type="text" value={row.name} disabled={excelUploading}
                          onChange={e => setExcelRows(prev => prev.map((r, i) => i === idx ? recomputeRowError({ ...r, name: e.target.value }) : r))}
                          className="w-full px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-60" />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="text" value={row.localName} disabled={excelUploading}
                          onChange={e => setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, localName: e.target.value } : r))}
                          className="w-full px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-60" />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="text" value={row.searchAliases} disabled={excelUploading}
                          onChange={e => setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, searchAliases: e.target.value } : r))}
                          className="w-full px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-60" />
                      </td>
                      <td className="py-2 pr-2">
                        <select value={row.categoryId} disabled={excelUploading}
                          onChange={e => setExcelRows(prev => prev.map((r, i) => i === idx ? recomputeRowError({ ...r, categoryId: e.target.value, categoryRaw: categories.find(c => c.id === e.target.value)?.name || r.categoryRaw }) : r))}
                          className="w-full px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-60">
                          <option value="">Select</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.slug ? ` (${c.slug})` : ''}</option>)}
                        </select>
                        {row.error && <p className="text-[10px] text-red-500 mt-0.5">{row.error}</p>}
                      </td>
                      <td className="py-2 pr-2">
                        <input type="text" value={row.description} disabled={excelUploading}
                          onChange={e => setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                          className="w-full px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-60" />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="text" value={row.photoPath} disabled={excelUploading}
                          onChange={e => setExcelRows(prev => prev.map((r, i) => i === idx ? { ...r, photoPath: e.target.value } : r))}
                          className="w-full px-2 py-1 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-60"
                          placeholder="uploads/products/..." />
                      </td>
                      <td className="py-2 text-center">
                        {row.status === 'done' && <span className="text-emerald-500">✓</span>}
                        {row.status === 'error' && <span className="text-red-500">✗</span>}
                        {row.status === 'uploading' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
                        {row.status === 'pending' && !excelUploading && (
                          <button onClick={() => setExcelRows(prev => prev.filter((_, i) => i !== idx))}>
                            <X className="w-4 h-4 text-gray-300 hover:text-red-400" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {excelRows.length === 0 && (
                <div className="text-center py-10 text-gray-500 text-sm">No rows</div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0 flex gap-3">
              {excelRows.some(i => i.status === 'done') && !excelUploading ? (
                <button onClick={() => { setShowExcelUpload(false); setExcelRows([]); setExcelProgress(0); }}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 transition-colors">
                  Done
                </button>
              ) : (
                <>
                  <button onClick={() => { setShowExcelUpload(false); setExcelRows([]); }} disabled={excelUploading}
                    className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={handleExcelUpload}
                    disabled={excelUploading || excelRows.filter(i => i.status === 'pending' && !i.error).length === 0}
                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                    {excelUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {excelUploading ? 'Uploading...' : `Upload ${excelRows.filter(i => i.status === 'pending' && !i.error).length} product${excelRows.filter(i => i.status === 'pending' && !i.error).length !== 1 ? 's' : ''}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

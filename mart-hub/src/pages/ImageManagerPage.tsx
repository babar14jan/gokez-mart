import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, GalleryHorizontal, ImageOff, Link2, Loader2, Trash2, X } from 'lucide-react';
import { storageApi, type StorageImageFile, type StorageImageReference } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import SmartImage from '../components/SmartImage';
import { useToast, ToastContainer } from '../hooks/useToast';
import {
  ClearButton, DetailDrawer, EmptyState, FieldRow, FilterBar, Pagination, PanelHeader,
  SearchField, filterClass, fmtDate, useDebounced,
} from '../components/referralUi';

const PAGE_SIZE = 24;

type ImageGroup = 'referenced' | 'unreferenced';

const GROUPS: Array<{ id: ImageGroup; label: string }> = [
  { id: 'referenced', label: 'Referenced' },
  { id: 'unreferenced', label: 'Unreferenced' },
];

function formatSize(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function referenceLabel(ref: StorageImageReference): string {
  return ref.label || formatValue(ref.value) || `${ref.table}.${ref.column} (${ref.rowId})`;
}

function deleteWarning(file: StorageImageFile): string {
  const refs = file.references || [];
  const name = file.originalName || file.filename;
  const irreversible = `This will permanently delete "${name}" from storage. This action is irreversible and cannot be undone. Linked thumbnails, variants, and product asset records may also be removed.`;
  if (!file.referenced || refs.length === 0) return irreversible;
  const samples = refs.slice(0, 3).map(referenceLabel).join(', ');
  const more = refs.length > 3 ? `, and ${refs.length - 3} more` : '';
  return `${irreversible} This image has ${refs.length} database reference${refs.length === 1 ? '' : 's'}: ${samples}${more}. All matching database references will be cleared, so records may lose their image. Continue only if you are certain.`;
}

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  const message = data?.error || data?.message || (error as Error)?.message;
  return formatValue(message) || fallback;
}

export default function ImageManagerPage() {
  const [params, setParams] = useSearchParams();
  const group: ImageGroup = params.get('group') === 'unreferenced' ? 'unreferenced' : 'referenced';
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput).trim();
  const [folder, setFolder] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<StorageImageFile[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<string[]>([]);
  const [groupCounts, setGroupCounts] = useState({ referencedTotal: 0, unreferencedTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<StorageImageFile | null>(null);
  const [detail, setDetail] = useState<{ file: StorageImageFile; references: StorageImageReference[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StorageImageFile | null>(null);
  const { toasts, show: showToast } = useToast();
  const loadRequest = useRef(0);
  const detailRequest = useRef(0);

  const fetchImages = useCallback(async (next: { group: ImageGroup; folder: string; search: string; offset: number }) => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    setError('');
    try {
      const response = await storageApi.list({
        group: next.group,
        folder: next.folder || undefined,
        search: next.search || undefined,
        limit: PAGE_SIZE,
        offset: next.offset,
      }, { fresh: true });
      if (requestId !== loadRequest.current) return;
      const data = response.data?.data;
      setItems(data?.items || []);
      setTotal(data?.total || 0);
      setFolders(data?.folders || []);
      setGroupCounts({
        referencedTotal: data?.referencedTotal || 0,
        unreferencedTotal: data?.unreferencedTotal || 0,
      });
    } catch (error) {
      if (requestId !== loadRequest.current) return;
      setError(errorMessage(error, 'Could not load storage images.'));
      setItems([]);
      setTotal(0);
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { setOffset(0); }, [group, folder, search]);
  useEffect(() => {
    fetchImages({ group, folder, search, offset });
  }, [fetchImages, group, folder, search, offset]);

  const openDetail = async (file: StorageImageFile) => {
    const requestId = ++detailRequest.current;
    setDetail(null);
    setDetailLoading(true);
    try {
      const response = await storageApi.get(file.id, { fresh: true });
      if (requestId !== detailRequest.current) return;
      const data = response.data?.data;
      setDetail({ file: data?.file || file, references: data?.references || [] });
    } catch (error) {
      if (requestId !== detailRequest.current) return;
      setDetail({ file, references: file.references || [] });
      showToast(errorMessage(error, 'Could not load image references.'), 'error');
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  };

  const handleDelete = async () => {
    const file = pendingDelete;
    if (!file) return;
    const target = detail?.file?.id === file.id ? detail.file : file;
    try {
      await storageApi.delete(file.id, { dryRun: false, detach: target.referenced });
      showToast('Image deleted successfully.', 'success');
      setPendingDelete(null);
      setPreview(null);
      setDetail(null);
      const nextOffset = items.length === 1 && offset > 0 ? Math.max(0, offset - PAGE_SIZE) : offset;
      if (nextOffset !== offset) setOffset(nextOffset);
      await fetchImages({ group, folder, search, offset: nextOffset });
    } catch (error) {
      showToast(errorMessage(error, 'Could not delete image.'), 'error');
    }
  };

  const tabCounts: Record<ImageGroup, number> = {
    referenced: groupCounts.referencedTotal,
    unreferenced: groupCounts.unreferencedTotal,
  };

  return (
    <div className="space-y-4">
      <PanelHeader title="Image Manager" subtitle="Inspect stored images, their database references and reclaim unused files." />
      <div role="tablist" aria-label="Storage image groups" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-800">
        {GROUPS.map(tab => (
          <button
            key={tab.id}
            id={`image-${tab.id}-tab`}
            role="tab"
            type="button"
            aria-selected={group === tab.id}
            aria-controls={`image-${tab.id}-panel`}
            onClick={() => setParams({ group: tab.id }, { replace: true })}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              group === tab.id
                ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300'
                : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {tab.label}
            <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-slate-600 dark:text-slate-200">
              {tabCounts[tab.id].toLocaleString('en-IN')}
            </span>
          </button>
        ))}
      </div>

      <div id={`image-${group}-panel`} role="tabpanel" aria-labelledby={`image-${group}-tab`} className="space-y-4">
        <FilterBar>
          <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search filename, original name or folder" />
          <select aria-label="Filter by folder" value={folder} onChange={event => setFolder(event.target.value)} className={`${filterClass} w-auto`}>
            <option value="">All folders</option>
            {folders.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          {(searchInput || folder) && (
            <ClearButton onClick={() => { setSearchInput(''); setFolder(''); setOffset(0); }} />
          )}
        </FilterBar>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="page-card overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></div>
          ) : items.length === 0 ? (
            <EmptyState message="No images found" hint="Try a different folder or clear the search." />
          ) : (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {items.map(file => (
                <div key={file.id} className="overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <button type="button" aria-label={`Preview ${file.originalName || file.filename}`}
                    onClick={() => setPreview(file)}
                    className="relative block w-full text-left">
                    <SmartImage
                      src={file.thumbnailUrl || file.url}
                      alt={file.originalName || file.filename}
                      className="h-32 w-full"
                      imgClassName="object-cover"
                      fallback={<div className="flex h-32 w-full items-center justify-center bg-gray-100 dark:bg-slate-700"><ImageOff className="h-8 w-8 text-gray-400" /></div>}
                    />
                    {file.referenced && (
                      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm dark:bg-slate-900/90 dark:text-emerald-300">
                        <Link2 className="h-3 w-3" />
                        {file.references.length} ref{file.references.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </button>
                  <div className="space-y-1 p-2.5">
                    <p className="truncate text-xs font-semibold text-gray-900 dark:text-white" title={file.originalName || file.filename}>
                      {file.originalName || file.filename}
                    </p>
                    <p className="truncate font-mono text-[10px] text-gray-500 dark:text-slate-400">{file.filename}</p>
                    <p className="truncate text-[10px] text-gray-500 dark:text-slate-400">
                      {file.folder || '—'} · {formatSize(file.size)}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500">{fmtDate(file.createdAt, false)}</p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button type="button" onClick={() => setPreview(file)}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                        <Eye className="h-3 w-3" /> Preview
                      </button>
                      <button type="button" onClick={() => openDetail(file)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                        View references
                      </button>
                      <button type="button" aria-label={`Delete ${file.originalName || file.filename}`} onClick={() => setPendingDelete(file)}
                        className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && total > 0 && <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />}
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-slate-700">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{preview.originalName || preview.filename}</p>
                <p className="text-[10px] text-gray-500 dark:text-slate-400">{preview.folder || '—'} · {formatSize(preview.size)} · {fmtDate(preview.createdAt, false)}</p>
              </div>
              <button type="button" aria-label="Close preview" onClick={() => setPreview(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-[240px] flex-1 items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
              <SmartImage
                src={preview.url}
                alt={preview.originalName || preview.filename}
                className="h-[50vh] w-full"
                imgClassName="object-contain"
                fallback={<div className="flex flex-col items-center gap-2 text-gray-400"><GalleryHorizontal className="h-10 w-10" /><p className="text-xs">No preview available</p></div>}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-700">
              <button type="button" onClick={() => openDetail(preview)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <Link2 className="h-3.5 w-3.5" /> View references
              </button>
              <button type="button" onClick={() => setPendingDelete(preview)}
                className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600">
                <Trash2 className="h-3.5 w-3.5" /> Delete image
              </button>
            </div>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-sm">
          <div className="flex w-full items-center justify-center bg-white dark:bg-slate-800 sm:max-w-xl">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
          </div>
        </div>
      )}
      {detail && !detailLoading && (
        <DetailDrawer title="Image references" subtitle={detail.file.originalName || detail.file.filename} onClose={() => setDetail(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-100 px-3 py-1 dark:border-slate-700">
              <FieldRow label="Folder">{detail.file.folder || '—'}</FieldRow>
              <FieldRow label="File">{detail.file.filename}</FieldRow>
              <FieldRow label="URL">{detail.file.url}</FieldRow>
              <FieldRow label="References">{detail.references.length}</FieldRow>
            </div>
            {detail.references.length === 0 ? (
              <EmptyState message="No database references" hint="This image is not linked to any record." />
            ) : (
              <div className="space-y-2">
                {detail.references.map((ref, index) => (
                  <div key={`${ref.table}-${ref.column}-${ref.rowId}-${index}`} className="rounded-xl border border-gray-100 p-3 dark:border-slate-700">
                    <p className="mb-1 truncate text-xs font-bold text-gray-900 dark:text-white">{referenceLabel(ref)}</p>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{ref.table}.{ref.column}</p>
                    <FieldRow label="Row ID">{ref.rowId}</FieldRow>
                    {ref.path && <FieldRow label="Path">{ref.path}</FieldRow>}
                    {ref.value !== undefined && ref.value !== null && <FieldRow label="Value">{formatValue(ref.value)}</FieldRow>}
                    {ref.label && <FieldRow label="Label">{ref.label}</FieldRow>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DetailDrawer>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete image permanently?"
          message={deleteWarning(detail?.file?.id === pendingDelete.id ? detail.file : pendingDelete)}
          confirmLabel="Delete image"
          cancelLabel="Keep image"
          danger
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

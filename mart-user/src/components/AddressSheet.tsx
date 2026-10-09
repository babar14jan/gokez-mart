import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, MapPin, PenLine, Plus, Trash2 } from 'lucide-react';
import type { SavedAddress } from '../store/customerStore';
import AddressForm, { type AddressCoordinates } from './AddressForm';
import ConfirmDialog from './ConfirmDialog';

/**
 * Shared address sheet used by both the account page and checkout.
 *
 * `select` mode (checkout): the shopper taps a saved address to deliver to.
 * `manage` mode (account): the shopper taps an address to edit it, with
 * set-as-default and delete offered alongside the form.
 *
 * Both modes render the same full-screen sheet, header, rows and form, so the
 * two entry points cannot drift apart in look or behaviour.
 *
 * The visitor only mounts this when the sheet is open, so `initialEditingId`
 * seeds the first view without needing a sync effect.
 *
 * Action handlers return a boolean: `false` means "not handled, keep the sheet
 * open" (e.g. an invalid name blocked the save) — anything else is success.
 */
export interface AddressSheetProps {
  addresses: SavedAddress[];
  mode: 'select' | 'manage';
  onClose: () => void;
  /** select mode: the currently chosen address line. */
  selectedAddress?: string | null;
  onSelectAddress?: (address: SavedAddress) => Promise<boolean> | boolean;
  onAddAddress: (label: string, address: string, coordinates: AddressCoordinates | null) => Promise<boolean> | boolean;
  onUpdateAddress?: (id: string, label: string, address: string, coordinates: AddressCoordinates | null) => Promise<boolean> | boolean;
  onDeleteAddress?: (id: string) => Promise<void> | void;
  onSetDefaultAddress?: (id: string) => Promise<void> | void;
  /** Opens straight into the form. 'new' adds, an id edits, null shows the list. */
  initialEditingId?: string | 'new' | null;
  /** Rendered above the form fields and the list, e.g. the checkout name box. */
  nameSlot?: React.ReactNode;
  requiresName?: boolean;
  focusFirstField?: boolean;
}

export default function AddressSheet({
  addresses, mode, onClose, selectedAddress, onSelectAddress,
  onAddAddress, onUpdateAddress, onDeleteAddress, onSetDefaultAddress,
  initialEditingId = null, nameSlot, requiresName = false, focusFirstField = false,
}: AddressSheetProps) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(initialEditingId);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The page behind must not scroll under the sheet (iOS rubber-banding shows the
  // app header reappearing at the very top when the body is scrolled).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const editingAddress = editingId && editingId !== 'new'
    ? addresses.find(address => address.id === editingId) ?? null
    : null;
  const isEditing = editingId !== null;
  const canReturnToList = isEditing && addresses.length > 0;
  const deletingAddress = pendingDelete ? addresses.find(address => address.id === pendingDelete) ?? null : null;

  const handleSave = async (label: string, address: string, coordinates: AddressCoordinates | null) => {
    setSaving(true);
    try {
      const ok = editingId === 'new'
        ? await onAddAddress(label, address, coordinates)
        : editingId && onUpdateAddress
          ? await onUpdateAddress(editingId, label, address, coordinates)
          : true;
      if (ok !== false) onClose();
    } finally { setSaving(false); }
  };

  const handleSelect = async (address: SavedAddress) => {
    if (!onSelectAddress) return;
    const ok = await onSelectAddress(address);
    if (ok !== false) onClose();
  };

  const handleDelete = async () => {
    if (!deletingAddress || !onDeleteAddress) return;
    await onDeleteAddress(deletingAddress.id);
    setPendingDelete(null);
    setEditingId(null);
  };

  const title = isEditing
    ? (editingId === 'new' ? 'Add delivery address' : 'Edit delivery address')
    : (mode === 'select' ? 'Choose delivery address' : 'Saved addresses');

  // Rendered into <body> through a portal so no page wrapper (a scroll container
  // or stacking context) can push it down or paint the app header on top of it.
  // The sheet is full-screen from the very top (safe-area padded) to the bottom.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-white dark:bg-slate-900">
      {/* Same full-height surface as the cart: header row, then the scrolling body */}
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-slate-700 dark:bg-slate-900">
          <button type="button" onClick={canReturnToList ? () => setEditingId(null) : onClose}
            aria-label={canReturnToList ? 'Back to saved addresses' : 'Close address'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-slate-200 dark:hover:bg-slate-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <p className="flex-1 truncate text-base font-bold text-gray-900 dark:text-white">{title}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
          {isEditing ? (
            <div className="px-5 py-4">
              {mode === 'manage' && editingAddress && (
                <div className="mb-4 space-y-2">
                  {!editingAddress.isDefault && onSetDefaultAddress && (
                    <button type="button" onClick={() => onSetDefaultAddress(editingAddress.id)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30">
                      <Check className="h-4 w-4" /> Set as default
                    </button>
                  )}
                  {onDeleteAddress && (
                    <button type="button" onClick={() => setPendingDelete(editingAddress.id)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30">
                      <Trash2 className="h-4 w-4" /> Delete address
                    </button>
                  )}
                </div>
              )}
              <AddressForm
                stored={editingAddress?.address ?? null}
                initialLabel={editingAddress?.label ?? 'Home'}
                initialCoordinates={editingAddress && editingAddress.latitude != null && editingAddress.longitude != null
                  ? { latitude: editingAddress.latitude, longitude: editingAddress.longitude }
                  : null}
                focusFirstField={focusFirstField}
                saving={saving}
                onSave={handleSave}
                onCancel={() => (addresses.length > 0 ? setEditingId(null) : onClose())}
                nameSlot={nameSlot}
              />
            </div>
          ) : (
            <>
              {requiresName && nameSlot && (
                <div className="border-b border-gray-100 px-5 py-4 dark:border-slate-700">{nameSlot}</div>
              )}
              {addresses.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-gray-500 dark:text-slate-400">No saved addresses yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-slate-700">
                  {addresses.map(address => {
                    const selected = mode === 'select' && address.address === selectedAddress;
                    return (
                      <button type="button" key={address.id}
                        onClick={() => (mode === 'select' ? handleSelect(address) : setEditingId(address.id))}
                        className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-slate-700">
                        <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${selected || address.isDefault ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-slate-700'}`}>
                          <MapPin className={`h-3.5 w-3.5 ${selected || address.isDefault ? 'text-emerald-500' : 'text-gray-500'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-gray-700 dark:text-slate-300">{address.label}</span>
                            {address.isDefault && (
                              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">Default</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{address.address}</p>
                        </div>
                        {mode === 'select'
                          ? (selected && <Check className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-500" />)
                          : <PenLine className="mt-1 h-4 w-4 flex-shrink-0 text-gray-400" />}
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" onClick={() => setEditingId('new')}
                className="flex w-full items-center gap-2.5 border-t border-gray-100 px-5 py-3.5 text-emerald-600 hover:bg-emerald-50 dark:border-slate-700 dark:hover:bg-emerald-900/20">
                <Plus className="h-4 w-4" />
                <span className="text-sm font-semibold">Add new address</span>
              </button>
            </>
          )}
        </div>
      </div>

      {deletingAddress && (
        <ConfirmDialog
          title="Delete this address?"
          message={`This will remove your ${deletingAddress.label.toLowerCase()} address from saved addresses.`}
          confirmLabel="Delete address"
          cancelLabel="Keep address"
          danger
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>,
    document.body,
  );
}

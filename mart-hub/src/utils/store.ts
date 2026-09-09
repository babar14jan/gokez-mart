const SHAPOORJI_ID = '00000000-0000-0000-0000-000000000001';

export function getActiveStoreId(): string {
  const ownStoreId = localStorage.getItem('mart_admin_store_id'); // store owner's own store
  if (ownStoreId) return ownStoreId;
  return localStorage.getItem('mart_admin_active_store') || SHAPOORJI_ID;
}

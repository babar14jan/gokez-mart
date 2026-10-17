import type { SavedAddress } from '../store/customerStore';

/**
 * Guests have no server address book (it lives behind `authenticateCustomer`),
 * so their one delivery address is kept in localStorage. Previously only the
 * raw address text was persisted, so a reload dropped the label and the
 * coordinates (which drive the zone check). These keys keep the whole address.
 */
export const GUEST_ADDRESS_KEYS = {
  address: 'guest_address',
  label: 'guest_address_label',
  latitude: 'guest_address_latitude',
  longitude: 'guest_address_longitude',
} as const;

export interface GuestAddressCoordinates {
  latitude: number | null;
  longitude: number | null;
}

/** Reads the guest address as a SavedAddress, or null when none is stored. */
export function readGuestAddress(): SavedAddress | null {
  if (typeof window === 'undefined') return null;
  try {
    const address = localStorage.getItem(GUEST_ADDRESS_KEYS.address);
    if (!address) return null;
    const lat = localStorage.getItem(GUEST_ADDRESS_KEYS.latitude);
    const lng = localStorage.getItem(GUEST_ADDRESS_KEYS.longitude);
    return {
      id: 'guest',
      label: localStorage.getItem(GUEST_ADDRESS_KEYS.label) || 'Home',
      address,
      latitude: lat != null ? Number(lat) : null,
      longitude: lng != null ? Number(lng) : null,
      isDefault: true,
    };
  } catch {
    return null;
  }
}

/** Persists the guest's single delivery address. An empty address clears it. */
export function writeGuestAddress(label: string, address: string, coordinates: GuestAddressCoordinates | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!address) {
      clearGuestAddress();
      return;
    }
    localStorage.setItem(GUEST_ADDRESS_KEYS.address, address);
    localStorage.setItem(GUEST_ADDRESS_KEYS.label, label.trim() || 'Home');
    if (coordinates?.latitude != null && coordinates?.longitude != null) {
      localStorage.setItem(GUEST_ADDRESS_KEYS.latitude, String(coordinates.latitude));
      localStorage.setItem(GUEST_ADDRESS_KEYS.longitude, String(coordinates.longitude));
    } else {
      localStorage.removeItem(GUEST_ADDRESS_KEYS.latitude);
      localStorage.removeItem(GUEST_ADDRESS_KEYS.longitude);
    }
  } catch {}
}

export function clearGuestAddress(): void {
  if (typeof window === 'undefined') return;
  try {
    Object.values(GUEST_ADDRESS_KEYS).forEach((key) => localStorage.removeItem(key));
  } catch {}
}
